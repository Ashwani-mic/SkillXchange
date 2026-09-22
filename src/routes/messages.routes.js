// Messages routes: retrieves direct chat logs with inline call records, and posts direct messages.
const express = require('express');
const router = express.Router();
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

// GET /api/messages/:partnerId
router.get('/:partnerId', requireAuth, async (req, res) => {
  try {
    const messages = await db.all(
      `SELECT id, sender_id, receiver_id, message_text AS message, timestamp AS created_at, status, reply_to_id, is_edited, is_deleted, reactions
       FROM messages
       WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
       ORDER BY timestamp ASC LIMIT 100`,
      [req.session.userId, req.params.partnerId, req.params.partnerId, req.session.userId]
    );

    // Fetch call logs to display inline
    const calls = await db.all(
      `SELECT id, caller_id, receiver_id, call_type, status, timestamp
       FROM call_logs
       WHERE (caller_id = ? AND receiver_id = ?) OR (caller_id = ? AND receiver_id = ?)
       ORDER BY timestamp ASC LIMIT 50`,
      [req.session.userId, req.params.partnerId, req.params.partnerId, req.session.userId]
    );

    const callMessages = calls.map(c => ({
      id: 'call_' + c.id,
      sender_id: c.caller_id,
      receiver_id: c.receiver_id,
      message: `📞 ${c.call_type === 'group' ? 'Group Class' : 'Classroom Session'} (${c.status})`,
      created_at: c.timestamp,
      is_call_log: true,
      call_status: c.status
    }));

    const combined = [...messages, ...callMessages].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    res.json({ messages: combined });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/messages
router.post('/', requireAuth, async (req, res) => {
  const { receiver_id, message } = req.body;
  if (!receiver_id || !message?.trim()) return res.status(400).json({ error: 'Receiver and message are required.' });
  try {
    const result = await db.saveDirectMessage(req.session.userId, receiver_id, message.trim());
    res.status(201).json({ id: result?.id || null, success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
