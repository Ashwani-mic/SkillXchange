// Authentication routes: user registration, session login, current user profile retrieval, and logout.
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');

// GET /api/auth/me — Get current session user
router.get('/me', async (req, res) => {
  if (!req.session || !req.session.userId) return res.json({ user: null });
  try {
    const user = await db.get(
      'SELECT id, username, email, full_name AS fullname, bio, avatar_url, credits, average_rating FROM users WHERE id = ?',
      [req.session.userId]
    );
    if (!user) return res.json({ user: null });
    res.json({ user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/register — Sign up
router.post('/register', async (req, res) => {
  const { username, email, password, fullname, bio } = req.body;
  if (!username || !email || !password || !fullname) {
    return res.status(400).json({ error: 'Username, email, password, and full name are required.' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  try {
    const existing = await db.get('SELECT id FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)', [username.trim(), email.trim()]);
    if (existing) return res.status(409).json({ error: 'Username or email already taken.' });

    const hash = await bcrypt.hash(password, 10);
    const result = await db.run(
      'INSERT INTO users (username, email, password_hash, full_name, bio, credits) VALUES (?, ?, ?, ?, ?, 5)',
      [username.trim(), email.trim(), hash, fullname.trim(), bio ? bio.trim() : '']
    );
    const user = await db.get(
      'SELECT id, username, email, full_name AS fullname, bio, avatar_url, credits, average_rating FROM users WHERE id = ?',
      [result.id]
    );
    // Auto-login
    req.session.userId = user.id;
    req.session.username = user.username;
    res.status(201).json({ user, message: 'Account created and logged in.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/login — Sign in
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });

  try {
    const user = await db.get(
      'SELECT id, username, email, full_name AS fullname, bio, avatar_url, credits, average_rating, is_verified, password_hash FROM users WHERE LOWER(username) = LOWER(?)',
      [username.trim()]
    );
    if (!user) return res.status(401).json({ error: 'User not found. Please check your username.' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Incorrect password.' });

    req.session.userId = user.id;
    req.session.username = user.username;
    const { password_hash: _, is_verified: __, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

module.exports = router;
