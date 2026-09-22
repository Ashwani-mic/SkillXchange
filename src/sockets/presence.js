// Presence socket handler: manages session-verified user authentication, heartbeat tracking, and online/offline status.
const db = require('../db');
const { onlineUsers, groupRooms } = require('./state');

let heartbeatScannerStarted = false;

function initHeartbeatScanner(io) {
  if (heartbeatScannerStarted) return;
  heartbeatScannerStarted = true;

  // Proactive Heartbeat Scan: disconnect sockets inactive for >60s to prevent stale entries (especially on mobile)
  setInterval(() => {
    const now = Date.now();
    io.sockets.sockets.forEach(socket => {
      if (socket.authenticatedUserId) {
        const lastSeen = socket.lastSeen || now;
        if (now - lastSeen > 60000) {
          console.log(`Proactively disconnecting inactive socket ${socket.id} for user ${socket.authenticatedUserId} (missed heartbeat)`);
          socket.disconnect(true);
        }
      }
    });
  }, 10000);
}

function registerPresenceHandlers(io, socket, getParticipantsList) {
  initHeartbeatScanner(io);

  socket.on('authenticate', async (clientUserId) => {
    // Read user ID from session, with fallback to clientUserId if session handshake is delayed
    const sessionUserId = socket.request?.session?.userId;
    const authenticatedUserId = sessionUserId || parseInt(clientUserId, 10);
    if (!authenticatedUserId) {
      console.warn(`⚠️ Unauthenticated socket ${socket.id} attempted authenticate.`);
      return;
    }

    // Clean up any stale sockets previously mapped to this user to avoid presence desync
    const oldSocketId = onlineUsers.get(authenticatedUserId);
    if (oldSocketId && oldSocketId !== socket.id) {
      const oldSocket = io.sockets.sockets.get(oldSocketId);
      if (oldSocket) {
        console.log(`Forcefully disconnecting stale socket ${oldSocketId} for user ${authenticatedUserId}`);
        oldSocket.disconnect(true);
      }
    }

    socket.authenticatedUserId = authenticatedUserId;
    socket.lastSeen = Date.now();

    onlineUsers.set(authenticatedUserId, socket.id);
    socket.join(`user_${authenticatedUserId}`);
    
    // Instantly send list of online users to the newly connected user, respecting hide_last_seen preferences
    const me = await db.get('SELECT hide_last_seen FROM users WHERE id = ?', [authenticatedUserId]);
    const hideLastSeen = me ? me.hide_last_seen === 1 : false;

    const onlineIds = Array.from(onlineUsers.keys());
    const visibleOnlineUsers = [];
    for (const oId of onlineIds) {
      const u = await db.get('SELECT hide_last_seen FROM users WHERE id = ?', [oId]);
      if (!u || u.hide_last_seen !== 1 || oId === authenticatedUserId) {
        visibleOnlineUsers.push(oId);
      }
    }
    
    socket.emit('online_users_list', visibleOnlineUsers);
    
    if (!hideLastSeen) {
      socket.broadcast.emit('user_online', authenticatedUserId);
    }
    console.log(`User ${authenticatedUserId} connected (socket: ${socket.id})`);
  });

  socket.on('heartbeat', () => {
    socket.lastSeen = Date.now();
  });

  socket.on('disconnect', async () => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (authenticatedUserId) {
      if (onlineUsers.get(authenticatedUserId) === socket.id) {
        onlineUsers.delete(authenticatedUserId);
        
        const me = await db.get('SELECT hide_last_seen FROM users WHERE id = ?', [authenticatedUserId]);
        const hide = me && me.hide_last_seen === 1;
        if (!hide) {
          io.emit('user_offline', authenticatedUserId);
          await db.run('UPDATE users SET last_seen = ? WHERE id = ?', [new Date().toISOString(), authenticatedUserId]);
        }
        
        console.log(`User ${authenticatedUserId} disconnected`);
      }

      // Cleanup group rooms
      for (const [roomId, room] of groupRooms.entries()) {
        if (room.connectedUsers.has(socket.id)) {
          room.connectedUsers.delete(socket.id);
          if (getParticipantsList) {
            const participantsList = await getParticipantsList(room);
            io.to(roomId).emit('group_participants_update', participantsList);
          }
          socket.to(roomId).emit('group_user_left', {
            socketId: socket.id,
            userId: authenticatedUserId
          });
        }
      }
    }
  });
}

module.exports = registerPresenceHandlers;
