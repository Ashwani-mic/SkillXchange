// Sockets state store: maintains in-memory tracking for online users and active group classroom rooms.
const onlineUsers = new Map(); // userId -> socketId
const groupRooms = new Map();  // roomId -> { hostId, hostName, invitedUsers, connectedUsers }

module.exports = {
  onlineUsers,
  groupRooms
};
