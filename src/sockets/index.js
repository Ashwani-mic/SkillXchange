// Sockets index: registers Socket.IO connection lifecycle and binds presence, chat, WebRTC, and classroom handlers.
const registerPresenceHandlers = require('./presence');
const registerDirectMessageHandlers = require('./directMessages');
const registerGroupMessageHandlers = require('./groupMessages');
const { registerWebRTCHandlers, rebuildParticipantsList } = require('./webrtc');
const registerClassroomHandlers = require('./classroom');

function initSockets(io) {
  io.on('connection', socket => {
    registerPresenceHandlers(io, socket, rebuildParticipantsList);
    registerDirectMessageHandlers(io, socket);
    registerGroupMessageHandlers(io, socket);
    registerWebRTCHandlers(io, socket);
    registerClassroomHandlers(io, socket);
  });
}

module.exports = initSockets;
