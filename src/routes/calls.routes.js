// Calls routes: fetches peer-to-peer and group video call histories and statuses.
const express = require('express');
const router = express.Router();
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

// GET /api/calls/history
router.get('/history', requireAuth, async (req, res) => {
  try {
    const logs = await db.all(
      `SELECT cl.id, cl.caller_id, cl.receiver_id, cl.call_type, cl.status, cl.timestamp,
              u1.username AS caller_name, u2.username AS receiver_name
       FROM call_logs cl
       JOIN users u1 ON cl.caller_id = u1.id
       JOIN users u2 ON cl.receiver_id = u2.id
       WHERE cl.caller_id = ? OR cl.receiver_id = ?
       ORDER BY cl.timestamp DESC LIMIT 50`,
      [req.session.userId, req.session.userId]
    );
    res.json({ logs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
