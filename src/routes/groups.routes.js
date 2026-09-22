// Groups routes: handles study groups creation, member rosters, group chat history, and realtime messaging.
const express = require('express');
const router = express.Router();
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { onlineUsers } = require('../sockets/state');

// POST /api/groups — Create a new group
router.post('/', requireAuth, async (req, res) => {
  const { name, memberIds = [] } = req.body;
  if (!name) return res.status(400).json({ error: 'Group name is required.' });

  try {
    // 1. Insert group
    const groupRes = await db.run(
      'INSERT INTO groups (name, created_by) VALUES (?, ?)',
      [name, req.session.userId]
    );
    const groupId = groupRes.id;

    // 2. Add creator as admin
    await db.run(
      'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
      [groupId, req.session.userId, 'admin']
    );

    // 3. Add other members
    for (const mId of memberIds) {
      const parsedId = parseInt(mId);
      if (parsedId && parsedId !== req.session.userId) {
        await db.run(
          'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
          [groupId, parsedId, 'member']
        );
      }
    }

    res.status(201).json({ success: true, groupId, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/:id/members — Add new members
router.post('/:id/members', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  const { memberIds = [] } = req.body;

  try {
    const isMember = await db.get(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.session.userId]
    );
    if (!isMember) return res.status(403).json({ error: 'Not authorized to add members.' });

    for (const mId of memberIds) {
      const parsedId = parseInt(mId);
      if (parsedId) {
        await db.run(
          'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
          [groupId, parsedId, 'member']
        );
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups — List current user's groups
router.get('/', requireAuth, async (req, res) => {
  try {
    const groups = await db.all(`
      SELECT g.id, g.name, g.created_by, g.created_at,
        (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count
      FROM groups g
      JOIN group_members gm ON gm.group_id = g.id
      WHERE gm.user_id = ?
      ORDER BY g.created_at DESC
    `, [req.session.userId]);
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups/:id — Get details of a single group including its members
router.get('/:id', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  try {
    const isMember = await db.get(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.session.userId]
    );
    if (!isMember) return res.status(403).json({ error: 'Access denied.' });

    const group = await db.get(
      'SELECT id, name, created_by, created_at FROM groups WHERE id = ?',
      [groupId]
    );
    if (!group) return res.status(404).json({ error: 'Group not found.' });

    const members = await db.all(`
      SELECT u.id, u.username AS name, u.full_name AS fullname, u.avatar_url, gm.role
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ?
    `, [groupId]);

    res.json({ ...group, members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups/:id/messages — Get message history
router.get('/:id/messages', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  try {
    const isMember = await db.get(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.session.userId]
    );
    if (!isMember) return res.status(403).json({ error: 'Access denied.' });

    const messages = await db.all(`
      SELECT gm.id, gm.group_id, gm.sender_id, u.username AS sender_name, u.avatar_url AS sender_avatar, gm.message, gm.created_at AS timestamp, gm.reply_to_id, gm.is_edited, gm.is_deleted, gm.reactions,
             (SELECT string_agg(u2.username, ', ') 
              FROM group_message_receipts gmr 
              JOIN users u2 ON u2.id = gmr.user_id 
              WHERE gmr.message_id = gm.id) AS read_by
      FROM group_messages gm
      JOIN users u ON u.id = gm.sender_id
      WHERE gm.group_id = ?
      ORDER BY gm.created_at ASC
    `, [groupId]);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/:id/messages — Post a group message
router.post('/:id/messages', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required.' });

  try {
    const isMember = await db.get(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.session.userId]
    );
    if (!isMember) return res.status(403).json({ error: 'Access denied.' });

    const msgRes = await db.run(
      'INSERT INTO group_messages (group_id, sender_id, message) VALUES (?, ?, ?)',
      [groupId, req.session.userId, message.trim()]
    );

    const sender = await db.get('SELECT username, avatar_url FROM users WHERE id = ?', [req.session.userId]);

    // Realtime broadcast to group members
    const io = req.app.get('io');
    if (io) {
      const members = await db.all('SELECT user_id FROM group_members WHERE group_id = ?', [groupId]);
      members.forEach(member => {
        if (member.user_id !== req.session.userId) {
          const socketId = onlineUsers.get(member.user_id);
          if (socketId) {
            io.to(socketId).emit('receive_group_message', {
              id: msgRes.id,
              group_id: groupId,
              sender_id: req.session.userId,
              sender_name: sender.username,
              sender_avatar: sender.avatar_url,
              message: message.trim(),
              timestamp: new Date().toISOString()
            });
          }
        }
      });
    }

    res.status(201).json({
      success: true,
      messageId: msgRes.id,
      senderName: sender.username,
      senderAvatar: sender.avatar_url
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups/:id/members — Get members roster
router.get('/:id/members', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  try {
    const isMember = await db.get(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.session.userId]
    );
    if (!isMember) return res.status(403).json({ error: 'Access denied.' });

    const members = await db.all(`
      SELECT u.id, u.username AS name, u.full_name AS fullname, u.avatar_url
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ?
    `, [groupId]);
    res.json({ members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/groups/:id — Delete a group (owner/admin only)
router.delete('/:id', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  const userId = req.session.userId;
  try {
    // 1. Verify if group exists and if current user is owner or admin of the group
    const group = await db.get('SELECT created_by FROM groups WHERE id = ?', [groupId]);
    if (!group) {
      return res.status(404).json({ error: 'Group not found.' });
    }
    
    const member = await db.get(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, userId]
    );
    
    const isCreator = group.created_by === userId;
    const isAdmin = member && member.role === 'admin';
    
    if (!isCreator && !isAdmin) {
      return res.status(403).json({ error: 'Only group owners or admins can delete this group.' });
    }

    // 2. Delete group (cascades to group_members and group_messages)
    await db.run('DELETE FROM groups WHERE id = ?', [groupId]);

    res.json({ success: true, message: 'Group deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete group: ' + err.message });
  }
});

// DELETE /api/groups/:id/members/:userId — Remove a member from a group (admin/owner only)
router.delete('/:id/members/:userId', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  const targetUserId = parseInt(req.params.userId);
  const myUserId = req.session.userId;
  
  if (targetUserId === myUserId) {
    return res.status(400).json({ error: 'Cannot remove yourself.' });
  }

  try {
    const group = await db.get('SELECT created_by FROM groups WHERE id = ?', [groupId]);
    if (!group) return res.status(404).json({ error: 'Group not found.' });

    const myMember = await db.get(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, myUserId]
    );
    const isOwner = group.created_by === myUserId;
    const isAdmin = myMember && myMember.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Only admins or owners can remove members.' });
    }

    await db.run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, targetUserId]);
    res.json({ success: true, message: 'Member removed successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove member: ' + err.message });
  }
});

// POST /api/groups/:id/join - Join a group via link
router.post('/:id/join', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  const userId = req.session.userId;
  try {
    const group = await db.get('SELECT id FROM groups WHERE id = ?', [groupId]);
    if (!group) return res.status(404).json({ error: 'Group not found.' });

    const existing = await db.get('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, userId]);
    if (existing) {
      return res.json({ success: true, message: 'Already a member.' });
    }

    await db.run('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)', [groupId, userId, 'member']);
    res.json({ success: true, message: 'Joined group successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to join group: ' + err.message });
  }
});

module.exports = router;
