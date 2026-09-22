// Classroom socket handler: synchronizes live code editor, whiteboard collaboration, hand raises, and host moderation.
const { groupRooms } = require('./state');
const { rebuildParticipantsList } = require('./webrtc');

function registerClassroomHandlers(io, socket) {
  // Raise Hand call signal
  socket.on('raise_hand', ({ roomId, is_raised }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId) return;
    socket.to(roomId).emit('peer_raise_hand', { socketId: socket.id, userId: authenticatedUserId, is_raised });
  });

  // Code editor collaboration
  socket.on('code_update', ({ code, to, userId }) => {
    io.to(`user_${to}`).emit('code_update', { code, userId });
  });

  // Whiteboard collaboration
  socket.on('whiteboard_update', ({ text, to, userId }) => {
    io.to(`user_${to}`).emit('whiteboard_update', { text, userId });
  });

  // Host moderation: kick participant
  socket.on('kick_participant', async ({ roomId, userId }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId) return;
    const room = groupRooms.get(roomId);
    if (room && room.hostId === authenticatedUserId) {
      let targetSocketId = null;
      for (const [sId, u] of room.connectedUsers.entries()) {
        if (u.userId === userId) {
          targetSocketId = sId;
          break;
        }
      }
      
      if (targetSocketId) {
        io.to(targetSocketId).emit('kicked_from_class');
        room.connectedUsers.delete(targetSocketId);
        
        const participantsList = await rebuildParticipantsList(room);
        io.to(roomId).emit('group_participants_update', participantsList);
        
        const targetSocket = io.sockets.sockets.get(targetSocketId);
        if (targetSocket) {
          targetSocket.leave(roomId);
        }
        io.to(roomId).emit('group_user_left', { socketId: targetSocketId, userId });
        console.log(`Host ${authenticatedUserId} kicked User ${userId} from room ${roomId}`);
      }
    }
  });

  // Host moderation: mute all participants
  socket.on('mute_all_participants', ({ roomId }) => {
    const authenticatedUserId = socket.authenticatedUserId;
    if (!authenticatedUserId) return;
    const room = groupRooms.get(roomId);
    if (room && room.hostId === authenticatedUserId) {
      socket.to(roomId).emit('force_mute_mic');
      console.log(`Host ${authenticatedUserId} muted all participants in room ${roomId}`);
    }
  });
}

module.exports = registerClassroomHandlers;
