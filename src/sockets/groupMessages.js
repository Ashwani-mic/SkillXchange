// Group messages socket handler: manages realtime group chat broadcasts, receipts, group edits, deletions, and reactions.
const db = require('../db');
const { onlineUsers } = require('./state');

function registerGroupMessageHandlers(io, socket) {
  // Group Chat message
  socket.on('send_group_message', async ({ group_id, message, reply_to_id = null }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId) return;
    const gId = parseInt(group_id);

    try {
      const msgRes = await db.run(
        'INSERT INTO group_messages (group_id, sender_id, message, reply_to_id) VALUES (?, ?, ?, ?)',
        [gId, authenticatedUserId, message.trim(), reply_to_id]
      );
      const messageId = msgRes.id;

      const sender = await db.get('SELECT username, avatar_url FROM users WHERE id = ?', [authenticatedUserId]);

      const members = await db.all('SELECT user_id FROM group_members WHERE group_id = ?', [gId]);
      members.forEach(m => {
        const memberId = m.user_id;
        const socketId = onlineUsers.get(memberId);
        if (socketId) {
          io.to(socketId).emit('receive_group_message', {
            id: messageId,
            group_id: gId,
            sender_id: authenticatedUserId,
            sender_name: sender.username,
            sender_avatar: sender.avatar_url,
            message: message.trim(),
            reply_to_id,
            timestamp: new Date().toISOString()
          });
        }
      });
    } catch (e) {
      console.error('Failed to process group socket message:', e.message);
    }
  });

  // Group Typing Indicators
  socket.on('typing', ({ receiver_id, is_group = false }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId || !is_group) return;
    socket.to(`group_${receiver_id}`).emit('user_typing', { sender_id: authenticatedUserId, group_id: receiver_id, username: socket.username || 'Someone' });
  });

  socket.on('stop_typing', ({ receiver_id, is_group = false }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId || !is_group) return;
    socket.to(`group_${receiver_id}`).emit('user_stop_typing', { sender_id: authenticatedUserId, group_id: receiver_id });
  });

  // Mark group messages as Read
  socket.on('mark_group_as_read', async ({ group_id }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId) return;
    const gId = parseInt(group_id);
    try {
      const unreadMessages = await db.all(
        `SELECT gm.id FROM group_messages gm 
         LEFT JOIN group_message_receipts gmr ON gmr.message_id = gm.id AND gmr.user_id = ?
         WHERE gm.group_id = ? AND gm.sender_id != ? AND gmr.message_id IS NULL`,
        [authenticatedUserId, gId, authenticatedUserId]
      );
      for (const m of unreadMessages) {
        await db.run('INSERT INTO group_message_receipts (message_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [m.id, authenticatedUserId]);
      }
      
      const sender = await db.get('SELECT username FROM users WHERE id = ?', [authenticatedUserId]);
      const members = await db.all('SELECT user_id FROM group_members WHERE group_id = ?', [gId]);
      members.forEach(m => {
        const socketId = onlineUsers.get(m.user_id);
        if (socketId && m.user_id !== authenticatedUserId) {
          io.to(socketId).emit('group_messages_read_by_peer', { group_id: gId, reader_name: sender.username });
        }
      });
    } catch (err) {
      console.error('Failed to mark group messages read:', err.message);
    }
  });

  // Group Message Editing
  socket.on('edit_message', async ({ id, is_group, message }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId || !is_group) return;
    const msgId = parseInt(id);
    try {
      const msg = await db.get('SELECT sender_id, group_id FROM group_messages WHERE id = ?', [msgId]);
      if (msg && msg.sender_id === authenticatedUserId) {
        await db.run('UPDATE group_messages SET message = ?, is_edited = 1 WHERE id = ?', [message.trim(), msgId]);
        const members = await db.all('SELECT user_id FROM group_members WHERE group_id = ?', [msg.group_id]);
        members.forEach(m => {
          const socketId = onlineUsers.get(m.user_id);
          if (socketId) {
            io.to(socketId).emit('message_edited', { id: msgId, is_group: true, message: message.trim() });
          }
        });
      }
    } catch (err) {
      console.error('Failed to edit group message:', err.message);
    }
  });

  // Group Message Deleting
  socket.on('delete_message', async ({ id, is_group }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId || !is_group) return;
    const msgId = parseInt(id);
    try {
      const msg = await db.get('SELECT sender_id, group_id, created_at FROM group_messages WHERE id = ?', [msgId]);
      if (msg && msg.sender_id === authenticatedUserId) {
        const timeDiff = (Date.now() - new Date(msg.created_at).getTime()) / (1000 * 60);
        if (timeDiff <= 15) {
          await db.run('UPDATE group_messages SET message = \'This message was deleted\', is_deleted = 1 WHERE id = ?', [msgId]);
          const members = await db.all('SELECT user_id FROM group_members WHERE group_id = ?', [msg.group_id]);
          members.forEach(m => {
            const socketId = onlineUsers.get(m.user_id);
            if (socketId) {
              io.to(socketId).emit('message_deleted', { id: msgId, is_group: true });
            }
          });
        } else {
          socket.emit('delete_error', 'Cannot delete message. The 15-minute window has expired.');
        }
      }
    } catch (err) {
      console.error('Failed to delete group message:', err.message);
    }
  });

  // Group Message Reactions
  socket.on('react_message', async ({ id, is_group, emoji }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId || !is_group) return;
    const msgId = parseInt(id);
    try {
      const msg = await db.get('SELECT sender_id, group_id, reactions FROM group_messages WHERE id = ?', [msgId]);
      if (msg) {
        let reactionsList = [];
        try {
          reactionsList = JSON.parse(msg.reactions || '[]');
        } catch {}
        
        reactionsList = reactionsList.filter(r => r.user_id !== authenticatedUserId);
        if (emoji) {
          const userObj = await db.get('SELECT username FROM users WHERE id = ?', [authenticatedUserId]);
          reactionsList.push({ user_id: authenticatedUserId, emoji, username: userObj?.username || 'Someone' });
        }
        
        await db.run('UPDATE group_messages SET reactions = ? WHERE id = ?', [JSON.stringify(reactionsList), msgId]);
        
        const members = await db.all('SELECT user_id FROM group_members WHERE group_id = ?', [msg.group_id]);
        members.forEach(m => {
          const socketId = onlineUsers.get(m.user_id);
          if (socketId) {
            io.to(socketId).emit('message_reacted', { id: msgId, is_group: true, reactions: reactionsList });
          }
        });
      }
    } catch (err) {
      console.error('Failed to react to group message:', err.message);
    }
  });
}

module.exports = registerGroupMessageHandlers;
