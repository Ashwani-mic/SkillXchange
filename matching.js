const db = require('./db');

/**
 * Smart Matching Algorithm for SkillXchange
 *
 * Match Types:
 *  - "perfect": User A teaches skill X AND wants to learn skill Y,
 *               User B teaches skill Y AND wants to learn skill X
 *  - "partial":  User A teaches something User B wants to learn
 *                OR User B teaches something User A wants to learn
 */
async function getMatchesForUser(userId) {
  // Get current user's skills
  const mySkills = await db.all(
    'SELECT skill_name, skill_type FROM user_skills WHERE user_id = ?',
    [userId]
  );

  const myTeach = mySkills.filter(s => s.skill_type === 'teach').map(s => s.skill_name);
  const myLearn = mySkills.filter(s => s.skill_type === 'learn').map(s => s.skill_name);

  if (!myTeach.length && !myLearn.length) return [];

  // Get all other users with their skills
  const otherUsers = await db.all(`
    SELECT u.id, u.username, u.full_name AS fullname, u.bio, u.avatar_url, u.average_rating,
      GROUP_CONCAT(CASE WHEN us.skill_type = 'teach' THEN us.skill_name END, ',') AS teach_skills,
      GROUP_CONCAT(CASE WHEN us.skill_type = 'learn' THEN us.skill_name END, ',') AS learn_skills
    FROM users u
    JOIN user_skills us ON us.user_id = u.id
    WHERE u.id != ?
    GROUP BY u.id
  `, [userId]);

  const matches = [];

  for (const peer of otherUsers) {
    const peerTeach = (peer.teach_skills || '').split(',').filter(Boolean);
    const peerLearn = (peer.learn_skills || '').split(',').filter(Boolean);

    // Perfect match: I teach what they want AND they teach what I want
    const iCanTeachThem = myTeach.filter(s => peerLearn.includes(s));
    const theyCanTeachMe = peerTeach.filter(s => myLearn.includes(s));

    if (iCanTeachThem.length > 0 && theyCanTeachMe.length > 0) {
      matches.push({
        ...peer,
        match_type: 'perfect',
        match_score: (iCanTeachThem.length + theyCanTeachMe.length) * 50,
        i_can_teach: iCanTeachThem,
        they_can_teach: theyCanTeachMe
      });
      continue;
    }

    // Partial match: either direction
    const partialMatch = iCanTeachThem.length > 0 || theyCanTeachMe.length > 0;
    if (partialMatch) {
      matches.push({
        ...peer,
        match_type: 'partial',
        match_score: (iCanTeachThem.length + theyCanTeachMe.length) * 25,
        i_can_teach: iCanTeachThem,
        they_can_teach: theyCanTeachMe
      });
    }
  }

  // Sort by match score descending
  matches.sort((a, b) => b.match_score - a.match_score);
  return matches;
}

module.exports = { getMatchesForUser };
