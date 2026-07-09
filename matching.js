const db = require('./db');
const { getEmbedding, cosineSimilarity } = require('./embeddings');

/**
 * Semantic Matching Algorithm for SkillXchange using local ONNX embeddings
 *
 * Match Types:
 *  - "perfect": User A teaches skill X (similar to User B's learn Y) AND
 *               User B teaches skill Y (similar to User A's learn X)
 *  - "partial":  User A teaches something User B wants to learn
 *                OR User B teaches something User A wants to learn
 */
async function getMatchesForUser(userId) {
  try {
    // 1. Get current user's skills
    const mySkills = await db.all(
      'SELECT skill_name, skill_type FROM user_skills WHERE user_id = ?',
      [userId]
    );

    const myTeach = mySkills.filter(s => s.skill_type === 'teach').map(s => s.skill_name);
    const myLearn = mySkills.filter(s => s.skill_type === 'learn').map(s => s.skill_name);

    if (!myTeach.length && !myLearn.length) return [];

    // Preload embeddings for current user's skills
    const myTeachEmbeddings = {};
    const myLearnEmbeddings = {};
    await Promise.all([
      ...myTeach.map(async s => { myTeachEmbeddings[s] = await getEmbedding(s); }),
      ...myLearn.map(async s => { myLearnEmbeddings[s] = await getEmbedding(s); })
    ]);

    // 2. Get all other users with their skills list
    const otherUsers = await db.all(`
      SELECT u.id, u.username, u.full_name AS fullname, u.bio, u.avatar_url, u.average_rating,
      string_agg(CASE WHEN us.skill_type = 'teach' THEN us.skill_name END, ',') AS teach_skills,
      string_agg(CASE WHEN us.skill_type = 'learn' THEN us.skill_name END, ',') AS learn_skills
    FROM users u
    JOIN user_skills us ON us.user_id = u.id
    WHERE u.id != ?
    GROUP BY u.id, u.username, u.full_name, u.bio, u.avatar_url, u.average_rating
    `, [userId]);

    const matches = [];

    // Threshold for semantic matching (0.65 cosine similarity represents close semantic relationship)
    const MATCH_THRESHOLD = 0.65;

    for (const peer of otherUsers) {
      const peerTeach = (peer.teach_skills || '').split(',').filter(Boolean);
      const peerLearn = (peer.learn_skills || '').split(',').filter(Boolean);

      const peerTeachEmbeddings = {};
      const peerLearnEmbeddings = {};

      // Fetch embeddings for the peer's skills
      await Promise.all([
        ...peerTeach.map(async s => { peerTeachEmbeddings[s] = await getEmbedding(s); }),
        ...peerLearn.map(async s => { peerLearnEmbeddings[s] = await getEmbedding(s); })
      ]);

      const iCanTeachThem = [];
      const theyCanTeachMe = [];
      let totalSimilarity = 0;
      let matchCount = 0;

      // Check: I can teach them (myTeach -> peerLearn)
      for (const sMy of myTeach) {
        const embMy = myTeachEmbeddings[sMy];
        if (!embMy) continue;

        let bestPeerSkill = null;
        let maxSim = 0;

        for (const sPeer of peerLearn) {
          const embPeer = peerLearnEmbeddings[sPeer];
          if (!embPeer) continue;

          const sim = cosineSimilarity(embMy, embPeer);
          if (sim > maxSim) {
            maxSim = sim;
            bestPeerSkill = sPeer;
          }
        }

        if (maxSim >= MATCH_THRESHOLD) {
          // If the match is not exact, show a friendly semantic indicator
          const displayLabel = sMy.toLowerCase() === bestPeerSkill.toLowerCase()
            ? sMy
            : `${sMy} ↔ ${bestPeerSkill} (${Math.round(maxSim * 100)}%)`;
          iCanTeachThem.push(displayLabel);
          totalSimilarity += maxSim;
          matchCount++;
        }
      }

      // Check: They can teach me (peerTeach -> myLearn)
      for (const sPeer of peerTeach) {
        const embPeer = peerTeachEmbeddings[sPeer];
        if (!embPeer) continue;

        let bestMySkill = null;
        let maxSim = 0;

        for (const sMy of myLearn) {
          const embMy = myLearnEmbeddings[sMy];
          if (!embMy) continue;

          const sim = cosineSimilarity(embPeer, embMy);
          if (sim > maxSim) {
            maxSim = sim;
            bestMySkill = sMy;
          }
        }

        if (maxSim >= MATCH_THRESHOLD) {
          const displayLabel = sPeer.toLowerCase() === bestMySkill.toLowerCase()
            ? sPeer
            : `${sPeer} ↔ ${bestMySkill} (${Math.round(maxSim * 100)}%)`;
          theyCanTeachMe.push(displayLabel);
          totalSimilarity += maxSim;
          matchCount++;
        }
      }

      // Decide match type and score
      if (iCanTeachThem.length > 0 && theyCanTeachMe.length > 0) {
        matches.push({
          ...peer,
          match_type: 'perfect',
          match_score: Math.round(totalSimilarity * 50),
          i_can_teach: iCanTeachThem,
          they_can_teach: theyCanTeachMe
        });
      } else if (iCanTeachThem.length > 0 || theyCanTeachMe.length > 0) {
        matches.push({
          ...peer,
          match_type: 'partial',
          match_score: Math.round(totalSimilarity * 25), // Scale by 25 for partial match
          i_can_teach: iCanTeachThem,
          they_can_teach: theyCanTeachMe
        });
      }
    }

    // Sort by match score descending
    matches.sort((a, b) => b.match_score - a.match_score);
    return matches;
  } catch (err) {
    console.error('❌ Error in semantic getMatchesForUser:', err.message);
    return [];
  }
}

module.exports = { getMatchesForUser };
