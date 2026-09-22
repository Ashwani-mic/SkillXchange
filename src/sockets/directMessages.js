// Direct messages socket handler: handles 1-on-1 chats, typing indicators, read receipts, reactions, and direct edit/delete.
const db = require('../db');
const { onlineUsers } = require('./state');

function registerDirectMessageHandlers(io, socket) {
  // Chat message
  socket.on('send_message', async ({ receiver_id, message, sender_name, reply_to_id = null }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId) return;
    const targetUserId = parseInt(receiver_id);
    const recipientSocketId = onlineUsers.get(targetUserId);
    const status = recipientSocketId ? 'delivered' : 'sent';
    
    let messageId = null;
    try {
      const result = await db.saveDirectMessage(authenticatedUserId, targetUserId, message.trim(), reply_to_id);
      messageId = result?.id;
      if (recipientSocketId && messageId) {
        await db.run('UPDATE messages SET status = \'delivered\' WHERE id = ?', [messageId]);
      }
    } catch (e) {
      console.error('Failed to commit message to PostgreSQL:', e.message);
    }

    const payload = {
      id: messageId,
      sender_id: authenticatedUserId,
      sender_name: sender_name,
      message: message.trim(),
      status,
      reply_to_id,
      timestamp: new Date().toISOString()
    };
    
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('receive_message', payload);
    }
    
    // Send status update back to the sender
    socket.emit('message_status_update', { id: messageId, status });
  });

  // Typing Indicators (Direct chat)
  socket.on('typing', ({ receiver_id, is_group = false }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId || is_group) return;
    const recipientSocketId = onlineUsers.get(parseInt(receiver_id));
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('user_typing', { sender_id: authenticatedUserId, username: socket.username || 'Someone' });
    }
  });

  socket.on('stop_typing', ({ receiver_id, is_group = false }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId || is_group) return;
    const recipientSocketId = onlineUsers.get(parseInt(receiver_id));
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('user_stop_typing', { sender_id: authenticatedUserId });
    }
  });

  // Mark direct messages as Read
  socket.on('mark_as_read', async ({ partner_id }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId) return;
    const pId = parseInt(partner_id);
    try {
      await db.run('UPDATE messages SET status = \'read\' WHERE sender_id = ? AND receiver_id = ? AND status != \'read\'', [pId, authenticatedUserId]);
      const partnerSocketId = onlineUsers.get(pId);
      if (partnerSocketId) {
        io.to(partnerSocketId).emit('messages_read_by_peer', { reader_id: authenticatedUserId });
      }
    } catch (err) {
      console.error('Failed to mark direct messages read:', err.message);
    }
  });

  // Direct Message Editing
  socket.on('edit_message', async ({ id, is_group, message }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId || is_group) return;
    const msgId = parseInt(id);
    try {
      const msg = await db.get('SELECT sender_id, receiver_id FROM messages WHERE id = ?', [msgId]);
      if (msg && msg.sender_id === authenticatedUserId) {
        const hasContent = db.getHasContentColumn ? db.getHasContentColumn() : db.hasContentColumn;
        if (hasContent) {
          await db.run('UPDATE messages SET content = ?, message = ?, message_text = ?, is_edited = 1 WHERE id = ?', [message.trim(), message.trim(), message.trim(), msgId]);
        } else {
          await db.run('UPDATE messages SET message = ?, message_text = ?, is_edited = 1 WHERE id = ?', [message.trim(), message.trim(), msgId]);
        }
        const partnerSocketId = onlineUsers.get(msg.receiver_id);
        if (partnerSocketId) {
          io.to(partnerSocketId).emit('message_edited', { id: msgId, is_group: false, message: message.trim() });
        }
        socket.emit('message_edited', { id: msgId, is_group: false, message: message.trim() });
      }
    } catch (err) {
      console.error('Failed to edit direct message:', err.message);
    }
  });

  // Direct Message Deleting (Delete for everyone)
  socket.on('delete_message', async ({ id, is_group }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId || is_group) return;
    const msgId = parseInt(id);
    try {
      const msg = await db.get('SELECT sender_id, receiver_id, timestamp FROM messages WHERE id = ?', [msgId]);
      if (msg && msg.sender_id === authenticatedUserId) {
        const timeDiff = (Date.now() - new Date(msg.timestamp).getTime()) / (1000 * 60);
        if (timeDiff <= 15) {
          const hasContent = db.getHasContentColumn ? db.getHasContentColumn() : db.hasContentColumn;
          if (hasContent) {
            await db.run('UPDATE messages SET content = \'This message was deleted\', message = \'This message was deleted\', message_text = \'This message was deleted\', is_deleted = 1 WHERE id = ?', [msgId]);
          } else {
            await db.run('UPDATE messages SET message = \'This message was deleted\', message_text = \'This message was deleted\', is_deleted = 1 WHERE id = ?', [msgId]);
          }
          const partnerSocketId = onlineUsers.get(msg.receiver_id);
          if (partnerSocketId) {
            io.to(partnerSocketId).emit('message_deleted', { id: msgId, is_group: false });
          }
          socket.emit('message_deleted', { id: msgId, is_group: false });
        } else {
          socket.emit('delete_error', 'Cannot delete message. The 15-minute window has expired.');
        }
      }
    } catch (err) {
      console.error('Failed to delete direct message:', err.message);
    }
  });

  // Direct Message Reactions
  socket.on('react_message', async ({ id, is_group, emoji }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId || is_group) return;
    const msgId = parseInt(id);
    try {
      const msg = await db.get('SELECT sender_id, receiver_id, reactions FROM messages WHERE id = ?', [msgId]);
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
        
        await db.run('UPDATE messages SET reactions = ? WHERE id = ?', [JSON.stringify(reactionsList), msgId]);
        
        const partnerSocketId = onlineUsers.get(msg.receiver_id);
        if (partnerSocketId) {
          io.to(partnerSocketId).emit('message_reacted', { id: msgId, is_group: false, reactions: reactionsList });
        }
        socket.emit('message_reacted', { id: msgId, is_group: false, reactions: reactionsList });
      }
    } catch (err) {
      console.error('Failed to react to direct message:', err.message);
    }
  });
}

module.exports = registerDirectMessageHandlers;
