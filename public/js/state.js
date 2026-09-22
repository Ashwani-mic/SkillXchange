// Shared frontend state: manages application memory, active user, calls, messages queue, and UI helpers.
export const state = {
  currentUser: null,
  socket: null,
  currentView: 'landing',
  activeChat: { partnerId: null, partnerName: null, avatarUrl: null },
  currentActiveChatId: null,
  activeGroupsList: [],
  localStream: null,
  peerConnection: null,
  callTimer: null,
  callSeconds: 0,
  currentBookingPeer: null,
  currentReviewSession: null,
  isGroupCall: false,
  groupRoomId: null,
  activeCallPartnerId: null,
  activeUploadFile: null,
  activeUploadDataUrl: null,
  activeReplyMessageId: null,
  editMessageId: null,
  offlineMessageQueue: [],
  typingTimeout: null,
  isTyping: false,
  audioContext: null,
  audioAnalysers: {}, // socketId -> AnalyserNode
  screenShareTrack: null,
  networkStatsInterval: null,
  groupPeerConnections: {}, // socketId -> RTCPeerConnection
  groupParticipants: [], // array of { userId, socketId, userName, status }
  classroomGroupMembers: [], // array of candidates that can be invited
  onlineUserIdsSet: new Set(),
  globalIceQueue: [],
  groupIceQueues: {} // peerSocketId -> array of candidates
};

export const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.services.mozilla.com' },
    { 
      urls: 'turn:openrelay.metered.ca:80', 
      username: 'openrelayproject', 
      credential: 'openrelayproject' 
    },
    { 
      urls: 'turn:openrelay.metered.ca:443', 
      username: 'openrelayproject', 
      credential: 'openrelayproject' 
    },
    { 
      urls: 'turn:openrelay.metered.ca:443?transport=tcp', 
      username: 'openrelayproject', 
      credential: 'openrelayproject' 
    }
  ]
};

// ==================================================
//  DOM HELPERS
// ==================================================
export const el = id => document.getElementById(id);
export const show = id => el(id)?.classList.remove('hidden');
export const hide = id => el(id)?.classList.add('hidden');
export const qsa = sel => document.querySelectorAll(sel);

// ==================================================
//  TOAST NOTIFICATIONS
// ==================================================
export function toast(message, type = 'info', duration = 4000) {
  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
  const container = el('toast-container');
  if (!container) return;
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.innerHTML = `<i class="fa-solid ${icons[type] || icons.info} toast-icon"></i><span class="toast-msg">${message}</span>`;
  container.appendChild(div);
  setTimeout(() => {
    div.style.opacity = '0';
    div.style.transform = 'translateY(20px)';
    div.style.transition = 'all 0.3s ease';
    setTimeout(() => div.remove(), 300);
  }, duration);
}

// ==================================================
//  FORMATTING UTILS
// ==================================================
export function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function getMessagePreviewText(text) {
  if (text && text.startsWith('[FILE_JSON]:')) {
    try {
      const fileInfo = JSON.parse(text.slice(12));
      return fileInfo.type === 'image' ? '📷 Photo' : `📄 Document: ${fileInfo.fileName}`;
    } catch {
      return '📎 Attachment';
    }
  }
  return text || '';
}

// ==================================================
//  NOTIFICATIONS & VIBRATIONS
// ==================================================
let notificationFlashInterval = null;
const originalDocumentTitle = document.title;

if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    if (notificationFlashInterval) {
      clearInterval(notificationFlashInterval);
      notificationFlashInterval = null;
    }
    document.title = originalDocumentTitle;
  });
}

export function flashDocumentTitle(newTitle) {
  if (notificationFlashInterval) clearInterval(notificationFlashInterval);
  let showNew = true;
  notificationFlashInterval = setInterval(() => {
    document.title = showNew ? newTitle : originalDocumentTitle;
    showNew = !showNew;
  }, 1000);
}

export function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

export function triggerNewMessageNotification(senderName, messageText) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(`💬 Message from ${senderName}`, {
        body: messageText,
        icon: '/favicon.ico',
        tag: 'message'
      });
    } catch (e) {
      console.warn('Failed to send browser notification:', e);
    }
  }
  if (document.hidden) {
    flashDocumentTitle(`(1) New Message — ${originalDocumentTitle}`);
  }
}

export function triggerIncomingCallNotification(callerName, isGroup = false) {
  const title = isGroup ? `👥 Incoming Group Class` : `📞 Incoming Class Call`;
  const body = `${callerName} is calling you...`;

  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body: body,
        icon: '/favicon.ico',
        tag: 'call',
        requireInteraction: true
      });
    } catch (e) {
      console.warn('Failed to send call notification:', e);
    }
  }

  if (document.hidden) {
    flashDocumentTitle(`🚨 CALL FROM ${callerName.toUpperCase()} — ${originalDocumentTitle}`);
  }
}
