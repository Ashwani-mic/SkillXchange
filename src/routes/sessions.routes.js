// Sessions routes: handles skill session bookings, schedule lookups, and session status updates.
const express = require('express');
const router = express.Router();
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

// GET /api/sessions/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const sessions = await db.all(
      `SELECT s.*,
        t.full_name AS teacher_name,
        l.full_name AS learner_name,
        EXISTS(SELECT 1 FROM reviews r WHERE r.session_id = s.id AND r.reviewer_id = ?) AS reviewed
       FROM skill_sessions s
       JOIN users t ON t.id = s.teacher_id
       JOIN users l ON l.id = s.learner_id
       WHERE s.teacher_id = ? OR s.learner_id = ?
       ORDER BY s.created_at DESC`,
      [req.session.userId, req.session.userId, req.session.userId]
    );
    res.json({ sessions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/sessions — Book a session
router.post('/', requireAuth, async (req, res) => {
  const { teacher_id, skill_name, scheduled_at } = req.body;
  if (!teacher_id || !skill_name || !scheduled_at) return res.status(400).json({ error: 'Teacher, skill, and scheduled time are required.' });
  if (parseInt(teacher_id) === req.session.userId) return res.status(400).json({ error: 'You cannot book yourself.' });

  try {
    const result = await db.run(
      'INSERT INTO skill_sessions (teacher_id, learner_id, skill_name, scheduled_at, status) VALUES (?, ?, ?, ?, ?)',
      [teacher_id, req.session.userId, skill_name, scheduled_at, 'scheduled']
    );
    res.status(201).json({ id: result.id, success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/sessions/:id/status — Update session status
router.put('/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['scheduled', 'active', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  try {
    const session = await db.get(
      'SELECT * FROM skill_sessions WHERE id = ? AND (teacher_id = ? OR learner_id = ?)',
      [req.params.id, req.session.userId, req.session.userId]
    );
    if (!session) return res.status(404).json({ error: 'Session not found.' });

    // Prevent double status updates to secure credit transactions
    if (session.status === status) {
      return res.json({ success: true, message: 'Status already up-to-date.' });
    }

    await db.run('UPDATE skill_sessions SET status = ? WHERE id = ?', [status, req.params.id]);
    if (status === 'completed') {
      // Award credits for completion
      await db.run('UPDATE users SET credits = credits + 2 WHERE id = ?', [session.teacher_id]);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
