// User routes: manages user profiles, preference updates, peer exploration, and public profile views.
const express = require('express');
const router = express.Router();
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { onlineUsers } = require('../sockets/state');

// GET /api/users/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await db.get(
      'SELECT id, username, email, full_name AS fullname, bio, avatar_url, credits, average_rating FROM users WHERE id = ?',
      [req.session.userId]
    );
    res.json({ user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/users/me
router.put('/me', requireAuth, async (req, res) => {
  const { fullname, bio, avatar_url, hide_last_seen } = req.body;
  try {
    await db.run(
      'UPDATE users SET full_name = ?, bio = ?, avatar_url = ?, hide_last_seen = ? WHERE id = ?',
      [fullname, bio, avatar_url || null, hide_last_seen ? 1 : 0, req.session.userId]
    );
    const user = await db.get(
      'SELECT id, username, email, full_name AS fullname, bio, avatar_url, credits, average_rating, hide_last_seen FROM users WHERE id = ?',
      [req.session.userId]
    );
    res.json({ user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/users/explore — Search/list all users
router.get('/explore', requireAuth, async (req, res) => {
  const { search = '', filter_type = '' } = req.query;
  try {
    let query = `
      SELECT u.id, u.username, u.full_name AS fullname, u.bio, u.avatar_url, u.average_rating,
        (SELECT string_agg(us2.skill_name, ', ') FROM user_skills us2 WHERE us2.user_id = u.id AND us2.skill_type = 'teach') AS teach_skills,
        (SELECT string_agg(us3.skill_name, ', ') FROM user_skills us3 WHERE us3.user_id = u.id AND us3.skill_type = 'learn') AS learn_skills
      FROM users u
      WHERE u.id != ?
    `;
    const params = [req.session.userId];

    if (search) {
      query += ` AND (u.username ILIKE ? OR u.full_name ILIKE ? OR
        u.id IN (SELECT user_id FROM user_skills WHERE skill_name ILIKE ?))`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (filter_type === 'teach') {
      query += ` AND u.id IN (SELECT user_id FROM user_skills WHERE skill_type = 'teach')`;
    } else if (filter_type === 'learn') {
      query += ` AND u.id IN (SELECT user_id FROM user_skills WHERE skill_type = 'learn')`;
    }

    query += ' ORDER BY u.average_rating DESC LIMIT 50';
    const users = await db.all(query, params);
    res.json({ users });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/users/:id — Get peer profile with skills and reviews
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const user = await db.get(
      'SELECT id, username, full_name AS fullname, bio, avatar_url, average_rating FROM users WHERE id = ?',
      [req.params.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const teach_skills = await db.all('SELECT skill_name FROM user_skills WHERE user_id = ? AND skill_type = ?', [user.id, 'teach']);
    const learn_skills = await db.all('SELECT skill_name FROM user_skills WHERE user_id = ? AND skill_type = ?', [user.id, 'learn']);
    const reviews = await db.all(
      `SELECT r.rating, r.comment, r.created_at, u.full_name AS reviewer_name
       FROM reviews r JOIN users u ON r.reviewer_id = u.id
       WHERE r.reviewed_user_id = ? ORDER BY r.created_at DESC LIMIT 5`,
      [user.id]
    );

    // Check if online via socket
    const isOnline = onlineUsers.has(parseInt(req.params.id));
    res.json({ user: { ...user, teach_skills, learn_skills, reviews, is_online: isOnline } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
