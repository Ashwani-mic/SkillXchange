// WebRTC socket handler: manages 1-on-1 and mesh group calling signaling, invites, and room lifecycle.
const db = require('../db');
const { onlineUsers, groupRooms } = require('./state');

async function rebuildParticipantsList(room) {
  const participantsList = [];
  // Host
  const host = await db.get('SELECT avatar_url FROM users WHERE id = ?', [room.hostId]);
  participantsList.push({
    userId: room.hostId,
    userName: room.hostName,
    avatarUrl: host ? host.avatar_url : null,
    status: 'host'
  });
  // Invited but not connected
  for (const u of room.invitedUsers) {
    if (u.id !== room.hostId) {
      const isConnected = Array.from(room.connectedUsers.values()).some(cu => cu.userId === u.id);
      if (!isConnected) {
        const user = await db.get('SELECT avatar_url FROM users WHERE id = ?', [u.id]);
        participantsList.push({
          userId: u.id,
          userName: u.name,
          avatarUrl: user ? user.avatar_url : null,
          status: 'invited'
        });
      }
    }
  }
  // Connected users (except host)
  for (const u of room.connectedUsers.values()) {
    if (u.userId !== room.hostId) {
      const user = await db.get('SELECT avatar_url FROM users WHERE id = ?', [u.userId]);
      participantsList.push({
        userId: u.userId,
        userName: u.userName,
        avatarUrl: user ? user.avatar_url : null,
        status: 'connected'
      });
    }
  }
  return participantsList;
}

function registerWebRTCHandlers(io, socket) {
  // WebRTC 1-on-1 Signaling
  socket.on('webrtc_offer', ({ offer, to }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId) return;
    io.to(`user_${to}`).emit('webrtc_offer', { offer, from: authenticatedUserId });
  });

  socket.on('webrtc_answer', ({ answer, to }) => {
    io.to(`user_${to}`).emit('webrtc_answer', { answer });
  });

  socket.on('webrtc_ice', ({ candidate, to }) => {
    io.to(`user_${to}`).emit('webrtc_ice', { candidate });
  });

  // WebRTC 1-on-1 Signaling Enhanced Flow
  socket.on('call_user', async ({ to, offer, senderName }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId) return;
    const targetUserId = parseInt(to);
    const recipientSocketId = onlineUsers.get(targetUserId);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('incoming_call', {
        callerId: authenticatedUserId,
        callerName: senderName,
        offer
      });
    }
  });

  socket.on('decline_call', async ({ to }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId) return;
    const targetUserId = parseInt(to);
    const recipientSocketId = onlineUsers.get(targetUserId);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('call_declined', { from: authenticatedUserId });
    }
    await db.saveCallLog(targetUserId, authenticatedUserId, 'direct', 'rejected');
  });

  socket.on('accept_call', async ({ to, answer }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId) return;
    const targetUserId = parseInt(to);
    const recipientSocketId = onlineUsers.get(targetUserId);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('call_accepted', { answer, from: authenticatedUserId });
    }
  });

  socket.on('hang_up', async ({ to, callerId, receiverId }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId) return;
    const targetUserId = parseInt(to);
    const recipientSocketId = onlineUsers.get(targetUserId);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('call_ended', { from: authenticatedUserId });
    }
    const finalCallerId = parseInt(callerId) || authenticatedUserId;
    const finalReceiverId = parseInt(receiverId) || targetUserId;
    await db.saveCallLog(finalCallerId, finalReceiverId, 'direct', 'completed');
  });

  socket.on('cancel_call', async ({ to }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId) return;
    const targetUserId = parseInt(to);
    const recipientSocketId = onlineUsers.get(targetUserId);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('call_cancelled', { from: authenticatedUserId });
    }
    await db.saveCallLog(authenticatedUserId, targetUserId, 'direct', 'missed');
  });

  // WebRTC Group Calling signaling (Mesh Network)
  socket.on('group_call_invite', async ({ roomId, invitedUsers, senderName }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId) return;

    console.log(`\n📞 [Group Call Invite] Room: ${roomId} | Initiator: ${senderName} (User ID: ${authenticatedUserId})`);
    console.log(`👥 Invited list:`, invitedUsers);

    const room = {
      hostId: authenticatedUserId,
      hostName: senderName,
      invitedUsers: invitedUsers.map(u => ({ id: parseInt(u.id), name: u.name })),
      connectedUsers: new Map()
    };
    groupRooms.set(roomId, room);

    invitedUsers.forEach(async (u) => {
      const id = parseInt(u.id);
      if (id === authenticatedUserId) return;
      const recipientSocketId = onlineUsers.get(id);
      if (recipientSocketId) {
        console.log(`✉️ Delivering incoming_group_call alert to User ${id} on socket ${recipientSocketId}`);
        io.to(recipientSocketId).emit('incoming_group_call', {
          roomId,
          callerId: authenticatedUserId,
          callerName: senderName,
          invitedUserIds: invitedUsers.map(usr => usr.id)
        });
      } else {
        console.log(`⚠️ User ${id} is offline. Inviting into missed call logs.`);
      }
      await db.saveCallLog(authenticatedUserId, id, 'group', 'missed');
    });
  });

  socket.on('join_group_room', async ({ roomId, userName }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId) return;
    socket.join(roomId);

    let room = groupRooms.get(roomId);
    if (!room) {
      room = {
        hostId: authenticatedUserId,
        hostName: userName,
        invitedUsers: [],
        connectedUsers: new Map()
      };
      groupRooms.set(roomId, room);
    }

    room.connectedUsers.set(socket.id, { userId: authenticatedUserId, userName });

    socket.to(roomId).emit('group_user_joined', {
      userId: authenticatedUserId,
      socketId: socket.id,
      userName
    });

    // Broadcast updated participants list to everyone in the room
    const participantsList = await rebuildParticipantsList(room);
    io.to(roomId).emit('group_participants_update', participantsList);
    console.log(`User ${authenticatedUserId} joined group room ${roomId} (socket: ${socket.id})`);
  });

  socket.on('group_signal', ({ toSocketId, signalData }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId) return;
    io.to(toSocketId).emit('group_signal', {
      fromSocketId: socket.id,
      fromUserId: authenticatedUserId,
      signalData
    });
  });

  socket.on('decline_group_call', async ({ initiatorId }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId) return;
    await db.saveCallLog(parseInt(initiatorId), authenticatedUserId, 'group', 'rejected');
  });

  socket.on('leave_group_room', async ({ roomId }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId) return;
    socket.leave(roomId);

    const room = groupRooms.get(roomId);
    if (room) {
      room.connectedUsers.delete(socket.id);
      const participantsList = await rebuildParticipantsList(room);
      io.to(roomId).emit('group_participants_update', participantsList);
    }

    socket.to(roomId).emit('group_user_left', {
      socketId: socket.id,
      userId: authenticatedUserId
    });
    console.log(`User ${authenticatedUserId} left group room ${roomId}`);
  });
}

module.exports = {
  registerWebRTCHandlers,
  rebuildParticipantsList
};
