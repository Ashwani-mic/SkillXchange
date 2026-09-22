// Reviews routes: manages peer reviews, ratings submission, and average score recalculations.
const express = require('express');
const router = express.Router();
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

// GET /api/reviews/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const reviews = await db.all(
      `SELECT r.rating, r.comment, r.created_at, u.full_name AS reviewer_name
       FROM reviews r JOIN users u ON r.reviewer_id = u.id
       WHERE r.reviewed_user_id = ? ORDER BY r.created_at DESC`,
      [req.session.userId]
    );
    res.json({ reviews });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/reviews
router.post('/', requireAuth, async (req, res) => {
  const { session_id, rating, comment } = req.body;
  if (!session_id || !rating) return res.status(400).json({ error: 'Session and rating are required.' });
  if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5.' });

  try {
    const session = await db.get(
      'SELECT * FROM skill_sessions WHERE id = ? AND (teacher_id = ? OR learner_id = ?)',
      [session_id, req.session.userId, req.session.userId]
    );
    if (!session) return res.status(404).json({ error: 'Session not found.' });

    const existingReview = await db.get('SELECT id FROM reviews WHERE session_id = ? AND reviewer_id = ?', [session_id, req.session.userId]);
    if (existingReview) return res.status(409).json({ error: 'You already reviewed this session.' });

    const reviewedUserId = session.teacher_id === req.session.userId ? session.learner_id : session.teacher_id;
    await db.run(
      'INSERT INTO reviews (session_id, reviewer_id, reviewed_user_id, rating, comment) VALUES (?, ?, ?, ?, ?)',
      [session_id, req.session.userId, reviewedUserId, rating, comment || '']
    );

    // Update average rating
    const ratingData = await db.get(
      'SELECT AVG(rating) AS avg_rating, COUNT(*) AS count FROM reviews WHERE reviewed_user_id = ?',
      [reviewedUserId]
    );
    await db.run('UPDATE users SET average_rating = ? WHERE id = ?', [ratingData.avg_rating || 0, reviewedUserId]);

    res.status(201).json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
