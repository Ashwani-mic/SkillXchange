/* =====================================================
   SKILLXCHANGE — Full Interactive Frontend Application
   ===================================================== */
'use strict';

// ==================================================
//  GLOBAL STATE
// ==================================================
let currentUser = null;
let socket = null;
let activeChat = { partnerId: null, partnerName: null };
let localStream = null;
let peerConnection = null;
let callTimer = null;
let callSeconds = 0;
let currentBookingPeer = null;
let currentReviewSession = null;
let isGroupCall = false;
let groupRoomId = null;
let activeCallPartnerId = null;
let activeUploadFile = null;
let activeUploadDataUrl = null;
let activeReplyMessageId = null;
let editMessageId = null;
let offlineMessageQueue = [];
let typingTimeout = null;
let isTyping = false;
let audioContext = null;
let audioAnalysers = {}; // socketId -> AnalyserNode
let screenShareTrack = null;
let groupPeerConnections = {}; // socketId -> RTCPeerConnection
let groupParticipants = []; // array of { userId, socketId, userName, status }
let classroomGroupMembers = []; // array of candidates that can be invited
const onlineUserIdsSet = new Set();

// WebRTC ICE Candidate Queues to prevent race conditions during signaling
let globalIceQueue = [];
let groupIceQueues = {}; // peerSocketId -> array of candidates

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.services.mozilla.com' },
    // Free public TURN servers from the Open Relay Project (Metered.ca) for dev/testing.
    // NOTE: In production, you should generate/fetch dynamic custom TURN credentials (e.g. from Twilio or Xirsys) via secure backend APIs.
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
const el = id => document.getElementById(id);
const show = id => el(id)?.classList.remove('hidden');
const hide = id => el(id)?.classList.add('hidden');
const qsa = sel => document.querySelectorAll(sel);

// ==================================================
//  TOAST NOTIFICATIONS
// ==================================================
function toast(message, type = 'info', duration = 4000) {
  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
  const container = el('toast-container');
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
//  NOTIFICATIONS & VIBRATIONS
// ==================================================
let notificationFlashInterval = null;
const originalDocumentTitle = document.title;

// Clear document title flashing when tab gets focus
window.addEventListener('focus', () => {
  if (notificationFlashInterval) {
    clearInterval(notificationFlashInterval);
    notificationFlashInterval = null;
  }
  document.title = originalDocumentTitle;
});

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function triggerNewMessageNotification(senderName, messageText) {
  // 1. Send browser Notification
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

  // 2. Vibrate on mobile (short vibration for messages)
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate([100]);
    } catch (e) {}
  }

  // 3. Flash document title if hidden
  if (document.hidden) {
    flashDocumentTitle(`(1) New Message — ${originalDocumentTitle}`);
  }
}

function triggerIncomingCallNotification(callerName, isGroup = false) {
  const title = isGroup ? `👥 Incoming Group Class` : `📞 Incoming Class Call`;
  const body = `${callerName} is calling you...`;

  // 1. Send browser Notification
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body: body,
        icon: '/favicon.ico',
        tag: 'call',
        requireInteraction: true // Keep active until action
      });
    } catch (e) {
      console.warn('Failed to send call notification:', e);
    }
  }

  // 2. Vibrate on mobile (repeating vibration pattern for calls)
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate([500, 250, 500, 250, 500]);
    } catch (e) {}
  }

  // 3. Flash document title if hidden
  if (document.hidden) {
    flashDocumentTitle(`🚨 CALL FROM ${callerName.toUpperCase()} — ${originalDocumentTitle}`);
  }
}

function flashDocumentTitle(newTitle) {
  if (notificationFlashInterval) clearInterval(notificationFlashInterval);
  let showNew = true;
  notificationFlashInterval = setInterval(() => {
    document.title = showNew ? newTitle : originalDocumentTitle;
    showNew = !showNew;
  }, 1000);
}

// ==================================================
//  API HELPERS
// ==================================================
async function api(method, endpoint, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include'
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(endpoint, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ==================================================
//  LANDING PAGE
// ==================================================
function initLanding() {
  // Animated stat counters
  const counters = document.querySelectorAll('.stat-num[data-count]');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        observer.unobserve(entry.target);
      }
    });
  });
  counters.forEach(c => observer.observe(c));

  el('nav-login-btn')?.addEventListener('click', () => openAuthModal('login'));
  el('nav-signup-btn')?.addEventListener('click', () => openAuthModal('signup'));
  el('hero-start-btn')?.addEventListener('click', () => openAuthModal('signup'));
  el('hero-login-btn')?.addEventListener('click', () => openAuthModal('login'));
  el('cta-start-btn')?.addEventListener('click', () => openAuthModal('signup'));
}

function animateCounter(el) {
  const target = parseInt(el.dataset.count);
  const duration = 2000;
  const step = target / (duration / 16);
  let current = 0;
  const timer = setInterval(() => {
    current += step;
    if (current >= target) { el.textContent = target.toLocaleString(); clearInterval(timer); }
    else el.textContent = Math.floor(current).toLocaleString();
  }, 16);
}

// ==================================================
//  AUTH MODAL
// ==================================================
function openAuthModal(tab = 'login') {
  show('auth-modal');
  if (tab === 'signup') {
    hide('login-form'); el('login-form').classList.remove('active');
    el('signup-form').classList.add('active'); show('signup-form');
  } else {
    hide('signup-form'); el('signup-form').classList.remove('active');
    el('login-form').classList.add('active'); show('login-form');
  }
  hide('auth-error');
  hide('auth-loading');
}

function closeAuthModal() {
  hide('auth-modal');
}

function initAuthModal() {
  el('auth-modal-close')?.addEventListener('click', closeAuthModal);
  el('auth-modal')?.addEventListener('click', e => { if (e.target === el('auth-modal')) closeAuthModal(); });
  el('to-signup')?.addEventListener('click', e => { e.preventDefault(); openAuthModal('signup'); });
  el('to-login')?.addEventListener('click', e => { e.preventDefault(); openAuthModal('login'); });

  el('login-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    hide('auth-error');
    show('auth-loading');
    try {
      const data = await api('POST', '/api/auth/login', {
        username: el('login-username').value.trim(),
        password: el('login-password').value
      });
      currentUser = data.user;
      closeAuthModal();
      launchApp();
    } catch (err) {
      el('auth-error').textContent = err.message;
      show('auth-error');
    } finally { hide('auth-loading'); }
  });

  el('signup-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    hide('auth-error');
    show('auth-loading');
    try {
      const data = await api('POST', '/api/auth/register', {
        username: el('signup-username').value.trim(),
        fullname: el('signup-fullname').value.trim(),
        email: el('signup-email').value.trim(),
        password: el('signup-password').value,
        bio: el('signup-bio').value.trim()
      });
      currentUser = data.user;
      closeAuthModal();
      launchApp();
    } catch (err) {
      el('auth-error').textContent = err.message;
      show('auth-error');
    } finally { hide('auth-loading'); }
  });
}

// ==================================================
//  APP LAUNCH
// ==================================================
function launchApp() {
  hide('landing-view');
  show('app-view');
  el('app-view').classList.remove('hidden');
  requestNotificationPermission();
  updateHeaderUser();
  initSocketIO();
  initNavTabs();
  initSkillsPanel();
  initMatchTabs();
  initExplorePage();
  initSessionsPage();
  initProfilePage();
  initChatPanel();
  initChatsPage();
  initAIPanel();
  initCallUI();
  initModals();
  switchTab('dashboard');
  loadDashboard();
  loadCallHistory();
  el('refresh-calls-btn')?.addEventListener('click', loadCallHistory);
}

// ==================================================
//  SOCKET.IO
// ==================================================
function initSocketIO() {
  socket = io();
  let heartbeatInterval = null;

  socket.on('connect', () => {
    // 1. Re-authenticate upon connection/reconnection to sync server state
    socket.emit('authenticate', currentUser.id);
    
    // 2. Start heartbeat pinging every 25 seconds
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      if (socket && socket.connected) {
        socket.emit('heartbeat');
      }
    }, 25000);
  });

  socket.on('disconnect', () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  });

  socket.on('online_users_list', userIds => {
    // Reset and reconcile presence state upon reconnection to prevent desync
    onlineUserIdsSet.forEach(userId => {
      updateUserPresenceUI(userId, false);
    });
    onlineUserIdsSet.clear();

    userIds.forEach(id => {
      const userId = parseInt(id);
      onlineUserIdsSet.add(userId);
      updateUserPresenceUI(userId, true);
    });
  });

  socket.on('receive_message', msg => {
    const isActiveTab = (activeChat.partnerId === msg.sender_id) || (currentActiveChatId === msg.sender_id);
    if (isActiveTab) {
      socket.emit('mark_as_read', { partner_id: msg.sender_id });
    }

    const logEl = el('chats-messages-log');
    const isChatsTabActive = (currentActiveChatId === msg.sender_id);
    if (logEl && isChatsTabActive) {
      if (msg.is_call_log) {
        appendChatMessageToElement(logEl, msg.message, msg.sender_id === currentUser.id ? 'outgoing call-log' : 'incoming call-log');
      } else {
        appendChatMessageToElement(logEl, msg.message, 'incoming', null, msg.id, msg.status, msg.reply_to_id, msg.reactions);
      }
    } else {
      if (!msg.is_call_log) {
        const preview = getMessagePreviewText(msg.message);
        toast(`💬 ${msg.sender_name}: ${preview.slice(0, 50)}${preview.length > 50 ? '...' : ''}`, 'info');
      }
    }

    if (!msg.is_call_log && (document.hidden || !isActiveTab)) {
      triggerNewMessageNotification(msg.sender_name, getMessagePreviewText(msg.message));
    }
  });

  socket.on('message_status_update', ({ id, status }) => {
    const bubble = document.querySelector(`.msg-bubble[data-msg-id="${id}"]`);
    if (bubble) {
      updateBubbleStatusUI(bubble, status);
    }
  });

  socket.on('messages_read_by_peer', ({ reader_id }) => {
    if (currentActiveChatId === reader_id) {
      document.querySelectorAll('.msg-bubble.outgoing .msg-status-tick').forEach(tick => {
        tick.className = 'fa-solid fa-check-double msg-status-tick';
        tick.style.color = '#3b82f6';
      });
    }
  });

  socket.on('user_typing', ({ sender_id, group_id, username }) => {
    if (group_id) {
      if (currentActiveChatId === `group_${group_id}`) {
        const headerStatus = el('chats-header-status');
        if (headerStatus) {
          headerStatus.innerHTML = `${username} is typing<span class="typing-dot">.</span><span class="typing-dot">.</span><span class="typing-dot">.</span>`;
        }
      }
    } else {
      if (currentActiveChatId === sender_id) {
        const headerStatus = el('chats-header-status');
        if (headerStatus) {
          headerStatus.innerHTML = `typing<span class="typing-dot">.</span><span class="typing-dot">.</span><span class="typing-dot">.</span>`;
        }
      }
      const userItemMessage = document.querySelector(`.chat-item[data-user-id="${sender_id}"] .chat-item-message`);
      if (userItemMessage) {
        userItemMessage.textContent = 'typing...';
        userItemMessage.style.color = 'var(--accent)';
      }
    }
  });

  socket.on('user_stop_typing', ({ sender_id, group_id }) => {
    const headerStatus = el('chats-header-status');
    if (group_id) {
      if (currentActiveChatId === `group_${group_id}`) {
        if (headerStatus) headerStatus.textContent = 'Group Chat';
      }
    } else {
      if (currentActiveChatId === sender_id) {
        const isOnline = onlineUserIdsSet.has(sender_id);
        if (headerStatus) {
          headerStatus.textContent = isOnline ? 'online' : 'offline';
        }
      }
      loadChatsPage();
    }
  });

  socket.on('message_edited', ({ id, is_group, message }) => {
    const bubble = document.querySelector(`.msg-bubble[data-msg-id="${id}"]`);
    if (bubble) {
      const textEl = bubble.querySelector('.msg-text-content') || bubble;
      const nameSpan = textEl.querySelector('span');
      textEl.innerHTML = '';
      if (nameSpan) textEl.appendChild(nameSpan);
      textEl.appendChild(document.createTextNode(message));
      
      let editedLabel = bubble.querySelector('.msg-edited-label');
      if (!editedLabel) {
        editedLabel = document.createElement('span');
        editedLabel.className = 'msg-edited-label';
        editedLabel.style.cssText = 'font-size: 0.65rem; color: var(--text-muted); margin-left: 6px; font-style: italic;';
        editedLabel.textContent = '(edited)';
        bubble.appendChild(editedLabel);
      }
    }
  });

  socket.on('message_deleted', ({ id }) => {
    const bubble = document.querySelector(`.msg-bubble[data-msg-id="${id}"]`);
    if (bubble) {
      const textEl = bubble.querySelector('.msg-text-content') || bubble;
      const nameSpan = textEl.querySelector('span');
      textEl.innerHTML = '';
      if (nameSpan) textEl.appendChild(nameSpan);
      
      const deletedSpan = document.createElement('span');
      deletedSpan.style.cssText = 'color: var(--text-muted); font-style: italic; font-size: 0.85rem; display: flex; align-items: center; gap: 4px;';
      deletedSpan.innerHTML = '<i class="fa-solid fa-ban" style="font-size: 0.75rem;"></i> This message was deleted';
      textEl.appendChild(deletedSpan);
      
      const actions = bubble.querySelector('.msg-action-btn');
      if (actions) actions.remove();
    }
  });

  socket.on('message_reacted', ({ id, reactions }) => {
    const bubble = document.querySelector(`.msg-bubble[data-msg-id="${id}"]`);
    if (bubble) {
      renderBubbleReactions(bubble, id, reactions);
    }
  });

  socket.on('peer_raise_hand', ({ socketId, userId, is_raised }) => {
    const feed = el(`feed_${socketId}`) || el('feed_local');
    if (feed) {
      let hand = feed.querySelector('.raise-hand-overlay');
      if (is_raised) {
        if (!hand) {
          hand = document.createElement('div');
          hand.className = 'raise-hand-overlay';
          hand.innerHTML = '✋';
          feed.appendChild(hand);
        }
      } else {
        if (hand) hand.remove();
      }
    }
  });

  socket.on('kicked_from_class', () => {
    toast('You have been removed from the classroom by the host.', 'error');
    endCall();
  });

  socket.on('user_online', userId => {
    userId = parseInt(userId);
    onlineUserIdsSet.add(userId);
    updateUserPresenceUI(userId, true);
  });

  socket.on('user_offline', userId => {
    userId = parseInt(userId);
    onlineUserIdsSet.delete(userId);
    updateUserPresenceUI(userId, false);
  });

  socket.on('code_update', ({ code, userId }) => {
    if (userId !== currentUser.id) {
      const ta = el('code-editor-text');
      if (ta && document.activeElement !== ta) ta.value = code;
    }
  });

  socket.on('whiteboard_update', ({ text, userId }) => {
    if (userId !== currentUser.id) {
      const ta = el('whiteboard-text');
      if (ta && document.activeElement !== ta) ta.value = text;
    }
  });

  // WebRTC signaling (legacy fallback)
  socket.on('webrtc_offer', async ({ offer, from }) => {
    if (!peerConnection) initPeerConnection(from);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('webrtc_answer', { answer, to: from });
  });

  socket.on('webrtc_answer', async ({ answer }) => {
    if (peerConnection) {
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        await drainIceQueue(peerConnection);
      } catch (e) {
        console.error('Failed to set remote description answer:', e);
      }
    }
  });

  socket.on('webrtc_ice', async ({ candidate }) => {
    if (peerConnection) {
      await addIceCandidateSafely(peerConnection, candidate);
    } else {
      globalIceQueue.push(candidate);
      console.log("Cached ICE candidate in global queue:", candidate);
    }
  });

  // WebRTC 1-on-1 Signaling Enhanced Flow
  socket.on('incoming_call', ({ callerId, callerName, offer }) => {
    triggerIncomingCallNotification(callerName, false);
    show('incoming-call-modal');
    el('incoming-call-title').textContent = 'Incoming Class Call';
    el('incoming-call-msg').textContent = `${callerName} is inviting you to a live 1-on-1 session.`;
    
    el('accept-call-btn').onclick = async () => {
      if ('vibrate' in navigator) navigator.vibrate(0);
      hide('incoming-call-modal');
      await acceptDirectCall(callerId, callerName, offer);
    };
    
    el('decline-call-btn').onclick = () => {
      if ('vibrate' in navigator) navigator.vibrate(0);
      hide('incoming-call-modal');
      socket.emit('decline_call', { to: callerId });
    };
  });

  socket.on('call_declined', () => {
    toast('Call declined by peer.', 'warning');
    endCallLocal();
  });

  socket.on('call_accepted', async ({ answer }) => {
    toast('Call accepted! Connecting...', 'success');
    if (peerConnection) {
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        await drainIceQueue(peerConnection);
      } catch (e) {
        console.error('Failed to set remote description answer:', e);
      }
    }
  });

  socket.on('call_ended', () => {
    toast('Call ended by peer.', 'info');
    endCallLocal();
  });

  socket.on('call_cancelled', () => {
    if ('vibrate' in navigator) navigator.vibrate(0);
    hide('incoming-call-modal');
    toast('Call cancelled by caller.', 'info');
    endCallLocal();
  });

  // WebRTC Group Calling Signaling (Mesh Network)
  socket.on('incoming_group_call', ({ roomId, callerId, callerName, invitedUserIds }) => {
    triggerIncomingCallNotification(callerName, true);
    show('incoming-call-modal');
    el('incoming-call-title').textContent = 'Incoming Group Call';
    el('incoming-call-msg').textContent = `${callerName} is inviting you to a Group Classroom.`;
    
    el('accept-call-btn').onclick = async () => {
      if ('vibrate' in navigator) navigator.vibrate(0);
      hide('incoming-call-modal');
      await joinGroupCall(roomId, callerName);
    };
    
    el('decline-call-btn').onclick = () => {
      if ('vibrate' in navigator) navigator.vibrate(0);
      hide('incoming-call-modal');
      socket.emit('decline_group_call', { initiatorId: callerId });
    };
  });

  socket.on('group_user_joined', async ({ userId, socketId, userName }) => {
    toast(`👋 ${userName} joined the class!`, 'success');
    const pc = createGroupPeerConnection(socketId, userId, userName, true);
    groupPeerConnections[socketId] = pc;
    
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('group_signal', { 
        toSocketId: socketId, 
        signalData: { 
          type: 'offer', 
          offer,
          senderName: currentUser.fullname || currentUser.username
        } 
      });
    } catch (e) {
      console.error('Failed to create offer for new peer:', e);
    }
  });

  socket.on('group_signal', async ({ fromSocketId, fromUserId, signalData }) => {
    if (signalData.type === 'offer') {
      const pc = createGroupPeerConnection(fromSocketId, fromUserId, signalData.senderName || 'Peer', false);
      groupPeerConnections[fromSocketId] = pc;
      
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(signalData.offer));
        await drainIceQueue(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('group_signal', { 
          toSocketId: fromSocketId, 
          signalData: { 
            type: 'answer', 
            answer,
            senderName: currentUser.fullname || currentUser.username
          } 
        });
      } catch (e) {
        console.error('Failed to handle group offer:', e);
      }
    } else if (signalData.type === 'answer') {
      const pc = groupPeerConnections[fromSocketId];
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(signalData.answer));
          await drainIceQueue(pc);
        } catch (e) {
          console.error('Failed to set remote description answer:', e);
        }
      }
    } else if (signalData.type === 'ice-candidate') {
      const pc = groupPeerConnections[fromSocketId];
      if (pc) {
        await addIceCandidateSafely(pc, signalData.candidate);
      } else {
        if (!groupIceQueues[fromSocketId]) groupIceQueues[fromSocketId] = [];
        groupIceQueues[fromSocketId].push(signalData.candidate);
      }
    }
  });

  socket.on('group_user_left', ({ socketId, userId }) => {
    if (groupPeerConnections[socketId]) {
      groupPeerConnections[socketId].close();
      delete groupPeerConnections[socketId];
    }
    el(`feed_${socketId}`)?.remove();
    updateVideoGridLayout();
  });

  socket.on('group_participants_update', (participants) => {
    groupParticipants = participants;
    updateGroupParticipantsList();
  });

  socket.on('receive_group_message', msg => {
    // If the active chat in the Chats tab matches this group
    const logEl = el('chats-messages-log');
    const isGroupTabActive = (currentActiveChatId === `group_${msg.group_id}`);
    
    if (logEl && isGroupTabActive) {
      appendChatMessageToElement(logEl, msg.message, msg.sender_id === currentUser.id ? 'outgoing' : 'incoming', msg.sender_name);
    } else {
      const preview = getMessagePreviewText(msg.message);
      toast(`👥 [${msg.sender_name} in Group]: ${preview.slice(0, 50)}${preview.length > 50 ? '...' : ''}`, 'info');
      if (document.hidden) {
        triggerNewMessageNotification(`Group message from ${msg.sender_name}`, preview);
      }
    }
  });
}

function updateUserPresenceUI(userId, isOnline) {
  userId = parseInt(userId);
  
  // 1. Update active chat partner status in the chat header
  if (activeChat.partnerId === userId) {
    const statusDot = el('chats-header-status');
    if (statusDot) {
      statusDot.textContent = isOnline ? 'online' : 'offline';
      statusDot.className = 'online-dot ' + (isOnline ? 'online' : 'offline');
    }
  }
  
  // 2. Update peer profile modal status if open
  if (el('peer-profile-modal') && !el('peer-profile-modal').classList.contains('hidden')) {
    const modalChatBtn = el('modal-chat-btn');
    if (modalChatBtn && parseInt(modalChatBtn.dataset.id) === userId) {
      const statusDot = el('modal-peer-status');
      if (statusDot) {
        statusDot.textContent = isOnline ? 'online' : 'offline';
        statusDot.className = 'online-dot ' + (isOnline ? 'online' : 'offline');
      }
    }
  }
  
  // 3. Update Discover page peer cards
  const userCards = qsa('.peer-card');
  userCards.forEach(card => {
    const viewBtn = card.querySelector('[data-action="profile"]');
    if (viewBtn && parseInt(viewBtn.dataset.id) === userId) {
      let badge = card.querySelector('.match-badge');
      if (badge) {
        badge.style.border = isOnline ? '1px solid var(--success)' : '';
        badge.innerHTML = isOnline ? '🟢 Online' : (badge.classList.contains('perfect') ? '⚡ Perfect Match' : badge.classList.contains('partial') ? '🤝 Partial Match' : '👤 Peer');
      }
    }
  });

  // 4. Update Chat list (left sidebar)
  const chatItem = document.querySelector(`.chat-item[data-user-id="${userId}"]`);
  if (chatItem) {
    const dot = chatItem.querySelector('.status-only-dot');
    if (dot) {
      dot.className = `status-only-dot ${isOnline ? 'online' : 'offline'}`;
    }
  }

  // 5. Update Group Members list inside the active chat if it exists
  const groupMemberDot = document.querySelector(`.member-online-dot[data-user-id="${userId}"]`);
  if (groupMemberDot) {
    const dotColor  = isOnline ? '#10b981' : '#475569';
    const dotShadow = isOnline ? 'box-shadow: 0 0 5px #10b981;' : 'box-shadow: none;';
    groupMemberDot.style.background = dotColor;
    groupMemberDot.style.boxShadow = dotShadow;
  }

  // 6. Update Classroom Candidates / invite list
  if (isGroupCall && groupRoomId) {
    updateGroupParticipantsList();
  }
}

// ==================================================
//  HEADER & NAVIGATION
// ==================================================
function updateHeaderUser() {
  if (!currentUser) return;
  el('header-username').textContent = currentUser.username;
  el('header-avatar').innerHTML = currentUser.avatar_url
    ? `<img src="${currentUser.avatar_url}" alt="avatar">`
    : `<i class="fa-solid fa-user"></i>`;
  el('welcome-name').textContent = currentUser.fullname || currentUser.username;
  el('credits-count').textContent = currentUser.credits || 5;
  el('dropdown-fullname').textContent = currentUser.fullname || currentUser.username;
  el('dropdown-rating').textContent = parseFloat(currentUser.average_rating || 0).toFixed(1);
}

function initNavTabs() {
  qsa('.header-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      qsa('.header-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      switchTab(btn.dataset.tab);
    });
  });

  // User dropdown
  el('header-user-pill')?.addEventListener('click', e => {
    e.stopPropagation();
    el('user-dropdown')?.classList.toggle('hidden');
  });
  document.addEventListener('click', () => el('user-dropdown')?.classList.add('hidden'));

  el('logout-btn')?.addEventListener('click', async () => {
    try {
      await api('POST', '/api/auth/logout');
      currentUser = null;
      if (socket) socket.disconnect();
      hide('app-view');
      show('landing-view');
      toast('Logged out successfully.', 'info');
    } catch {}
  });

  el('dropdown-profile-btn')?.addEventListener('click', () => {
    el('user-dropdown')?.classList.add('hidden');
    switchTab('profile');
    qsa('.header-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'profile'));
  });
}

function switchTab(tabName) {
  qsa('.tab-section').forEach(s => s.classList.remove('active'));
  el(`tab-${tabName}`)?.classList.add('active');
  if (tabName === 'chats') loadChatsPage();
  if (tabName === 'explore') loadExplorePeers();
  if (tabName === 'sessions') loadSessions();
  if (tabName === 'profile') loadProfile();
}

// ==================================================
//  DASHBOARD
// ==================================================
async function loadDashboard() {
  await loadMySkills();
  await loadMatches();
}

// ==================================================
//  SKILLS PANEL
// ==================================================
function initSkillsPanel() {
  el('add-skill-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = el('add-skill-submit-btn');
    if (btn) btn.disabled = true;
    hide('skill-error');
    const skillName = el('skill-name').value;
    const skillType = el('skill-type').value;
    const proficiency = el('skill-proficiency').value;

    if (!skillName) {
      el('skill-error').textContent = 'Please select a skill.';
      show('skill-error');
      if (btn) btn.disabled = false;
      return;
    }

    try {
      await api('POST', '/api/skills', { skill_name: skillName, skill_type: skillType, proficiency_level: proficiency });
      toast(`✅ "${skillName}" added to your ${skillType === 'teach' ? 'teaching' : 'learning'} list!`, 'success');
      el('skill-name').value = '';
      await loadMySkills();
      await loadMatches();
    } catch (err) {
      el('skill-error').textContent = err.message;
      show('skill-error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  el('onboarding-warning-btn')?.addEventListener('click', () => {
    el('skills-card-anchor')?.scrollIntoView({ behavior: 'smooth' });
  });

  // AI Extract Skills Button (Dashboard)
  el('ai-extract-skills-btn')?.addEventListener('click', async () => {
    const btn = el('ai-extract-skills-btn');
    const bioText = currentUser.bio || '';
    if (!bioText.trim()) {
      toast('Please write a bio in your Profile settings first so we can suggest skills!', 'warning');
      return;
    }
    await extractSkillsHelper(btn, bioText);
  });

  // AI Extract Skills Button (Profile Page)
  el('profile-ai-extract-btn')?.addEventListener('click', async () => {
    const btn = el('profile-ai-extract-btn');
    const bioText = el('profile-bio')?.value.trim() || '';
    if (!bioText) {
      toast('Please write a bio first so we can suggest skills!', 'warning');
      return;
    }
    await extractSkillsHelper(btn, bioText);
  });

  // Close AI suggestions panel
  el('close-ai-suggestions-btn')?.addEventListener('click', () => {
    hide('ai-suggestions-container');
  });
}

async function extractSkillsHelper(btn, bioText) {
  const originalHTML = btn.innerHTML;
  try {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Extracting...`;
    const data = await api('POST', '/api/ai/extract-tags', { bio: bioText });
    
    // Render the suggestions
    renderSuggestions(data);
    
    // If not already on dashboard, redirect there so user can see it
    if (el('dashboard').classList.contains('hidden')) {
      switchTab('dashboard');
      qsa('.header-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'dashboard'));
    }
    
    el('skills-card-anchor')?.scrollIntoView({ behavior: 'smooth' });
    toast('✨ AI suggestions generated!', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}

function renderSuggestions(data) {
  const container = el('ai-suggestions-container');
  const list = el('ai-suggestions-list');
  if (!container || !list) return;

  list.innerHTML = '';
  
  // Get all unique suggested skills
  const tags = [...new Set([...(data.teach || []), ...(data.learn || [])])].filter(Boolean);
  
  if (!tags.length) {
    list.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-muted);">No skills detected in your bio. Try adding some action words!</div>';
    container.classList.remove('hidden');
    return;
  }

  tags.forEach(tag => {
    // 1. Create Teach Pill
    const teachPill = document.createElement('button');
    teachPill.type = 'button';
    teachPill.style.cssText = 'font-size: 0.75rem; padding: 6px 12px; border-radius: 50px; background: rgba(139,92,246,0.08); border: 1px solid rgba(139,92,246,0.3); color: var(--primary-light); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: all 0.2s;';
    teachPill.innerHTML = `<i class="fa-solid fa-graduation-cap"></i> Teach ${tag}`;
    
    teachPill.onmouseenter = () => { teachPill.style.background = 'rgba(139,92,246,0.18)'; };
    teachPill.onmouseleave = () => { teachPill.style.background = 'rgba(139,92,246,0.08)'; };

    teachPill.addEventListener('click', async () => {
      try {
        teachPill.disabled = true;
        await api('POST', '/api/skills', { skill_name: tag, skill_type: 'teach', proficiency_level: 'intermediate' });
        toast(`✅ "${tag}" added to your teaching list!`, 'success');
        await loadMySkills();
        await loadMatches();
        teachPill.remove();
        learnPill.remove();
        if (list.children.length === 0) {
          hide('ai-suggestions-container');
        }
      } catch (err) {
        toast(err.message, 'error');
        teachPill.disabled = false;
      }
    });

    // 2. Create Learn Pill
    const learnPill = document.createElement('button');
    learnPill.type = 'button';
    learnPill.style.cssText = 'font-size: 0.75rem; padding: 6px 12px; border-radius: 50px; background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.3); color: var(--emerald-light); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: all 0.2s;';
    learnPill.innerHTML = `<i class="fa-solid fa-book-open"></i> Learn ${tag}`;
    
    learnPill.onmouseenter = () => { learnPill.style.background = 'rgba(16,185,129,0.18)'; };
    learnPill.onmouseleave = () => { learnPill.style.background = 'rgba(16,185,129,0.08)'; };

    learnPill.addEventListener('click', async () => {
      try {
        learnPill.disabled = true;
        await api('POST', '/api/skills', { skill_name: tag, skill_type: 'learn', proficiency_level: 'beginner' });
        toast(`✅ "${tag}" added to your learning list!`, 'success');
        await loadMySkills();
        await loadMatches();
        teachPill.remove();
        learnPill.remove();
        if (list.children.length === 0) {
          hide('ai-suggestions-container');
        }
      } catch (err) {
        toast(err.message, 'error');
        learnPill.disabled = false;
      }
    });

    list.appendChild(teachPill);
    list.appendChild(learnPill);
  });

  container.classList.remove('hidden');
}

async function loadMySkills() {
  try {
    const data = await api('GET', '/api/skills/me');
    const teachList = el('teach-skills-list');
    const learnList = el('learn-skills-list');
    const teachSkills = data.skills.filter(s => s.skill_type === 'teach');
    const learnSkills = data.skills.filter(s => s.skill_type === 'learn');

    teachList.innerHTML = teachSkills.length ? '' : '<div class="skills-empty-hint">Add a skill you can teach above</div>';
    learnList.innerHTML = learnSkills.length ? '' : '<div class="skills-empty-hint">Add a skill you want to learn above</div>';

    teachSkills.forEach(skill => teachList.appendChild(renderSkillPill(skill)));
    learnSkills.forEach(skill => learnList.appendChild(renderSkillPill(skill)));

    const total = data.skills.length;
    el('total-skills-badge').textContent = `${total} skill${total !== 1 ? 's' : ''}`;
    el('qs-teaching').textContent = teachSkills.length;
    el('qs-learning').textContent = learnSkills.length;

    const showBanner = total === 0;
    el('onboarding-warning')[showBanner ? 'classList' : 'classList'][showBanner ? 'remove' : 'add']('hidden');
  } catch {}
}

function renderSkillPill(skill) {
  const div = document.createElement('div');
  div.className = 'skill-pill';
  div.title = skill.skill_name;
  div.innerHTML = `
    <span class="skill-pill-name">
      <span title="${skill.skill_name}">${skill.skill_name}</span>
      <span class="skill-prof ${skill.proficiency_level}">${skill.proficiency_level}</span>
    </span>
    <button class="skill-del-btn" title="Remove skill" data-id="${skill.id}"><i class="fa-solid fa-xmark"></i></button>
  `;
  div.querySelector('.skill-del-btn').addEventListener('click', async e => {
    e.stopPropagation();
    const id = e.currentTarget.dataset.id;
    try {
      await api('DELETE', `/api/skills/${id}`);
      toast('Skill removed.', 'info');
      await loadMySkills();
      await loadMatches();
    } catch (err) { toast(err.message, 'error'); }
  });
  return div;
}

// ==================================================
//  MATCHES
// ==================================================
function initMatchTabs() {
  el('mt-perfect')?.addEventListener('click', () => {
    el('mt-perfect').classList.add('active'); el('mt-partial').classList.remove('active');
    el('match-panel-perfect').classList.add('active'); el('match-panel-partial').classList.remove('active');
  });
  el('mt-partial')?.addEventListener('click', () => {
    el('mt-partial').classList.add('active'); el('mt-perfect').classList.remove('active');
    el('match-panel-partial').classList.add('active'); el('match-panel-perfect').classList.remove('active');
  });
}

async function loadMatches() {
  try {
    const data = await api('GET', '/api/matches');
    const perfect = data.matches.filter(m => m.match_type === 'perfect');
    const partial = data.matches.filter(m => m.match_type === 'partial');

    el('qs-matches').textContent = data.matches.length;
    el('match-count').textContent = `${data.matches.length} found`;

    renderMatchGrid('perfect-matches-grid', perfect, 'perfect');
    renderMatchGrid('partial-matches-grid', partial, 'partial');
  } catch {}
}

function renderMatchGrid(containerId, peers, badgeType) {
  const grid = el(containerId);
  if (!grid) return;
  if (!peers.length) {
    const icons = { perfect: 'fa-circle-nodes', partial: 'fa-handshake' };
    const msgs  = { perfect: 'No perfect matches yet.<br>Add reciprocal skills to unlock!', partial: 'No partial matches found.' };
    grid.innerHTML = `<div class="empty-state-card"><i class="fa-solid ${icons[badgeType]}"></i><p>${msgs[badgeType]}</p></div>`;
    return;
  }
  grid.innerHTML = '';
  peers.forEach(p => grid.appendChild(renderPeerCard(p, badgeType)));
}

// ==================================================
//  PEER CARD RENDERER
// ==================================================
function renderPeerCard(peer, badgeType = 'peer') {
  const card = document.createElement('div');
  card.className = 'peer-card glass-card';
  const avatarHTML = peer.avatar_url
    ? `<img src="${peer.avatar_url}" alt="avatar">`
    : `<i class="fa-solid fa-user-astronaut"></i>`;
  const stars = renderStars(peer.average_rating || 0);
  const teachStr = (peer.teach_skills || '').split(',').filter(Boolean).slice(0, 2).join(', ') || '—';
  const learnStr = (peer.learn_skills || '').split(',').filter(Boolean).slice(0, 2).join(', ') || '—';
  const badgeLabel = { perfect: '⚡ Perfect Match', partial: '🤝 Partial Match', peer: '👤 Peer' };

  card.innerHTML = `
    <div class="peer-card-top">
      <div class="peer-card-avatar">${avatarHTML}</div>
      <div class="peer-card-info">
        <h4>${peer.fullname || peer.username}</h4>
        <div class="peer-card-rating">${stars} <span>${parseFloat(peer.average_rating || 0).toFixed(1)}</span></div>
        <p class="peer-card-bio">${peer.bio || 'No bio provided.'}</p>
      </div>
    </div>
    <div class="peer-card-skills">
      <div class="peer-skill-tag"><strong>Teaches:</strong> ${teachStr}</div>
      <div class="peer-skill-tag"><strong>Learning:</strong> ${learnStr}</div>
    </div>
    <div class="peer-card-footer">
      <span class="match-badge ${badgeType}">${badgeLabel[badgeType] || '👤 Peer'}</span>
      <div class="peer-card-actions">
        <button class="btn btn-ghost btn-sm" data-action="chat" data-id="${peer.id}" data-name="${peer.fullname || peer.username}">
          <i class="fa-solid fa-message"></i>
        </button>
        <button class="btn btn-accent btn-sm" data-action="profile" data-id="${peer.id}">
          <i class="fa-solid fa-user"></i> View
        </button>
      </div>
    </div>
  `;

  card.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) { openPeerProfile(peer.id); return; }
    e.stopPropagation();
    if (btn.dataset.action === 'chat') openChat(peer.id, peer.fullname || peer.username, peer.avatar_url);
    if (btn.dataset.action === 'profile') openPeerProfile(peer.id);
  });
  return card;
}

function renderStars(rating) {
  const full = Math.floor(rating);
  let html = '';
  for (let i = 0; i < 5; i++) html += `<i class="fa-${i < full ? 'solid' : 'regular'} fa-star" style="color:${i < full ? '#f59e0b' : '#444'}"></i>`;
  return html;
}

// ==================================================
//  EXPLORE PAGE
// ==================================================
function initExplorePage() {
  el('explore-search-btn')?.addEventListener('click', loadExplorePeers);
  el('explore-search-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') loadExplorePeers(); });
}

async function loadExplorePeers() {
  const search = el('explore-search-input')?.value.trim() || '';
  const filterType = el('explore-filter-type')?.value || '';
  const filterRating = parseFloat(el('explore-filter-rating')?.value || '0');

  try {
    const params = new URLSearchParams({ search, filter_type: filterType });
    const data = await api('GET', `/api/users/explore?${params}`);
    let peers = data.users.filter(u => u.id !== currentUser.id);
    if (filterRating > 0) peers = peers.filter(p => (p.average_rating || 0) >= filterRating);

    const grid = el('explore-grid');
    if (!peers.length) {
      grid.innerHTML = `<div class="empty-state-card full-width"><i class="fa-solid fa-user-slash"></i><p>No peers found.<br>Try different search terms.</p></div>`;
      return;
    }
    grid.innerHTML = '';
    peers.forEach(p => grid.appendChild(renderPeerCard(p, 'peer')));
  } catch {}
}

// ==================================================
//  SESSIONS PAGE
// ==================================================
function initSessionsPage() {
  qsa('.sessions-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      qsa('.sessions-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadSessions(tab.dataset.filter);
    });
  });
}

async function loadSessions(filter = 'all') {
  try {
    const data = await api('GET', '/api/sessions/me');
    let sessions = data.sessions;
    if (filter !== 'all') sessions = sessions.filter(s => s.status === filter);

    const list = el('sessions-list');
    if (!sessions.length) {
      list.innerHTML = `<div class="empty-state-card"><i class="fa-solid fa-calendar-alt"></i><p>No ${filter === 'all' ? '' : filter} classes found.<br>Book a session from a matched peer card.</p></div>`;
      return;
    }
    list.innerHTML = '';
    sessions.forEach(s => list.appendChild(renderSessionCard(s)));
  } catch {}
}

function renderSessionCard(session) {
  const card = document.createElement('div');
  card.className = 'session-card glass-card';
  const dateStr = session.scheduled_at ? new Date(session.scheduled_at).toLocaleString() : 'Not scheduled';
  const isTeacher = session.teacher_id === currentUser.id;
  const otherName = isTeacher ? session.learner_name : session.teacher_name;

  card.innerHTML = `
    <div class="session-card-top">
      <div>
        <div class="session-skill-name">${session.skill_name}</div>
      </div>
      <span class="session-status ${session.status}">${session.status}</span>
    </div>
    <div class="session-meta">
      <span><i class="fa-solid fa-user"></i> ${isTeacher ? 'Teaching' : 'Learning from'}: <strong>${otherName || 'Peer'}</strong></span>
      <span><i class="fa-solid fa-clock"></i> ${dateStr}</span>
    </div>
    <div class="session-actions">
      ${session.status === 'scheduled' ? `
        <button class="btn btn-accent btn-sm start-session-btn" data-session-id="${session.id}" data-peer-id="${isTeacher ? session.learner_id : session.teacher_id}" data-peer-name="${otherName}">
          <i class="fa-solid fa-video"></i> Join Class
        </button>
      ` : ''}
      ${session.status === 'completed' && !session.reviewed ? `
        <button class="btn btn-warning btn-sm review-session-btn" data-session-id="${session.id}" data-peer-name="${otherName}">
          <i class="fa-solid fa-star"></i> Rate
        </button>
      ` : ''}
      ${session.status === 'scheduled' ? `
        <button class="btn btn-ghost btn-sm cancel-session-btn" data-session-id="${session.id}">
          <i class="fa-solid fa-xmark"></i> Cancel
        </button>
      ` : ''}
    </div>
  `;

  card.querySelector('.start-session-btn')?.addEventListener('click', e => {
    const btn = e.currentTarget;
    openVideoCall(parseInt(btn.dataset.peerId), btn.dataset.peerName, parseInt(btn.dataset.sessionId));
  });
  card.querySelector('.review-session-btn')?.addEventListener('click', e => {
    openReviewModal(e.currentTarget.dataset.sessionId, e.currentTarget.dataset.peerName);
  });
  card.querySelector('.cancel-session-btn')?.addEventListener('click', async e => {
    try {
      await api('PUT', `/api/sessions/${e.currentTarget.dataset.sessionId}/status`, { status: 'cancelled' });
      toast('Session cancelled.', 'info');
      loadSessions();
    } catch (err) { toast(err.message, 'error'); }
  });
  return card;
}

// ==================================================
//  PROFILE PAGE
// ==================================================
async function loadProfile() {
  try {
    const data = await api('GET', '/api/users/me');
    const u = data.user;
    currentUser = { ...currentUser, ...u };

    el('profile-display-name').textContent = u.fullname || u.username;
    el('profile-fullname').value = u.fullname || '';
    el('profile-bio').value = u.bio || '';
    el('profile-avatar').value = u.avatar_url || '';
    el('profile-credits').textContent = u.credits || 0;
    el('credits-count').textContent = u.credits || 0;

    const rating = parseFloat(u.average_rating || 0);
    el('profile-avg-rating').textContent = rating.toFixed(1);
    el('dropdown-rating').textContent = rating.toFixed(1);
    el('profile-stars').innerHTML = renderStars(rating);

    if (u.avatar_url) {
      el('profile-big-avatar').innerHTML = `<img src="${u.avatar_url}" alt="avatar">`;
      el('header-avatar').innerHTML = `<img src="${u.avatar_url}" alt="avatar">`;
    }

    loadMyReviews();
  } catch {}
}

function initProfilePage() {
  el('profile-edit-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    hide('profile-success');
    try {
      const data = await api('PUT', '/api/users/me', {
        fullname: el('profile-fullname').value.trim(),
        bio: el('profile-bio').value.trim(),
        avatar_url: el('profile-avatar').value.trim()
      });
      currentUser = { ...currentUser, ...data.user };
      updateHeaderUser();
      show('profile-success');
      toast('Profile updated!', 'success');
      setTimeout(() => hide('profile-success'), 3000);
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function loadMyReviews() {
  try {
    const data = await api('GET', '/api/reviews/me');
    const list = el('reviews-list');
    if (!data.reviews.length) {
      list.innerHTML = '<div class="empty-state-card"><i class="fa-solid fa-star"></i><p>No reviews yet.</p></div>';
      return;
    }
    list.innerHTML = '';
    data.reviews.forEach(r => {
      const div = document.createElement('div');
      div.className = 'review-item';
      div.innerHTML = `
        <div class="review-item-header">
          <span class="reviewer-name">${r.reviewer_name}</span>
          <span class="review-stars">${renderStars(r.rating)} ${r.rating}/5</span>
        </div>
        <p class="review-comment">${r.comment || 'No comment.'}</p>
        <span class="review-date">${new Date(r.created_at).toLocaleDateString()}</span>
      `;
      list.appendChild(div);
    });
  } catch {}
}

// ==================================================
//  CHAT PANEL
// ==================================================
function initChatPanel() {
  el('close-chat-btn')?.addEventListener('click', closeChat);
  el('chat-input-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = el('chat-message-input').value.trim();
    if (!msg || !activeChat.partnerId) return;
    el('chat-message-input').value = '';
    
    appendChatMessage(msg, 'outgoing');
    
    if (socket && socket.connected) {
      socket.emit('send_message', { receiver_id: activeChat.partnerId, message: msg, sender_name: currentUser.username });
    } else {
      try {
        await api('POST', '/api/messages', { receiver_id: activeChat.partnerId, message: msg });
      } catch (err) {
        toast('Failed to send message: connection lost.', 'error');
      }
    }
  });

  el('start-call-btn')?.addEventListener('click', () => {
    if (!activeChat.partnerId) return;
    openVideoCall(activeChat.partnerId, activeChat.partnerName);
  });

  el('start-group-call-btn')?.addEventListener('click', () => {
    openGroupCallModal();
  });

  el('ai-help-btn')?.addEventListener('click', () => {
    el('ai-drawer')?.classList.toggle('closed');
  });
}

function openChat(peerId, peerName, avatarUrl) {
  // Redirect to full Chats Tab for a unified premium messaging experience
  switchTab('chats');
  qsa('.header-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'chats'));
  selectChat(peerId, peerName, avatarUrl);
}

function closeChat() {
  el('chat-sidebar').classList.add('closed');
  el('ai-drawer').classList.add('closed');
}

async function loadChatHistory(peerId) {
  try {
    const data = await api('GET', `/api/messages/${peerId}`);
    data.messages.forEach(m => {
      if (m.is_call_log) {
        appendChatMessage(m.message, m.sender_id === currentUser.id ? 'outgoing call-log' : 'incoming call-log');
      } else {
        appendChatMessage(m.message, m.sender_id === currentUser.id ? 'outgoing' : 'incoming');
      }
    });
  } catch {}
}

function appendChatMessage(text, direction) {
  const log = el('chat-messages-log');
  if (log) {
    appendChatMessageToElement(log, text, direction);
  }
}

// ==================================================
//  AI ASSISTANT
// ==================================================
function initAIPanel() {
  el('close-ai-btn')?.addEventListener('click', () => el('ai-drawer').classList.add('closed'));

  el('ai-chat-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = el('ai-chat-input').value.trim();
    if (!msg) return;
    el('ai-chat-input').value = '';
    appendAIBubble(msg, 'user');
    await sendToAI(msg);
  });

  qsa('.ai-chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      const prompt = chip.dataset.prompt;
      appendAIBubble(prompt, 'user');
      await sendToAI(prompt);
    });
  });

  // Check AI config status
  api('GET', '/api/ai/config')
    .then(res => {
      const dot = el('ai-status-dot');
      const text = el('ai-status-text');
      if (dot && text) {
        if (res.online) {
          dot.style.background = 'var(--emerald)';
          text.textContent = 'Gemini 1.5 Flash (Online)';
        } else {
          dot.style.background = 'var(--orange)';
          text.textContent = 'Local AI Fallback';
        }
      }
    })
    .catch(() => {});
}

function formatMarkdown(text) {
  if (!text) return '';
  // Basic HTML escape to prevent XSS
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  // Headers
  html = html.replace(/^### (.*$)/gim, '<h4 style="margin: 8px 0 4px; color: var(--primary-light);">$1</h4>');
  html = html.replace(/^## (.*$)/gim, '<h3 style="margin: 12px 0 6px; color: var(--primary-light);">$1</h3>');
  html = html.replace(/^# (.*$)/gim, '<h2 style="margin: 16px 0 8px; color: var(--primary-light);">$2</h2>');
  
  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Bullet points
  html = html.replace(/^\s*[\-\*]\s+(.*$)/gim, '<div style="margin-left: 12px; display: flex; align-items: flex-start; gap: 6px; font-size: 0.82rem; margin-top: 4px;"><span style="color: var(--primary-light);">•</span><span>$1</span></div>');
  
  // Numbered list items
  html = html.replace(/^\s*(\d+)\.\s+(.*$)/gim, '<div style="margin-left: 12px; display: flex; align-items: flex-start; gap: 6px; font-size: 0.82rem; margin-top: 4px;"><span style="color: var(--primary-light); font-weight: bold;">$1.</span><span>$2</span></div>');

  // Paragraph and Line breaks
  html = html.replace(/\n\n/g, '</p><p style="margin-top: 8px;">');
  html = html.replace(/\n/g, '<br>');
  
  return html;
}

function appendAIBubble(text, role) {
  const log = el('ai-chat-history');
  const div = document.createElement('div');
  div.className = `ai-bubble ${role}`;
  if (role === 'assistant') {
    div.innerHTML = `<i class="fa-solid fa-robot"></i><div style="font-size: 0.88rem; line-height: 1.4;"><p>${formatMarkdown(text)}</p></div>`;
  } else {
    div.textContent = text;
  }
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

async function sendToAI(message) {
  const loadingEl = document.createElement('div');
  loadingEl.className = 'ai-bubble assistant';
  loadingEl.innerHTML = `<i class="fa-solid fa-robot"></i><p><i class="fa-solid fa-spinner fa-spin"></i> Thinking...</p>`;
  el('ai-chat-history').appendChild(loadingEl);
  el('ai-chat-history').scrollTop = el('ai-chat-history').scrollHeight;

  try {
    const res = await api('POST', '/api/ai/chat', {
      message,
      context: { skillContext: activeChat.partnerName ? `Exchange session with ${activeChat.partnerName}` : 'General learning' }
    });
    // Replace loading placeholder with formatted Markdown content
    loadingEl.innerHTML = `<i class="fa-solid fa-robot"></i><div style="font-size: 0.88rem; line-height: 1.4;"><p>${formatMarkdown(res.reply)}</p></div>`;
  } catch {
    const fallbacks = [
      `Great question about learning! Start by breaking your skill into 3-5 key modules. Practice each one for 20-minute sessions and review after each.`,
      `For a one-hour exchange: Start with 10 min introductions → 20 min Peer A teaches → 5 min Q&A → 20 min Peer B teaches → 5 min wrap-up.`,
      `Track progress with weekly mini-challenges. Set 3 achievable goals per session and review them at the end. Celebrate small wins!`,
      `A good icebreaker: each person shares one cool thing they built or learned this week. It instantly builds connection and trust.`,
    ];
    const text = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    loadingEl.innerHTML = `<i class="fa-solid fa-robot"></i><div style="font-size: 0.88rem; line-height: 1.4;"><p>${formatMarkdown(text)}</p></div>`;
  }
  el('ai-chat-history').scrollTop = el('ai-chat-history').scrollHeight;
}

// ==================================================
//  VIDEO CALL (WebRTC) HELPER FUNCTIONS
// ==================================================
async function addIceCandidateSafely(pc, candidate) {
  if (!candidate) return;
  if (pc.remoteDescription && pc.remoteDescription.type) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
      console.log("Successfully added ICE candidate:", candidate.candidate);
    } catch (e) {
      console.warn("Failed to add ICE candidate:", e);
    }
  } else {
    if (!pc.iceQueue) pc.iceQueue = [];
    pc.iceQueue.push(candidate);
    console.log("Queued ICE candidate (remote description not set yet):", candidate.candidate);
  }
}

async function drainIceQueue(pc) {
  if (pc.iceQueue && pc.iceQueue.length) {
    console.log(`Draining ${pc.iceQueue.length} queued ICE candidates...`);
    while (pc.iceQueue.length > 0) {
      const candidate = pc.iceQueue.shift();
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("Successfully added queued ICE candidate:", candidate.candidate);
      } catch (e) {
        console.warn("Failed to add queued ICE candidate:", e);
      }
    }
  }
}

// ==================================================
//  VIDEO CALL (WebRTC)
// ==================================================
function initCallUI() {
  el('call-end-btn')?.addEventListener('click', endCall);
  el('call-toggle-audio')?.addEventListener('click', () => toggleTrack('audio'));
  el('call-toggle-video')?.addEventListener('click', () => toggleTrack('video'));
  el('call-toggle-screen')?.addEventListener('click', shareScreen);

  // Call Minimize (WhatsApp floating PIP)
  el('call-minimize-btn')?.addEventListener('click', () => {
    const overlay = el('call-overlay');
    overlay.classList.add('minimized');
    makeDraggable(overlay);
    document.body.classList.remove('mobile-call-active');
    toast('Call minimized to bubble', 'info');
  });

  // Call Maximize (Restore full screen focus view)
  const restoreCallOverlay = () => {
    const overlay = el('call-overlay');
    overlay.classList.remove('minimized');
    overlay.style.top = '';
    overlay.style.left = '';
    overlay.style.right = '';
    overlay.style.bottom = '';
    overlay.style.width = '';
    overlay.style.height = '';
    if (window.innerWidth < 768) {
      document.body.classList.add('mobile-call-active');
      history.pushState({ view: 'call' }, '', '#call');
    }
    toast('Call maximized', 'info');
  };
  el('call-maximize-btn')?.addEventListener('click', restoreCallOverlay);

  // Click floating bubble to restore full screen call
  el('call-overlay')?.addEventListener('click', () => {
    const overlay = el('call-overlay');
    if (overlay.classList.contains('minimized')) {
      restoreCallOverlay();
    }
  });

  // Workspace Toggle (split screen vs focus video mode)
  el('call-toggle-workspace')?.addEventListener('click', () => {
    const overlay = el('call-overlay');
    const btn = el('call-toggle-workspace');
    const active = overlay.classList.toggle('show-workspace');
    btn.classList.toggle('active', active);
    toast(active ? 'Workspace split active' : 'Workspace hidden (Focus mode)', 'info');
  });
  
  el('show-participants-btn')?.addEventListener('click', () => {
    el('classroom-participants-drawer').classList.toggle('hidden');
  });
  el('close-participants-btn')?.addEventListener('click', () => {
    el('classroom-participants-drawer').classList.add('hidden');
  });

  // Invite More Peers button click handler
  el('classroom-add-peer-btn')?.addEventListener('click', () => {
    openGroupCallModal();
  });

  // Mobile Bottom-Sheet Options click/tap handlers
  const videoFeeds = el('classroom-video-feeds');
  const fullscreenToggle = el('mobile-fullscreen-toggle');
  const optionsModal = el('mobile-classroom-options-modal');
  
  // Tap on video feeds opens bottom options sheet on mobile
  videoFeeds?.addEventListener('click', e => {
    if (window.innerWidth <= 900) {
      if (e.target.closest('.mobile-fullscreen-btn') || e.target.closest('.local-feed') || e.target.closest('.draggable-pip')) {
        return; // ignore these taps
      }
      show('mobile-classroom-options-modal');
    }
  });

  // Floating button also opens the options sheet
  fullscreenToggle?.addEventListener('click', e => {
    e.stopPropagation();
    show('mobile-classroom-options-modal');
  });

  // Bottom sheet option: See Full Screen
  el('opt-see-fullscreen')?.addEventListener('click', () => {
    el('classroom-body')?.classList.add('video-fullscreen-mode');
    hide('mobile-classroom-options-modal');
    toast('Switched to full screen video', 'info');
  });

  // Bottom sheet option: Minimize Screen
  el('opt-minimize-screen')?.addEventListener('click', () => {
    el('classroom-body')?.classList.remove('video-fullscreen-mode');
    hide('mobile-classroom-options-modal');
    toast('Classroom editor restored', 'info');
  });

  // Bottom sheet cancel option
  el('opt-cancel')?.addEventListener('click', () => {
    hide('mobile-classroom-options-modal');
  });

  // Click outside bottom sheet to close it
  optionsModal?.addEventListener('click', e => {
    if (e.target === optionsModal) {
      hide('mobile-classroom-options-modal');
    }
  });

  el('tab-code-editor-btn')?.addEventListener('click', () => switchWorkspace('code-editor'));
  el('tab-whiteboard-btn')?.addEventListener('click', () => switchWorkspace('whiteboard'));

  el('code-editor-text')?.addEventListener('input', () => {
    if (socket && activeChat.partnerId) {
      socket.emit('code_update', { code: el('code-editor-text').value, to: activeChat.partnerId, userId: currentUser.id });
    }
  });
  el('whiteboard-text')?.addEventListener('input', () => {
    if (socket && activeChat.partnerId) {
      socket.emit('whiteboard_update', { text: el('whiteboard-text').value, to: activeChat.partnerId, userId: currentUser.id });
    }
  });
}

function switchWorkspace(tab) {
  qsa('.ws-tab').forEach(t => t.classList.remove('active'));
  qsa('.ws-pane').forEach(p => p.classList.remove('active'));
  el(`tab-${tab}-btn`)?.classList.add('active');
  el(`pane-${tab}`)?.classList.add('active');
}

async function openVideoCall(peerId, peerName, sessionId = null) {
  isGroupCall = false;
  activeCallPartnerId = peerId;
  activeChat.partnerId = peerId;
  activeChat.partnerName = peerName;
  el('classroom-peer-name').textContent = peerName;

  const overlay = el('call-overlay');
  overlay.classList.remove('hidden');
  overlay.classList.remove('minimized');
  overlay.classList.remove('show-workspace');
  overlay.style.top = '';
  overlay.style.left = '';
  overlay.style.right = '';
  overlay.style.bottom = '';
  overlay.style.width = '';
  overlay.style.height = '';
  el('call-toggle-workspace')?.classList.remove('active');

  if (window.innerWidth < 768) {
    document.body.classList.add('mobile-call-active');
    history.pushState({ view: 'call' }, '', '#call');
  }

  // Render peer avatar photo in call overlay remote mock
  const remoteMock = el('remote-mock-stream');
  if (remoteMock) {
    const avatarUrl = activeChat.avatarUrl;
    if (avatarUrl) {
      remoteMock.innerHTML = `
        <img src="${avatarUrl}" style="width: 100px; height: 100px; border-radius: 50%; object-fit: cover; border: 3px solid var(--primary-light); box-shadow: 0 4px 15px rgba(0,0,0,0.5);">
        <p style="margin-top: 12px; font-weight: 600;">${peerName}</p>
        <p style="font-size: 0.8rem; color: var(--text-muted);">Waiting to connect...</p>
      `;
    } else {
      remoteMock.innerHTML = `
        <div class="feed-mock-icon"><i class="fa-solid fa-user-graduate"></i></div>
        <p>${peerName}</p>
        <p>Waiting to connect...</p>
      `;
    }
  }

  el('classroom-video-feeds').classList.remove('group-grid');
  el('classroom-participants-drawer').classList.add('hidden');
  
  // Hide group-only add peer option
  const drawerActions = el('classroom-drawer-actions');
  if (drawerActions) drawerActions.style.display = 'none';

  startCallTimer();

  if (sessionId) {
    try { await api('PUT', `/api/sessions/${sessionId}/status`, { status: 'active' }); } catch {}
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    el('local-video').srcObject = localStream;
    hide('local-mock-stream');
  } catch (e) {
    show('local-mock-stream');
    toast('Camera/mic unavailable — running in screen-share/text mode.', 'warning');
  }

  initPeerConnection(peerId);

  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    socket.emit('call_user', {
      to: peerId,
      offer: offer,
      senderName: currentUser.fullname || currentUser.username
    });
  } catch (e) {
    console.error("Failed to create offer:", e);
  }

  toast(`📞 Classroom call placed to ${peerName}!`, 'info');
}

async function acceptDirectCall(callerId, callerName, offer) {
  isGroupCall = false;
  activeCallPartnerId = callerId;
  activeChat.partnerId = callerId;
  activeChat.partnerName = callerName;
  el('classroom-peer-name').textContent = callerName;
  el('call-overlay').classList.remove('hidden');
  el('classroom-video-feeds').classList.remove('group-grid');
  el('classroom-participants-drawer').classList.add('hidden');
  
  // Hide group-only add peer option
  const drawerActions = el('classroom-drawer-actions');
  if (drawerActions) drawerActions.style.display = 'none';
  
  startCallTimer();
  
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    el('local-video').srcObject = localStream;
    hide('local-mock-stream');
  } catch (e) {
    show('local-mock-stream');
    toast('Camera/mic unavailable.', 'warning');
  }
  
  initPeerConnection(callerId);
  
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    await drainIceQueue(peerConnection);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('accept_call', { to: callerId, answer: answer });
  } catch (e) {
    console.error("Failed to accept call:", e);
  }
}

function initPeerConnection(peerId) {
  peerConnection = new RTCPeerConnection(ICE_SERVERS);
  peerConnection.remoteDescriptionSet = false;
  peerConnection.iceQueue = [...globalIceQueue];
  globalIceQueue = []; // clear global queue

  if (localStream) localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

  peerConnection.ontrack = e => {
    console.log("OnTrack event received:", e);
    const remoteVideo = el('remote-video');
    if (remoteVideo) {
      if (e.streams && e.streams[0]) {
        remoteVideo.srcObject = e.streams[0];
      } else {
        if (!remoteVideo.srcObject) {
          remoteVideo.srcObject = new MediaStream();
        }
        remoteVideo.srcObject.addTrack(e.track);
      }
      hide('remote-mock-stream');
    }
  };

  peerConnection.onicecandidate = e => {
    if (e.candidate) {
      console.log("Sending ICE candidate to peer:", e.candidate.candidate);
      socket.emit('webrtc_ice', { candidate: e.candidate, to: peerId });
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log("ICE Connection State:", peerConnection.iceConnectionState);
  };

  peerConnection.onconnectionstatechange = async () => {
    console.log("Connection State Changed:", peerConnection.connectionState);
    if (peerConnection.connectionState === 'connected') {
      toast('🔗 Peer connected!', 'success');
    } else if (peerConnection.connectionState === 'failed') {
      toast('❌ Connection failed. Attempting ICE recovery...', 'warning');
      if (!peerConnection.hasRestartedIce) {
        peerConnection.hasRestartedIce = true;
        console.log("Attempting 1:1 ICE restart via silent renegotiation...");
        try {
          const offer = await peerConnection.createOffer({ iceRestart: true });
          await peerConnection.setLocalDescription(offer);
          socket.emit('webrtc_offer', { offer, to: peerId });
        } catch (err) {
          console.error("1:1 ICE Restart offer creation failed:", err);
        }
      } else {
        toast('❌ Connection recovery failed. Please check network settings.', 'error');
      }
    }
  };
}

function toggleTrack(type) {
  if (!localStream) return;
  const tracks = type === 'audio' ? localStream.getAudioTracks() : localStream.getVideoTracks();
  const btn = el(`call-toggle-${type}`);
  tracks.forEach(t => { t.enabled = !t.enabled; });
  const isEnabled = tracks[0]?.enabled;
  btn.classList.toggle('active', isEnabled);
  if (type === 'video') {
    el('local-mock-stream')[isEnabled ? 'style' : 'style'].display = isEnabled ? 'none' : 'flex';
  }
}

async function shareScreen() {
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];
    if (peerConnection) {
      const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(screenTrack);
    }
    el('local-video').srcObject = screenStream;
    el('call-toggle-screen').classList.add('active');
    screenTrack.onended = () => {
      el('call-toggle-screen').classList.remove('active');
      if (localStream) {
        el('local-video').srcObject = localStream;
        const videoTrack = localStream.getVideoTracks()[0];
        const sender = peerConnection?.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack);
      }
    };
    toast('Screen sharing started', 'info');
  } catch { toast('Screen share cancelled or not supported.', 'warning'); }
}

function startCallTimer() {
  callSeconds = 0;
  clearInterval(callTimer);
  callTimer = setInterval(() => {
    callSeconds++;
    const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
    const s = String(callSeconds % 60).padStart(2, '0');
    if (el('call-timer')) el('call-timer').textContent = `${m}:${s}`;
  }, 1000);

  setTimeout(() => {
    const localFeed = document.querySelector('.local-feed');
    if (localFeed) {
      localFeed.classList.add('draggable-pip');
      if (typeof makeDraggable === 'function') makeDraggable(localFeed);
    }
  }, 100);
}

async function endCall() {
  if (isGroupCall) {
    socket.emit('leave_group_room', { roomId: groupRoomId });
    for (const id in groupPeerConnections) {
      groupPeerConnections[id].close();
    }
    groupPeerConnections = {};
  } else {
    if (activeCallPartnerId) {
      socket.emit('hang_up', {
        to: activeCallPartnerId,
        callerId: currentUser.id,
        receiverId: activeCallPartnerId
      });
    }
  }
  
  endCallLocal();
  toast('Session ended.', 'success');
  await loadCallHistory();
}

function endCallLocal() {
  clearInterval(callTimer);
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  
  for (const id in groupPeerConnections) {
    groupPeerConnections[id].close();
  }
  groupPeerConnections = {};
  
  globalIceQueue = [];
  groupIceQueues = {};
  classroomGroupMembers = [];
  
  const videoGrid = el('classroom-video-feeds');
  videoGrid.innerHTML = `
    <div class="video-feed remote-feed">
      <video id="remote-video" autoplay playsinline></video>
      <div class="feed-mock" id="remote-mock-stream">
        <div class="feed-mock-icon"><i class="fa-solid fa-user-graduate"></i></div>
        <p>Waiting for peer to connect...</p>
      </div>
      <div class="feed-label" id="remote-video-label"><i class="fa-solid fa-circle live-dot"></i> Peer Camera</div>
    </div>
    <div class="video-feed local-feed">
      <video id="local-video" autoplay playsinline muted></video>
      <div class="feed-mock" id="local-mock-stream">
        <div class="feed-mock-icon"><i class="fa-solid fa-video-slash"></i></div>
        <p>Camera Off</p>
      </div>
      <div class="feed-label">You</div>
    </div>
  `;
  
  const overlay = el('call-overlay');
  overlay.classList.add('hidden');
  overlay.classList.remove('minimized');
  overlay.classList.remove('show-workspace');
  document.body.classList.remove('mobile-call-active');
  if (window.location.hash === '#call') {
    history.back();
  }
  el('call-timer').textContent = '00:00';
  isGroupCall = false;
  groupRoomId = null;
  activeCallPartnerId = null;
  loadSessions();
}

// ==================================================
//  GROUP CALL CLASSROOM & SIGNALING LOGIC
// ==================================================
async function startGroupCall(invitedUsers) {
  isGroupCall = true;
  groupRoomId = 'group_' + Date.now();
  el('classroom-peer-name').textContent = 'Group Class';

  const overlay = el('call-overlay');
  overlay.classList.remove('hidden');
  overlay.classList.remove('minimized');
  overlay.classList.remove('show-workspace');
  overlay.style.top = '';
  overlay.style.left = '';
  overlay.style.right = '';
  overlay.style.bottom = '';
  overlay.style.width = '';
  overlay.style.height = '';
  el('call-toggle-workspace')?.classList.remove('active');

  if (window.innerWidth < 768) {
    document.body.classList.add('mobile-call-active');
    history.pushState({ view: 'call' }, '', '#call');
  }

  el('classroom-participants-drawer').classList.remove('hidden');
  
  // Show group-only add peer option
  const drawerActions = el('classroom-drawer-actions');
  if (drawerActions) drawerActions.style.display = 'block';
  
  const videoGrid = el('classroom-video-feeds');
  videoGrid.innerHTML = ''; 
  videoGrid.classList.add('group-grid');
  
  const localWrapper = document.createElement('div');
  localWrapper.className = 'video-feed local-feed';
  localWrapper.id = 'feed_local';
  localWrapper.innerHTML = `
    <video id="local-video" autoplay playsinline muted></video>
    <div class="feed-mock" id="local-mock-stream" style="display: none;">
      <div class="feed-mock-icon"><i class="fa-solid fa-video-slash"></i></div>
      <p>Camera Off</p>
    </div>
    <div class="feed-label">You (Host)</div>
  `;
  videoGrid.appendChild(localWrapper);

  startCallTimer();
  
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    el('local-video').srcObject = localStream;
    el('local-mock-stream').style.display = 'none';
  } catch (e) {
    el('local-mock-stream').style.display = 'flex';
    toast('Camera/mic unavailable.', 'warning');
  }

  socket.emit('group_call_invite', {
    roomId: groupRoomId,
    invitedUsers,
    senderName: currentUser.fullname || currentUser.username
  });
  
  socket.emit('join_group_room', {
    roomId: groupRoomId,
    userName: currentUser.fullname || currentUser.username
  });

  groupParticipants = [
    { userId: currentUser.id, userName: currentUser.fullname || currentUser.username, status: 'host' }
  ];
  invitedUsers.forEach(u => {
    groupParticipants.push({ userId: u.id, userName: u.name, status: 'invited' });
  });
  
  loadClassroomCandidates();
  toast('Group call started!', 'success');
}

async function joinGroupCall(roomId, initiatorName) {
  isGroupCall = true;
  groupRoomId = roomId;
  el('classroom-peer-name').textContent = 'Group Class';

  const overlay = el('call-overlay');
  overlay.classList.remove('hidden');
  overlay.classList.remove('minimized');
  overlay.classList.remove('show-workspace');
  overlay.style.top = '';
  overlay.style.left = '';
  overlay.style.right = '';
  overlay.style.bottom = '';
  overlay.style.width = '';
  overlay.style.height = '';
  el('call-toggle-workspace')?.classList.remove('active');

  if (window.innerWidth < 768) {
    document.body.classList.add('mobile-call-active');
    history.pushState({ view: 'call' }, '', '#call');
  }

  el('classroom-participants-drawer').classList.remove('hidden');
  
  // Show group-only add peer option
  const drawerActions = el('classroom-drawer-actions');
  if (drawerActions) drawerActions.style.display = 'block';
  
  const videoGrid = el('classroom-video-feeds');
  videoGrid.innerHTML = ''; 
  videoGrid.classList.add('group-grid');
  
  const localWrapper = document.createElement('div');
  localWrapper.className = 'video-feed local-feed';
  localWrapper.id = 'feed_local';
  localWrapper.innerHTML = `
    <video id="local-video" autoplay playsinline muted></video>
    <div class="feed-mock" id="local-mock-stream" style="display: none;">
      <div class="feed-mock-icon"><i class="fa-solid fa-video-slash"></i></div>
      <p>Camera Off</p>
    </div>
    <div class="feed-label">You</div>
  `;
  videoGrid.appendChild(localWrapper);

  startCallTimer();
  
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    el('local-video').srcObject = localStream;
    el('local-mock-stream').style.display = 'none';
  } catch (e) {
    el('local-mock-stream').style.display = 'flex';
    toast('Camera/mic unavailable.', 'warning');
  }

  socket.emit('join_group_room', {
    roomId,
    userName: currentUser.fullname || currentUser.username
  });
  
  groupParticipants = [
    { userId: currentUser.id, userName: currentUser.fullname || currentUser.username, status: 'connected' }
  ];
  loadClassroomCandidates();
}

function createPeerFeedContainer(peerSocketId, peerUserName) {
  const videoGrid = el('classroom-video-feeds');
  if (!videoGrid) return;
  
  let peerFeed = el(`feed_${peerSocketId}`);
  if (!peerFeed) {
    peerFeed = document.createElement('div');
    peerFeed.className = 'video-feed';
    peerFeed.id = `feed_${peerSocketId}`;
    peerFeed.innerHTML = `
      <video id="video_${peerSocketId}" autoplay playsinline style="display: none; width: 100%; height: 100%; object-fit: cover;"></video>
      <div class="feed-mock" id="mock_${peerSocketId}">
        <div class="feed-mock-icon"><i class="fa-solid fa-user-graduate"></i></div>
        <p>Connecting...</p>
      </div>
      <div class="feed-label" id="label_${peerSocketId}"><i class="fa-solid fa-circle live-dot"></i> ${peerUserName}</div>
    `;
    videoGrid.appendChild(peerFeed);
  }
}

function createGroupPeerConnection(peerSocketId, peerUserId, peerUserName, isInitiator) {
  const pc = new RTCPeerConnection(ICE_SERVERS);
  pc.remoteDescriptionSet = false;
  pc.iceQueue = groupIceQueues[peerSocketId] || [];
  delete groupIceQueues[peerSocketId];
  
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }
  
  // Create video container placeholder immediately
  createPeerFeedContainer(peerSocketId, peerUserName);
  
  pc.ontrack = e => {
    console.log("Group OnTrack event received from peer:", peerUserName, e);
    renderRemoteGroupStream(peerSocketId, peerUserId, peerUserName, e);
  };
  
  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit('group_signal', {
        toSocketId: peerSocketId,
        signalData: { type: 'ice-candidate', candidate: e.candidate }
      });
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`Group ICE State for ${peerUserName}:`, pc.iceConnectionState);
  };

  pc.onconnectionstatechange = async () => {
    console.log(`Group Connection State for ${peerUserName}:`, pc.connectionState);
    if (pc.connectionState === 'connected') {
      const idx = groupParticipants.findIndex(p => p.userId === peerUserId);
      if (idx !== -1) {
        groupParticipants[idx].status = 'connected';
        updateGroupParticipantsList();
      }
    } else if (pc.connectionState === 'failed') {
      console.log(`Group call connection failed for ${peerUserName}. Attempting ICE restart...`);
      if (!pc.hasRestartedIce) {
        pc.hasRestartedIce = true;
        try {
          const offer = await pc.createOffer({ iceRestart: true });
          await pc.setLocalDescription(offer);
          socket.emit('group_signal', {
            toSocketId: peerSocketId,
            signalData: offer
          });
        } catch (err) {
          console.error(`Group ICE Restart failed for ${peerUserName}:`, err);
        }
      }
    }
  };

  return pc;
}

function renderRemoteGroupStream(peerSocketId, peerUserId, peerUserName, e) {
  // Ensure the container exists
  createPeerFeedContainer(peerSocketId, peerUserName);
  
  const videoEl = el(`video_${peerSocketId}`);
  const mockEl = el(`mock_${peerSocketId}`);
  
  if (videoEl) {
    if (e.streams && e.streams[0]) {
      videoEl.srcObject = e.streams[0];
    } else {
      if (!videoEl.srcObject) {
        videoEl.srcObject = new MediaStream();
      }
      videoEl.srcObject.addTrack(e.track);
    }
    
    videoEl.style.display = 'block';
    if (mockEl) mockEl.style.display = 'none';
    
    // Initialize active speaker highlighting and re-flow grid
    if (videoEl.srcObject) {
      startSpeakerHighlighting(videoEl.srcObject, el(`feed_${peerSocketId}`));
    }
    updateVideoGridLayout();
  }
  
  const pIdx = groupParticipants.findIndex(p => p.userId === peerUserId);
  if (pIdx !== -1) {
    groupParticipants[pIdx].status = 'connected';
  } else {
    groupParticipants.push({ userId: peerUserId, userName: peerUserName, status: 'connected' });
  }
  updateGroupParticipantsList();
}

function invitePeerToClassroom(userId, userName) {
  socket.emit('group_call_invite', {
    roomId: groupRoomId,
    invitedUsers: [{ id: userId, name: userName }],
    senderName: currentUser.fullname || currentUser.username
  });
  
  if (!groupParticipants.some(p => p.userId === userId)) {
    groupParticipants.push({ userId, userName, status: 'invited' });
  }
  updateGroupParticipantsList();
  toast(`Invitation sent to ${userName}!`, 'success');
}

async function loadClassroomCandidates() {
  if (classroomGroupMembers && classroomGroupMembers.length > 0) {
    updateGroupParticipantsList();
    return;
  }
  try {
    const data = await api('GET', '/api/users/explore');
    classroomGroupMembers = data.users
      .filter(u => u.id !== currentUser.id)
      .map(u => ({ id: u.id, name: u.fullname || u.username }));
    updateGroupParticipantsList();
  } catch (err) {
    console.error('Failed to load classroom candidates:', err);
  }
}

function updateGroupParticipantsList() {
  const list = el('classroom-participants-list');
  if (!list) return;
  
  list.innerHTML = '';
  
  const hosts    = groupParticipants.filter(p => p.status === 'host');
  const active   = groupParticipants.filter(p => p.status === 'connected');
  const pending  = groupParticipants.filter(p => p.status === 'invited');
  const activeCount = hosts.length + active.length;

  const isHost = groupParticipants.some(p => p.status === 'host' && p.userId === currentUser.id);

  const makeItem = (p, label, badgeClass) => {
    const avatarHtml = p.avatarUrl
      ? `<img src="${p.avatarUrl}" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover; flex-shrink: 0;">`
      : `<div style="width: 28px; height: 28px; border-radius: 50%; background: linear-gradient(135deg, var(--primary), var(--accent)); display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: #fff; flex-shrink: 0;"><i class="fa-solid fa-user"></i></div>`;

    const li = document.createElement('li');
    li.className = 'participant-item';
    li.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,0.02); margin-bottom: 4px;';
    
    let actionBtnHtml = '';
    if (isHost && p.userId !== currentUser.id) {
      if (p.status === 'connected') {
        actionBtnHtml = `<button class="kick-peer-btn" title="Kick participant" style="background: transparent; border: none; color: #f43f5e; cursor: pointer; font-size: 0.8rem; padding: 2px 6px; display: inline-flex; align-items: center;"><i class="fa-solid fa-user-xmark"></i></button>`;
      } else if (p.status === 'invited') {
        actionBtnHtml = `<button class="reinvite-peer-btn" title="Re-invite participant" style="background: transparent; border: none; color: var(--accent); cursor: pointer; font-size: 0.8rem; padding: 2px 6px; display: inline-flex; align-items: center;"><i class="fa-solid fa-arrow-rotate-right"></i></button>`;
      }
    }

    li.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
        ${avatarHtml}
        <span class="participant-name" style="font-size: 0.85rem; font-weight: 500; color: #f1f5f9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.userName}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
        <span class="participant-badge ${badgeClass}" style="font-size: 0.7rem; padding: 2px 6px; border-radius: 4px;">${label}</span>
        ${actionBtnHtml}
      </div>
    `;

    const kickBtn = li.querySelector('.kick-peer-btn');
    if (kickBtn) {
      kickBtn.onclick = () => {
        if (confirm(`Remove ${p.userName} from the call?`)) {
          socket.emit('kick_participant', { roomId: groupRoomId, userId: p.userId });
        }
      };
    }

    const reinviteBtn = li.querySelector('.reinvite-peer-btn');
    if (reinviteBtn) {
      reinviteBtn.onclick = () => {
        invitePeerToClassroom(p.userId, p.userName);
      };
    }

    return li;
  };

  // Section: In the Call
  if (hosts.length || active.length) {
    const secLabel = document.createElement('div');
    secLabel.className = 'participants-section-label';
    secLabel.innerHTML = '<i class="fa-solid fa-signal"></i> In the Call';
    list.appendChild(secLabel);
    hosts.forEach(p => list.appendChild(makeItem(p, 'Host', 'host')));
    active.forEach(p => list.appendChild(makeItem(p, 'Joined', 'connected')));
  }

  // Section: Awaiting Response
  if (pending.length) {
    const secLabel = document.createElement('div');
    secLabel.className = 'participants-section-label';
    secLabel.innerHTML = '<i class="fa-solid fa-clock"></i> Awaiting Response';
    list.appendChild(secLabel);
    pending.forEach(p => list.appendChild(makeItem(p, 'Invited', 'invited')));
  }

  // Section: Available to Invite
  const nonInvited = classroomGroupMembers.filter(m => !groupParticipants.some(p => p.userId === m.id));
  if (nonInvited.length) {
    const secLabel = document.createElement('div');
    secLabel.className = 'participants-section-label';
    secLabel.style.marginTop = '12px';
    secLabel.innerHTML = '<i class="fa-solid fa-user-plus"></i> Available to Invite';
    list.appendChild(secLabel);
    
    nonInvited.forEach(p => {
      const li = document.createElement('li');
      li.className = 'participant-item';
      li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,0.01); margin-bottom: 4px;';
      li.innerHTML = `
        <span class="participant-name" style="color: var(--text-muted); font-size: 0.85rem;">${p.name}</span>
        <button class="invite-btn" style="padding: 4px 10px; font-size: 0.72rem; border-radius: 6px; background: var(--primary); color: #fff; border: none; cursor: pointer; font-weight: 600;">Invite</button>
      `;
      li.querySelector('.invite-btn').onclick = () => {
        invitePeerToClassroom(p.id, p.name);
      };
      list.appendChild(li);
    });
  }

  if (!groupParticipants.length && !nonInvited.length) {
    list.innerHTML = '<li style="font-size: 0.85rem; color: var(--text-muted); text-align: center; padding: 16px;">No participants yet.</li>';
  }

  el('participants-count').textContent = activeCount;
}

function openGroupCallModal() {
  show('group-call-modal');
  hide('group-call-error');
  
  // Set correct button label depending on active call state
  const submitBtn = el('launch-group-call-btn');
  if (submitBtn) {
    if (isGroupCall && groupRoomId) {
      submitBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Send Invites';
      el('group-call-modal').querySelector('h2').textContent = 'Invite Peers to Class';
    } else {
      submitBtn.innerHTML = '<i class="fa-solid fa-video"></i> Start Group Class';
      el('group-call-modal').querySelector('h2').textContent = 'Start a Group Class';
    }
  }

  const listContainer = el('group-call-peers-list');
  if (!listContainer) return;
  
  api('GET', '/api/users/explore')
    .then(data => {
      // Sort users: online first, then offline
      const sortedPeers = [...data.users]
        .filter(u => u.id !== currentUser.id)
        .sort((a, b) => {
          const aOnline = onlineUserIdsSet.has(a.id) ? 1 : 0;
          const bOnline = onlineUserIdsSet.has(b.id) ? 1 : 0;
          return bOnline - aOnline;
        });
      
      listContainer.innerHTML = '';
      
      if (!sortedPeers.length) {
        listContainer.innerHTML = '<div class="skills-empty-hint">No peers found in the network.</div>';
        if (submitBtn) submitBtn.disabled = true;
        return;
      }
      
      sortedPeers.forEach(peer => {
        const isOnline = onlineUserIdsSet.has(peer.id);
        const displayName = peer.fullname || peer.username;
        
        // Check if this user is already a participant in the active call
        const existingP = (isGroupCall && groupRoomId)
          ? groupParticipants.find(p => p.userId === peer.id)
          : null;

        if (existingP) {
          // Already in call or invited — show status badge, no checkbox
          const statusMap = {
            host:      { label: 'Host',      color: 'var(--primary-light)', bg: 'rgba(139,92,246,0.12)' },
            connected: { label: 'Active',    color: 'var(--success)',       bg: 'rgba(16,185,129,0.12)' },
            invited:   { label: 'Invited',   color: 'var(--warning)',       bg: 'rgba(245,158,11,0.12)' },
          };
          const s = statusMap[existingP.status] || { label: existingP.status, color: 'var(--text-muted)', bg: 'rgba(255,255,255,0.05)' };
          const row = document.createElement('div');
          row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 6px; border-bottom: 1px solid var(--border-subtle);';
          row.innerHTML = `
            <span style="font-size: 0.9rem; color: var(--text-secondary);">${displayName}</span>
            <span style="font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 5px; background: ${s.bg}; color: ${s.color};">${s.label}</span>
          `;
          listContainer.appendChild(row);
        } else {
          // Not yet in call — show checkbox so user can invite
          const item = document.createElement('label');
          item.className = 'invite-peer-checkbox-item';
          if (!isOnline) item.style.opacity = '0.6';
          item.innerHTML = `
            <input type="checkbox" name="invite-peer" value="${peer.id}" data-name="${displayName}">
            <span style="display: flex; align-items: center; gap: 8px; width: 100%;">
              <span style="width: 8px; height: 8px; border-radius: 50%; background: ${isOnline ? 'var(--success)' : 'var(--text-muted)'}; display: inline-block; flex-shrink: 0;"></span>
              <span style="flex: 1;"><strong>${displayName}</strong></span>
              <span style="font-size: 0.75rem; color: ${isOnline ? 'var(--success)' : 'var(--text-muted)'}">${isOnline ? 'Online' : 'Offline'}</span>
            </span>
          `;
          item.querySelector('input').addEventListener('change', () => {
            const checked = document.querySelectorAll('input[name="invite-peer"]:checked').length;
            if (submitBtn) submitBtn.disabled = checked === 0;
          });
          listContainer.appendChild(item);
        }
      });
      if (submitBtn) submitBtn.disabled = true;
    })
    .catch(() => {
      listContainer.innerHTML = '<div class="skills-empty-hint">Error loading peers list.</div>';
    });
}

async function loadCallHistory() {
  const container = el('call-history-list');
  if (!container) return;
  
  try {
    const data = await api('GET', '/api/calls/history');
    const logs = data.logs;
    if (!logs || !logs.length) {
      container.innerHTML = '<div class="empty-state-card"><i class="fa-solid fa-phone"></i><p>No recent classes logged.</p></div>';
      return;
    }
    
    container.innerHTML = '';
    logs.forEach(log => {
      const isCaller = log.caller_id === currentUser.id;
      const peerName = isCaller ? log.receiver_name : log.caller_name;
      const item = document.createElement('div');
      item.className = 'call-history-item';
      
      const dateStr = new Date(log.timestamp).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      const typeIcon = log.call_type === 'group' ? '<i class="fa-solid fa-users"></i> Group Class' : '<i class="fa-solid fa-user"></i> 1-on-1 Class';
      
      item.innerHTML = `
        <div class="call-history-meta">
          <div class="call-history-peers">${peerName}</div>
          <div class="call-history-type">${typeIcon}</div>
        </div>
        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
          <span class="call-history-status ${log.status}">${log.status}</span>
          <span class="call-history-time">${dateStr}</span>
        </div>
      `;
      container.appendChild(item);
    });
  } catch (err) {
    container.innerHTML = '<div class="empty-state-card"><i class="fa-solid fa-triangle-exclamation"></i><p>Failed to load history.</p></div>';
  }
}

// ==================================================
//  PEER PROFILE MODAL
// ==================================================
async function openPeerProfile(peerId) {
  show('peer-profile-modal');
  try {
    const data = await api('GET', `/api/users/${peerId}`);
    const u = data.user;
    el('modal-peer-name').textContent = u.fullname || u.username;
    el('modal-peer-bio').textContent = u.bio || 'No bio provided.';
    el('modal-peer-rating').innerHTML = `${renderStars(u.average_rating || 0)} ${parseFloat(u.average_rating || 0).toFixed(1)}`;
    el('modal-peer-status').className = 'online-dot ' + (u.is_online ? 'online' : 'offline');

    if (u.avatar_url) el('modal-peer-avatar').innerHTML = `<img src="${u.avatar_url}" alt="avatar">`;
    else el('modal-peer-avatar').innerHTML = `<i class="fa-solid fa-user-astronaut"></i>`;

    // Skills
    const teachList = el('modal-teach-skills');
    const learnList = el('modal-learn-skills');
    teachList.innerHTML = '';
    learnList.innerHTML = '';
    (u.teach_skills || []).forEach(s => {
      const tag = document.createElement('div');
      tag.className = 'modal-skill-tag';
      tag.textContent = s.skill_name;
      teachList.appendChild(tag);
    });
    (u.learn_skills || []).forEach(s => {
      const tag = document.createElement('div');
      tag.className = 'modal-skill-tag';
      tag.textContent = s.skill_name;
      learnList.appendChild(tag);
    });

    // Reviews
    const reviewsList = el('modal-reviews-list');
    reviewsList.innerHTML = '';
    if (u.reviews && u.reviews.length) {
      u.reviews.forEach(r => {
        const div = document.createElement('div');
        div.className = 'review-item';
        div.innerHTML = `
          <div class="review-item-header">
            <span class="reviewer-name">${r.reviewer_name}</span>
            <span class="review-stars">${renderStars(r.rating)}</span>
          </div>
          <p class="review-comment">${r.comment || ''}</p>
        `;
        reviewsList.appendChild(div);
      });
    } else {
      reviewsList.innerHTML = '<div class="empty-state-card"><i class="fa-solid fa-star"></i><p>No reviews yet.</p></div>';
    }

    el('modal-chat-btn').onclick = () => {
      hide('peer-profile-modal');
      openChat(u.id, u.fullname || u.username, u.avatar_url);
    };
    el('modal-book-btn').onclick = () => {
      hide('peer-profile-modal');
      openBookModal(u);
    };
  } catch (err) { toast('Could not load profile.', 'error'); }
}

// ==================================================
//  BOOK SESSION MODAL
// ==================================================
function openBookModal(peer) {
  currentBookingPeer = peer;
  show('book-modal');
  hide('book-error');

  // Set min datetime to now
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  el('book-datetime').min = now.toISOString().slice(0, 16);
  el('book-datetime').value = '';

  // Populate skill dropdown
  const skillSel = el('book-skill-name');
  skillSel.innerHTML = '';
  const peerTeach = (peer.teach_skills || []).map(s => s.skill_name);
  peerTeach.forEach(skill => {
    const opt = document.createElement('option');
    opt.value = skill; opt.textContent = skill;
    skillSel.appendChild(opt);
  });
  if (!peerTeach.length) {
    const opt = document.createElement('option');
    opt.value = 'General Exchange'; opt.textContent = 'General Exchange';
    skillSel.appendChild(opt);
  }
}

function initModals() {
  el('close-peer-profile-btn')?.addEventListener('click', () => hide('peer-profile-modal'));
  el('peer-profile-modal')?.addEventListener('click', e => { if (e.target === el('peer-profile-modal')) hide('peer-profile-modal'); });

  el('close-book-modal-btn')?.addEventListener('click', () => hide('book-modal'));
  el('cancel-book-modal-btn')?.addEventListener('click', () => hide('book-modal'));
  el('book-modal')?.addEventListener('click', e => { if (e.target === el('book-modal')) hide('book-modal'); });

  el('close-group-call-btn')?.addEventListener('click', () => hide('group-call-modal'));
  el('cancel-group-call-btn')?.addEventListener('click', () => hide('group-call-modal'));
  el('group-call-modal')?.addEventListener('click', e => { if (e.target === el('group-call-modal')) hide('group-call-modal'); });

  el('group-call-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    hide('group-call-modal');
    const checkedBoxes = document.querySelectorAll('input[name="invite-peer"]:checked');
    const invitedUsers = Array.from(checkedBoxes).map(cb => ({
      id: parseInt(cb.value),
      name: cb.dataset.name
    }));
    if (!invitedUsers.length) return;
    
    if (isGroupCall && groupRoomId) {
      // Active call: Send mid-call invitations
      socket.emit('group_call_invite', {
        roomId: groupRoomId,
        invitedUsers,
        senderName: currentUser.fullname || currentUser.username
      });
      invitedUsers.forEach(u => {
        if (!groupParticipants.some(p => p.userId === u.id)) {
          groupParticipants.push({ userId: u.id, userName: u.name, status: 'invited' });
        }
      });
      updateGroupParticipantsList();
      toast('Mid-call invitations sent!', 'success');
    } else {
      // No call active: Start a new group call
      await startGroupCall(invitedUsers);
    }
  });

  el('book-session-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    hide('book-error');
    if (!currentBookingPeer) return;
    try {
      await api('POST', '/api/sessions', {
        teacher_id: currentBookingPeer.id,
        skill_name: el('book-skill-name').value,
        scheduled_at: el('book-datetime').value
      });
      hide('book-modal');
      toast(`📅 Class booked with ${currentBookingPeer.fullname || currentBookingPeer.username}!`, 'success');
      if (currentUser.credits) {
        currentUser.credits = Math.max(0, currentUser.credits - 1);
        el('credits-count').textContent = currentUser.credits;
      }
      switchTab('sessions');
      qsa('.header-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'sessions'));
      loadSessions();
    } catch (err) {
      el('book-error').textContent = err.message;
      show('book-error');
    }
  });

  // Review Modal
  el('skip-review-btn')?.addEventListener('click', () => hide('review-modal'));
  el('review-modal')?.addEventListener('click', e => { if (e.target === el('review-modal')) hide('review-modal'); });

  el('review-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    hide('review-error');
    if (!currentReviewSession) return;
    const rating = parseInt(document.querySelector('input[name="modal-rating"]:checked')?.value || '0');
    if (!rating) { el('review-error').textContent = 'Please select a rating.'; show('review-error'); return; }

    try {
      await api('POST', '/api/reviews', {
        session_id: currentReviewSession.sessionId,
        rating,
        comment: el('review-comment').value.trim()
      });
      hide('review-modal');
      toast('Thanks for your review! 🌟', 'success');
      loadSessions();
    } catch (err) {
      el('review-error').textContent = err.message;
      show('review-error');
    }
  });
}

function openReviewModal(sessionId, peerName) {
  currentReviewSession = { sessionId };
  show('review-modal');
  el('review-comment').value = '';
  qsa('input[name="modal-rating"]').forEach(r => r.checked = false);
  hide('review-error');
}

// ==================================================
//  CHATS & PERSISTENT STUDY GROUPS
// ==================================================
let currentActiveChatId = null; // number (userId) or string (e.g. 'group_5')
let activeGroupsList = [];

function initChatsPage() {
  el('create-group-btn')?.addEventListener('click', () => {
    openCreateGroupModal();
  });
  
  el('close-create-group-btn')?.addEventListener('click', () => hide('create-group-modal'));
  el('cancel-create-group-btn')?.addEventListener('click', () => hide('create-group-modal'));
  el('create-group-modal')?.addEventListener('click', e => {
    if (e.target === el('create-group-modal')) hide('create-group-modal');
  });

  el('close-add-member-btn')?.addEventListener('click', () => hide('add-member-modal'));
  el('cancel-add-member-btn')?.addEventListener('click', () => hide('add-member-modal'));
  el('add-member-modal')?.addEventListener('click', e => {
    if (e.target === el('add-member-modal')) hide('add-member-modal');
  });

  // Mobile back button - return to chats sidebar list
  el('chats-back-btn')?.addEventListener('click', () => {
    if (window.innerWidth < 768) {
      el('chats-window')?.classList.remove('mobile-active');
      document.body.classList.remove('mobile-chat-active');
      currentActiveChatId = null;
    }
  });

  // Attach button triggers hidden file input
  el('chats-attach-btn')?.addEventListener('click', () => {
    el('chats-file-input')?.click();
  });

  // Selected file processing & preview overlay
  el('chats-file-input')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast('File is too large! Maximum limit is 8MB.', 'error');
      e.target.value = '';
      return;
    }
    activeUploadFile = file;
    const reader = new FileReader();
    reader.onload = function(evt) {
      activeUploadDataUrl = evt.target.result;
      const previewBody = el('chats-preview-body');
      previewBody.innerHTML = '';
      if (file.type.startsWith('image/')) {
        previewBody.innerHTML = `
          <img src="${activeUploadDataUrl}" style="max-width: 100%; max-height: 250px; object-fit: contain; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.5);">
          <div style="margin-top: 12px; font-weight: 500; text-align: center; color: #fff;">${file.name}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">${formatBytes(file.size)}</div>
        `;
      } else {
        previewBody.innerHTML = `
          <i class="fa-solid fa-file-lines" style="font-size: 4rem; color: var(--accent); margin-bottom: 12px;"></i>
          <div style="font-weight: 500; text-align: center; color: #fff; max-width: 90%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${file.name}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">${formatBytes(file.size)}</div>
        `;
      }
      el('chats-preview-caption').value = '';
      el('chats-file-preview-overlay').classList.remove('hidden');
      el('chats-preview-caption').focus();
    };
    reader.readAsDataURL(file);
  });

  // Discard preview actions
  const discardPreview = () => {
    el('chats-file-preview-overlay').classList.add('hidden');
    el('chats-file-input').value = '';
    activeUploadFile = null;
    activeUploadDataUrl = null;
  };
  el('chats-preview-discard-btn')?.addEventListener('click', discardPreview);
  el('chats-preview-cancel-btn')?.addEventListener('click', discardPreview);

  // Send preview file attachment
  el('chats-preview-send-btn')?.addEventListener('click', async () => {
    if (!activeUploadFile || !activeUploadDataUrl) return;
    const caption = el('chats-preview-caption').value.trim();
    const payload = '[FILE_JSON]:' + JSON.stringify({
      type: activeUploadFile.type.startsWith('image/') ? 'image' : 'file',
      fileName: activeUploadFile.name,
      fileSize: activeUploadFile.size,
      fileType: activeUploadFile.type,
      fileData: activeUploadDataUrl,
      caption: caption
    });
    try {
      await sendChatMessage(payload);
      discardPreview();
    } catch (err) {
      toast('Failed to send file: ' + err.message, 'error');
    }
  });

  // Image Viewer Overlay Close button
  el('close-image-viewer-btn')?.addEventListener('click', () => {
    el('image-viewer-overlay').classList.add('hidden');
  });

  el('create-group-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    hide('create-group-error');
    const name = el('group-name-input').value.trim();
    if (!name) return;

    const checkedBoxes = document.querySelectorAll('input[name="group-member-invite"]:checked');
    const memberIds = Array.from(checkedBoxes).map(cb => parseInt(cb.value));

    try {
      const res = await api('POST', '/api/groups', { name, memberIds });
      hide('create-group-modal');
      toast(`👥 Group "${name}" created!`, 'success');
      loadChatsPage();
      // Auto-select the newly created group
      selectChat(`group_${res.groupId}`, name, null);
    } catch (err) {
      el('create-group-error').textContent = err.message;
      show('create-group-error');
    }
  });

  el('chats-search-input')?.addEventListener('input', e => {
    const query = e.target.value.toLowerCase().trim();
    qsa('.chat-item').forEach(item => {
      const name = item.querySelector('.chat-item-name').textContent.toLowerCase();
      item.style.display = name.includes(query) ? 'flex' : 'none';
    });
  });

  // Local Message Search Toggle
  el('chats-toggle-search-btn')?.addEventListener('click', () => {
    const container = el('chats-local-search-container');
    container.classList.toggle('hidden');
    if (!container.classList.contains('hidden')) {
      el('chats-local-search-input').focus();
    } else {
      el('chats-local-search-input').value = '';
      // Reset filter
      document.querySelectorAll('.msg-bubble').forEach(b => b.style.display = '');
    }
  });

  el('chats-local-search-close')?.addEventListener('click', () => {
    el('chats-local-search-container').classList.add('hidden');
    el('chats-local-search-input').value = '';
    document.querySelectorAll('.msg-bubble').forEach(b => b.style.display = '');
  });

  el('chats-local-search-input')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    document.querySelectorAll('.msg-bubble').forEach(bubble => {
      const textEl = bubble.querySelector('.msg-text-content') || bubble;
      if (!q) {
        bubble.style.display = '';
      } else {
        bubble.style.display = textEl.textContent.toLowerCase().includes(q) ? '' : 'none';
      }
    });
  });

  // Quoted Reply Cancel button
  el('chats-reply-cancel-btn')?.addEventListener('click', () => {
    clearReplyPreview();
  });

  // Typing state emissions on keyboard input
  const inputEl = el('chats-message-input');
  inputEl?.addEventListener('input', () => {
    if (!currentActiveChatId || !socket || !socket.connected) return;
    const isGroup = typeof currentActiveChatId === 'string' && currentActiveChatId.startsWith('group_');
    const receiverId = isGroup ? currentActiveChatId.replace('group_', '') : currentActiveChatId;

    if (!isTyping) {
      isTyping = true;
      socket.emit('typing', { receiver_id: receiverId, is_group: isGroup });
    }

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      isTyping = false;
      socket.emit('stop_typing', { receiver_id: receiverId, is_group: isGroup });
    }, 2000);
  });

  // Escape key cancels Editing mode
  inputEl?.addEventListener('keydown', e => {
    if (e.key === 'Escape' && editMessageId) {
      editMessageId = null;
      inputEl.value = '';
      inputEl.style.border = '';
      toast('Edit cancelled', 'info');
    }
  });

  el('chats-input-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const input = el('chats-message-input');
    const message = input.value.trim();
    if (!message || !currentActiveChatId) return;

    try {
      // If typing, stop it immediately on send
      if (isTyping) {
        isTyping = false;
        const isGroup = typeof currentActiveChatId === 'string' && currentActiveChatId.startsWith('group_');
        const receiverId = isGroup ? currentActiveChatId.replace('group_', '') : currentActiveChatId;
        socket.emit('stop_typing', { receiver_id: receiverId, is_group: isGroup });
        clearTimeout(typingTimeout);
      }

      await sendChatMessage(message);
      input.value = '';
    } catch (err) {
      toast('Failed to send message: ' + err.message, 'error');
    }
  });
}

async function sendChatMessage(message) {
  const isGroup = typeof currentActiveChatId === 'string' && currentActiveChatId.startsWith('group_');
  const logEl = el('chats-messages-log');

  // Handle Editing mode
  if (editMessageId) {
    if (socket && socket.connected) {
      socket.emit('edit_message', { id: editMessageId, is_group: isGroup, message });
    }
    editMessageId = null;
    el('chats-message-input').style.border = '';
    return;
  }

  // Handle Offline Queuing if offline
  if (!navigator.onLine) {
    saveOfflineMessage({
      chatId: currentActiveChatId,
      message,
      replyToId: activeReplyMessageId,
      timestamp: new Date().toISOString()
    });
    appendChatMessageToElement(logEl, message, 'outgoing', null, `offline_${Date.now()}`, 'offline', activeReplyMessageId);
    clearReplyPreview();
    return;
  }

  const replyToId = activeReplyMessageId;
  clearReplyPreview();

  if (isGroup) {
    const groupId = currentActiveChatId.replace('group_', '');
    if (socket && socket.connected) {
      socket.emit('send_group_message', { group_id: groupId, message, reply_to_id: replyToId });
      appendChatMessageToElement(logEl, message, 'outgoing', null, null, 'sent', replyToId);
    } else {
      const res = await api('POST', `/api/groups/${groupId}/messages`, { message, reply_to_id: replyToId });
      appendChatMessageToElement(logEl, message, 'outgoing', null, res.id, 'sent', replyToId);
    }
  } else {
    if (socket && socket.connected) {
      socket.emit('send_message', { receiver_id: currentActiveChatId, message, sender_name: currentUser.username, reply_to_id: replyToId });
      appendChatMessageToElement(logEl, message, 'outgoing', null, null, 'sent', replyToId);
    } else {
      const res = await api('POST', '/api/messages', { receiver_id: currentActiveChatId, message, reply_to_id: replyToId });
      appendChatMessageToElement(logEl, message, 'outgoing', null, res.id, 'sent', replyToId);
    }
  }
}

function clearReplyPreview() {
  activeReplyMessageId = null;
  el('chats-reply-preview-bar').classList.add('hidden');
}

function saveOfflineMessage(msg) {
  offlineMessageQueue.push(msg);
  localStorage.setItem('offline_messages_queue', JSON.stringify(offlineMessageQueue));
  toast('You are offline. Message queued and will send on reconnect.', 'warning');
}

async function flushOfflineMessages() {
  if (offlineMessageQueue.length === 0) return;
  toast('Connection restored! Sending queued messages...', 'success');
  const queue = [...offlineMessageQueue];
  offlineMessageQueue = [];
  localStorage.removeItem('offline_messages_queue');
  
  for (const msg of queue) {
    if (msg.chatId === currentActiveChatId) {
      document.querySelectorAll('.msg-bubble[data-msg-id^="offline_"]').forEach(b => b.remove());
    }
    try {
      currentActiveChatId = msg.chatId;
      activeReplyMessageId = msg.replyToId;
      await sendChatMessage(msg.message);
    } catch (e) {
      console.error('Failed to send offline message:', e);
    }
  }
}

window.addEventListener('online', flushOfflineMessages);
window.addEventListener('load', () => {
  try {
    offlineMessageQueue = JSON.parse(localStorage.getItem('offline_messages_queue') || '[]');
    if (navigator.onLine && offlineMessageQueue.length > 0) {
      flushOfflineMessages();
    }
  } catch {}
});

async function loadChatsPage() {
  const listContainer = el('chats-list-container');
  if (!listContainer) return;

  listContainer.innerHTML = '<div class="skills-empty-hint"><i class="fa-solid fa-spinner fa-spin"></i> Loading chats...</div>';

  try {
    const [groupsData, exploreData, matchesData] = await Promise.all([
      api('GET', '/api/groups'),
      api('GET', '/api/users/explore'),
      api('GET', '/api/matches').catch(() => ({ matches: [] }))
    ]);

    activeGroupsList = groupsData.groups || [];
    const peers = exploreData.users || [];
    const matches = matchesData.matches || [];
    const matchIds = new Set(matches.map(m => m.id));
    const perfectMatchIds = new Set(matches.filter(m => m.match_type === 'perfect').map(m => m.id));

    listContainer.innerHTML = '';

    // Render groups section
    if (activeGroupsList.length > 0) {
      const groupHeader = document.createElement('div');
      groupHeader.className = 'col-header teach-header';
      groupHeader.style.margin = '8px 0 4px 0';
      groupHeader.innerHTML = '<i class="fa-solid fa-users"></i> Study Groups';
      listContainer.appendChild(groupHeader);

      activeGroupsList.forEach(g => {
        const item = document.createElement('div');
        item.className = 'chat-item';
        item.dataset.groupId = g.id;
        if (currentActiveChatId === `group_${g.id}`) item.classList.add('active');

        item.innerHTML = `
          <div class="chat-item-avatar" style="background: rgba(139, 92, 246, 0.15); color: #8b5cf6;">
            <i class="fa-solid fa-people-group"></i>
          </div>
          <div class="chat-item-info">
            <div class="chat-item-name-row">
              <span class="chat-item-name">${g.name}</span>
              <span class="chat-item-badge">${g.member_count}</span>
            </div>
            <span class="chat-item-preview">Group Classroom</span>
          </div>
        `;
        item.addEventListener('click', () => selectChat(`group_${g.id}`, g.name, null));
        listContainer.appendChild(item);
      });
    }

    // Render direct matched peers/contacts section
    const peerHeader = document.createElement('div');
    peerHeader.className = 'col-header learn-header';
    peerHeader.style.margin = '16px 0 4px 0';
    peerHeader.innerHTML = '<i class="fa-solid fa-user-friends"></i> Contacts & Peers';
    listContainer.appendChild(peerHeader);

    if (peers.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'skills-empty-hint';
      hint.textContent = 'No other users found.';
      listContainer.appendChild(hint);
    } else {
      // Sort: perfect matches first, then partial matches, then the rest
      peers.sort((a, b) => {
        const aPerfect = perfectMatchIds.has(a.id) ? 1 : 0;
        const bPerfect = perfectMatchIds.has(b.id) ? 1 : 0;
        if (aPerfect !== bPerfect) return bPerfect - aPerfect;

        const aMatched = matchIds.has(a.id) ? 1 : 0;
        const bMatched = matchIds.has(b.id) ? 1 : 0;
        if (aMatched !== bMatched) return bMatched - aMatched;

        return (a.fullname || a.username).localeCompare(b.fullname || b.username);
      });

      peers.forEach(m => {
        const item = document.createElement('div');
        item.className = 'chat-item';
        item.dataset.userId = m.id;
        if (currentActiveChatId === m.id) item.classList.add('active');

        const isOnline = onlineUserIdsSet.has(m.id);
        const avatarHtml = m.avatar_url 
          ? `<img src="${m.avatar_url}" alt="avatar">` 
          : `<i class="fa-solid fa-user"></i>`;

        let matchBadgeHtml = '';
        if (perfectMatchIds.has(m.id)) {
          matchBadgeHtml = '<span class="chat-item-badge" style="background: var(--accent); margin-left: auto;">⚡ Perfect</span>';
        } else if (matchIds.has(m.id)) {
          matchBadgeHtml = '<span class="chat-item-badge" style="background: var(--primary-light); margin-left: auto;">🤝 Match</span>';
        }

        item.innerHTML = `
          <div class="chat-item-avatar">
            ${avatarHtml}
          </div>
          <div class="chat-item-info">
            <div class="chat-item-name-row">
              <span class="chat-item-name">${m.fullname || m.username}</span>
              ${matchBadgeHtml}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span class="chat-item-preview">${m.bio ? m.bio.slice(0, 40) + '...' : 'No bio provided'}</span>
              <span class="status-only-dot ${isOnline ? 'online' : 'offline'}" style="flex-shrink: 0; margin-left: 6px;"></span>
            </div>
          </div>
        `;
        item.addEventListener('click', () => selectChat(m.id, m.fullname || m.username, m.avatar_url));
        listContainer.appendChild(item);
      });
    }
  } catch (err) {
    listContainer.innerHTML = `<div class="error-msg">Failed to load: ${err.message}</div>`;
  }
}

async function selectChat(id, name, avatarUrl) {
  currentActiveChatId = id;
  activeChat.avatarUrl = avatarUrl; // Cache for calling avatar representation

  // On mobile: slide in chat window
  if (window.innerWidth < 768) {
    el('chats-window')?.classList.add('mobile-active');
    document.body.classList.add('mobile-chat-active');
    history.pushState({ view: 'chat', chatId: id }, '', '#chat_' + id);
  } else {
    el('chats-window')?.classList.remove('mobile-active');
    document.body.classList.remove('mobile-chat-active');
  }
  
  // Highlight active chat item
  qsa('.chat-item').forEach(item => {
    const isGroup = typeof id === 'string' && id.startsWith('group_');
    if (isGroup) {
      item.classList.toggle('active', item.dataset.groupId == id.replace('group_', ''));
    } else {
      item.classList.toggle('active', item.dataset.userId == id);
    }
  });

  hide('chats-window-empty');
  show('chats-window-active');

  const nameEl = el('chats-header-name');
  nameEl.textContent = name;

  const avatarEl = el('chats-header-avatar');
  const isGroup = typeof id === 'string' && id.startsWith('group_');
  if (avatarUrl) {
    avatarEl.innerHTML = `<img src="${avatarUrl}" alt="avatar">`;
  } else {
    avatarEl.innerHTML = isGroup ? `<i class="fa-solid fa-people-group"></i>` : `<i class="fa-solid fa-user"></i>`;
  }

  const statusEl = el('chats-header-status');
  const callBtn = el('chats-start-call-btn');
  const deleteGroupBtn = el('chats-delete-group-btn');

  const toggleMembersBtn = el('chats-toggle-members-btn');
  const membersSidebar = el('chats-members-sidebar');
  const membersListEl = el('chats-members-list');

  if (isGroup) {
    statusEl.textContent = 'Group Chat';
    statusEl.className = 'online-dot online';
    callBtn.innerHTML = '<i class="fa-solid fa-users"></i> <span>Start Class</span>';
    callBtn.onclick = async () => {
      const groupId = id.replace('group_', '');
      try {
        const membersData = await api('GET', `/api/groups/${groupId}/members`);
        classroomGroupMembers = membersData.members
          .filter(m => m.id !== currentUser.id)
          .map(m => ({ id: m.id, name: m.fullname || m.name || m.username }));
        
        await startGroupCall([]);
      } catch (err) {
        toast('Failed to start group call: ' + err.message, 'error');
      }
    };

    // Show toggle button and config members sidebar visibility
    toggleMembersBtn.classList.remove('hidden');
    if (window.innerWidth > 768) {
      membersSidebar.classList.remove('hidden');
    } else {
      membersSidebar.classList.add('hidden');
    }

    toggleMembersBtn.onclick = () => {
      membersSidebar.classList.toggle('hidden');
    };

    // Fetch and render actual group members list
    const groupId = id.replace('group_', '');
    api('GET', `/api/groups/${groupId}`).then(groupData => {
      membersListEl.innerHTML = '';
      
      const isOwner = groupData.created_by === currentUser.id;
      let isAdmin = false;
      
      if (groupData && Array.isArray(groupData.members)) {
        const meInGroup = groupData.members.find(m => m.id === currentUser.id);
        if (meInGroup && meInGroup.role === 'admin') {
          isAdmin = true;
        }

        const addMemberBtn = el('chats-group-add-btn');
        if (addMemberBtn) {
          if (isOwner || isAdmin) {
            addMemberBtn.classList.remove('hidden');
            addMemberBtn.onclick = () => {
              openAddMemberModal(groupId, groupData.members);
            };
          } else {
            addMemberBtn.classList.add('hidden');
          }
        }

        groupData.members.forEach(member => {
          const isMe = member.id === currentUser.id;
          const isOnline = onlineUserIdsSet.has(member.id);
          const avatarHtml = member.avatar_url 
            ? `<img src="${member.avatar_url}" alt="avatar" style="width: 32px; height: 32px; border-radius: 50%;">`
            : `<div style="width: 32px; height: 32px; border-radius: 50%; background: rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: center; font-size: 0.8rem;"><i class="fa-solid fa-user"></i></div>`;
          
          const memberItem = document.createElement('div');
          memberItem.style.cssText = 'display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); justify-content: space-between;';
          const dotColor  = isOnline ? '#10b981' : '#475569';
          const dotShadow = isOnline ? 'box-shadow: 0 0 5px #10b981;' : '';
          
          let removeBtnHtml = '';
          if ((isOwner || isAdmin) && !isMe) {
            removeBtnHtml = `
              <button class="btn-remove-member" title="Remove member" style="background: transparent; border: none; color: #f43f5e; cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center; font-size: 0.82rem; transition: transform 0.15s ease;">
                <i class="fa-solid fa-user-minus"></i>
              </button>
            `;
          }

          memberItem.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;">
              <div style="position: relative; flex-shrink: 0;">
                ${avatarHtml}
                <div class="member-online-dot" data-user-id="${member.id}" style="position: absolute; bottom: 1px; right: 1px; width: 9px; height: 9px; border-radius: 50%; background: ${dotColor}; border: 2px solid #0a0e1a; ${dotShadow}"></div>
              </div>
              <div style="flex: 1; min-width: 0;">
                <div style="font-size: 0.88rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #f1f5f9;">
                  ${member.fullname || member.name}${isMe ? ' <span style="color:#8b5cf6; font-size:0.78rem;">(You)</span>' : ''}
                </div>
                <div style="font-size: 0.75rem; color: #64748b; text-transform: capitalize; margin-top: 2px;">
                  ${member.role || 'member'}
                </div>
              </div>
            </div>
            ${removeBtnHtml}
          `;

          const removeBtn = memberItem.querySelector('.btn-remove-member');
          if (removeBtn) {
            removeBtn.onclick = async e => {
              e.stopPropagation();
              if (confirm(`Remove ${member.fullname || member.name} from the group?`)) {
                try {
                  await api('DELETE', `/api/groups/${groupId}/members/${member.id}`);
                  toast('Member removed successfully.', 'success');
                  selectChat(id, name, avatarUrl);
                } catch (err) {
                  toast('Failed to remove member: ' + err.message, 'error');
                }
              }
            };
          }

          membersListEl.appendChild(memberItem);
        });
      }

      // Configure delete group button visibility
      if (deleteGroupBtn) {
        if (isOwner || isAdmin) {
          deleteGroupBtn.classList.remove('hidden');
          deleteGroupBtn.onclick = () => {
            const confirmed = confirm('Are you sure you want to delete this group? This action cannot be undone.');
            if (confirmed) {
              api('DELETE', `/api/groups/${groupId}`)
                .then(() => {
                  toast('Group deleted successfully.', 'success');
                  hide('chats-window-active');
                  show('chats-window-empty');
                  currentActiveChatId = null;
                  loadChatPanel();
                })
                .catch(err => {
                  toast('Failed to delete group: ' + err.message, 'error');
                });
            }
          };
        } else {
          deleteGroupBtn.classList.add('hidden');
        }
      }
    }).catch(err => {
      console.error('Failed to load group members list:', err);
      membersListEl.innerHTML = '<div style="font-size: 0.85rem; color: var(--danger); padding: 8px;">Failed to load roster</div>';
      if (deleteGroupBtn) deleteGroupBtn.classList.add('hidden');
    });
  } else {
    toggleMembersBtn.classList.add('hidden');
    membersSidebar.classList.add('hidden');
    if (deleteGroupBtn) deleteGroupBtn.classList.add('hidden');

    const isOnline = onlineUserIdsSet.has(id);
    statusEl.textContent = isOnline ? 'online' : 'offline';
    statusEl.className = 'online-dot ' + (isOnline ? 'online' : 'offline');
    callBtn.innerHTML = '<i class="fa-solid fa-video"></i> <span>Start Class</span>';
    callBtn.onclick = () => {
      openVideoCall(id, name);
    };
  }

  const logEl = el('chats-messages-log');
  logEl.innerHTML = '<div class="skills-empty-hint"><i class="fa-solid fa-spinner fa-spin"></i> Loading messages...</div>';

  try {
    if (isGroup) {
      const groupId = id.replace('group_', '');
      const data = await api('GET', `/api/groups/${groupId}/messages`);
      logEl.innerHTML = '';
      data.messages.forEach(m => {
        appendChatMessageToElement(logEl, m.message, m.sender_id === currentUser.id ? 'outgoing' : 'incoming', m.sender_name, m.id, 'sent', m.reply_to_id, m.reactions, m.is_edited, m.is_deleted);
      });
      // Mark group messages as read
      if (socket && socket.connected) {
        socket.emit('mark_group_as_read', { group_id: groupId });
      }
    } else {
      const data = await api('GET', `/api/messages/${id}`);
      logEl.innerHTML = '';
      data.messages.forEach(m => {
        if (m.is_call_log) {
          appendChatMessageToElement(logEl, m.message, m.sender_id === currentUser.id ? 'outgoing call-log' : 'incoming call-log');
        } else {
          appendChatMessageToElement(logEl, m.message, m.sender_id === currentUser.id ? 'outgoing' : 'incoming', null, m.id, m.status, m.reply_to_id, m.reactions, m.is_edited, m.is_deleted);
        }
      });
      // Mark direct messages as read
      if (socket && socket.connected) {
        socket.emit('mark_as_read', { partner_id: id });
      }
    }
    logEl.scrollTop = logEl.scrollHeight;
  } catch (err) {
    logEl.innerHTML = `<div class="error-msg">Failed to load: ${err.message}</div>`;
  }
}

function appendChatMessageToElement(logEl, text, direction, senderName = null, id = null, status = 'sent', replyToId = null, reactions = '[]', isEdited = 0, isDeleted = 0) {
  const div = document.createElement('div');
  div.className = `msg-bubble ${direction}`;
  if (id) div.setAttribute('data-msg-id', id);

  // Render reply quote box if this message is a reply to another message
  if (replyToId) {
    const quoteDiv = document.createElement('div');
    quoteDiv.className = 'msg-quote-box';
    const origMsg = document.querySelector(`.msg-bubble[data-msg-id="${replyToId}"]`);
    let quoteText = 'Original message';
    if (origMsg) {
      const textEl = origMsg.querySelector('.msg-text-content') || origMsg;
      quoteText = textEl.textContent.trim();
    }
    quoteDiv.textContent = quoteText;
    quoteDiv.addEventListener('click', () => {
      origMsg?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      origMsg?.style.setProperty('background', 'rgba(139,92,246,0.3)', 'important');
      setTimeout(() => {
        origMsg?.style.setProperty('background', '');
      }, 1000);
    });
    div.appendChild(quoteDiv);
  }

  const textEl = document.createElement('span');
  textEl.className = 'msg-text-content';
  
  if (direction.includes('call-log')) {
    textEl.innerHTML = text;
    div.appendChild(textEl);
  } else if (text.startsWith('[FILE_JSON]:')) {
    try {
      const fileInfo = JSON.parse(text.slice(12));
      
      if (senderName && direction === 'incoming') {
        const nameSpan = document.createElement('span');
        nameSpan.style.display = 'block';
        nameSpan.style.fontSize = '0.75rem';
        nameSpan.style.color = '#8b5cf6';
        nameSpan.style.fontWeight = '700';
        nameSpan.style.marginBottom = '4px';
        nameSpan.textContent = senderName;
        textEl.appendChild(nameSpan);
      }

      if (fileInfo.type === 'image') {
        const img = document.createElement('img');
        img.src = fileInfo.fileData;
        img.style.cssText = 'max-width: 100%; max-height: 200px; border-radius: 8px; cursor: pointer; display: block; object-fit: cover;';
        img.title = 'Click to view full screen';
        img.addEventListener('click', () => {
          el('viewer-img').src = fileInfo.fileData;
          el('image-viewer-overlay').classList.remove('hidden');
        });
        textEl.appendChild(img);
      } else {
        const docCard = document.createElement('a');
        docCard.href = fileInfo.fileData;
        docCard.download = fileInfo.fileName;
        docCard.style.cssText = 'display: flex; align-items: center; gap: 10px; text-decoration: none; color: inherit; background: rgba(255,255,255,0.05); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 4px;';
        docCard.innerHTML = `
          <i class="fa-solid fa-file-arrow-down" style="font-size: 1.5rem; color: var(--accent); flex-shrink: 0;"></i>
          <div style="min-width: 0; flex: 1;">
            <div style="font-weight: 500; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #fff;">${fileInfo.fileName}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">${formatBytes(fileInfo.fileSize)}</div>
          </div>
        `;
        textEl.appendChild(docCard);
      }

      if (fileInfo.caption) {
        const captionDiv = document.createElement('div');
        captionDiv.style.cssText = 'margin-top: 6px; font-size: 0.82rem; color: var(--text-primary); line-height: 1.4;';
        captionDiv.textContent = fileInfo.caption;
        textEl.appendChild(captionDiv);
      }
      div.appendChild(textEl);
    } catch (e) {
      console.error('Failed to parse file payload:', e);
      textEl.textContent = '[Corrupted attachment]';
      div.appendChild(textEl);
    }
  } else {
    if (senderName && direction === 'incoming') {
      const nameSpan = document.createElement('span');
      nameSpan.style.display = 'block';
      nameSpan.style.fontSize = '0.75rem';
      nameSpan.style.color = '#8b5cf6';
      nameSpan.style.fontWeight = '700';
      nameSpan.style.marginBottom = '4px';
      nameSpan.textContent = senderName;
      textEl.appendChild(nameSpan);
      textEl.appendChild(document.createTextNode(text));
    } else {
      textEl.appendChild(document.createTextNode(text));
    }
    div.appendChild(textEl);
  }

  // Display status tick for outgoing chat bubbles
  if (direction === 'outgoing' && !direction.includes('call-log')) {
    const tick = document.createElement('i');
    tick.style.cssText = 'font-size: 0.72rem; margin-left: 6px; vertical-align: middle; float: right; margin-top: 6px;';
    if (status === 'read') {
      tick.className = 'fa-solid fa-check-double msg-status-tick';
      tick.style.color = '#3b82f6';
    } else if (status === 'delivered') {
      tick.className = 'fa-solid fa-check-double msg-status-tick';
      tick.style.color = 'var(--text-muted)';
    } else {
      tick.className = 'fa-solid fa-check msg-status-tick';
      tick.style.color = 'var(--text-muted)';
    }
    div.appendChild(tick);
  }

  // Render (edited) indicator label if applicable
  if (isEdited) {
    const editedLabel = document.createElement('span');
    editedLabel.className = 'msg-edited-label';
    editedLabel.style.cssText = 'font-size: 0.65rem; color: var(--text-muted); margin-left: 6px; font-style: italic;';
    editedLabel.textContent = '(edited)';
    div.appendChild(editedLabel);
  }

  // Action actions popup toggle trigger
  if (id && !direction.includes('call-log')) {
    const actionBtn = document.createElement('span');
    actionBtn.className = 'msg-action-btn';
    actionBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical" style="padding: 4px; border-radius: 50%;"></i>';
    actionBtn.title = 'Message options';
    actionBtn.addEventListener('click', e => {
      e.stopPropagation();
      showMsgActionsMenu(div, id, text, direction);
    });
    div.appendChild(actionBtn);
  }

  // Reactions rendering
  if (id && reactions) {
    renderBubbleReactions(div, id, reactions);
  }

  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function showMsgActionsMenu(bubble, id, text, direction) {
  document.querySelectorAll('.msg-actions-menu').forEach(m => m.remove());
  document.querySelectorAll('.msg-reactions-picker').forEach(p => p.remove());

  const menu = document.createElement('div');
  menu.className = 'msg-actions-menu';
  menu.style.cssText = 'position: absolute; background: #0f1322; border: 1px solid rgba(139,92,246,0.3); border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); padding: 4px; display: flex; flex-direction: column; gap: 4px; z-index: 1000; font-size: 0.8rem;';

  const rect = bubble.getBoundingClientRect();
  const parentRect = bubble.parentElement.getBoundingClientRect();
  menu.style.top = (rect.top - parentRect.top - 40) + 'px';
  menu.style.left = (rect.left - parentRect.left + rect.width / 2 - 50) + 'px';

  // React item
  const reactBtn = document.createElement('button');
  reactBtn.style.cssText = 'background: transparent; border: none; color: #fff; padding: 6px 12px; text-align: left; cursor: pointer; display: flex; align-items: center; gap: 8px; width: 100%; font-family: inherit; font-size: 0.78rem; border-radius: 4px;';
  reactBtn.innerHTML = '<i class="fa-solid fa-face-smile" style="color: #eab308;"></i> React';
  reactBtn.onmouseenter = () => reactBtn.style.background = 'rgba(255,255,255,0.05)';
  reactBtn.onmouseleave = () => reactBtn.style.background = 'transparent';
  reactBtn.onclick = () => {
    menu.remove();
    showEmojiPicker(bubble, id);
  };
  menu.appendChild(reactBtn);

  // Reply item
  const replyBtn = document.createElement('button');
  replyBtn.style.cssText = 'background: transparent; border: none; color: #fff; padding: 6px 12px; text-align: left; cursor: pointer; display: flex; align-items: center; gap: 8px; width: 100%; font-family: inherit; font-size: 0.78rem; border-radius: 4px;';
  replyBtn.innerHTML = '<i class="fa-solid fa-reply" style="color: var(--accent);"></i> Reply';
  replyBtn.onmouseenter = () => replyBtn.style.background = 'rgba(255,255,255,0.05)';
  replyBtn.onmouseleave = () => replyBtn.style.background = 'transparent';
  replyBtn.onclick = () => {
    menu.remove();
    startQuotedReply(id, text);
  };
  menu.appendChild(replyBtn);

  // Edit / Delete outgoing only
  if (direction === 'outgoing') {
    const editBtn = document.createElement('button');
    editBtn.style.cssText = 'background: transparent; border: none; color: #fff; padding: 6px 12px; text-align: left; cursor: pointer; display: flex; align-items: center; gap: 8px; width: 100%; font-family: inherit; font-size: 0.78rem; border-radius: 4px;';
    editBtn.innerHTML = '<i class="fa-solid fa-pen" style="color: #3b82f6;"></i> Edit';
    editBtn.onmouseenter = () => editBtn.style.background = 'rgba(255,255,255,0.05)';
    editBtn.onmouseleave = () => editBtn.style.background = 'transparent';
    editBtn.onclick = () => {
      menu.remove();
      startEditingMessage(id, text);
    };
    menu.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.style.cssText = 'background: transparent; border: none; color: #f43f5e; padding: 6px 12px; text-align: left; cursor: pointer; display: flex; align-items: center; gap: 8px; width: 100%; font-family: inherit; font-size: 0.78rem; border-radius: 4px;';
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> Delete';
    deleteBtn.onmouseenter = () => deleteBtn.style.background = 'rgba(244,63,94,0.1)';
    deleteBtn.onmouseleave = () => deleteBtn.style.background = 'transparent';
    deleteBtn.onclick = () => {
      menu.remove();
      if (confirm('Delete this message for everyone?')) {
        socket.emit('delete_message', { id, is_group: (typeof currentActiveChatId === 'string' && currentActiveChatId.startsWith('group_')) });
      }
    };
    menu.appendChild(deleteBtn);
  }

  bubble.parentElement.appendChild(menu);

  const closeHandler = () => {
    menu.remove();
    document.removeEventListener('click', closeHandler);
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 100);
}

function showEmojiPicker(bubble, id) {
  const picker = document.createElement('div');
  picker.className = 'msg-reactions-picker';

  const emojis = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
  emojis.forEach(e => {
    const span = document.createElement('span');
    span.textContent = e;
    span.onclick = () => {
      picker.remove();
      socket.emit('react_message', {
        id,
        is_group: (typeof currentActiveChatId === 'string' && currentActiveChatId.startsWith('group_')),
        emoji: e
      });
    };
    picker.appendChild(span);
  });

  const rect = bubble.getBoundingClientRect();
  const parentRect = bubble.parentElement.getBoundingClientRect();
  picker.style.top = (rect.top - parentRect.top - 42) + 'px';
  picker.style.left = (rect.left - parentRect.left + rect.width / 2) + 'px';

  bubble.parentElement.appendChild(picker);

  const closeHandler = () => {
    picker.remove();
    document.removeEventListener('click', closeHandler);
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 100);
}

function renderBubbleReactions(bubble, id, reactions) {
  bubble.querySelectorAll('.msg-reactions-row').forEach(r => r.remove());

  let reactionsList = [];
  if (typeof reactions === 'string') {
    try { reactionsList = JSON.parse(reactions || '[]'); } catch {}
  } else if (Array.isArray(reactions)) {
    reactionsList = reactions;
  }

  if (reactionsList.length === 0) return;

  const row = document.createElement('div');
  row.className = 'msg-reactions-row';

  const emojiCounts = {};
  reactionsList.forEach(r => {
    emojiCounts[r.emoji] = (emojiCounts[r.emoji] || 0) + 1;
  });

  Object.entries(emojiCounts).forEach(([emoji, count]) => {
    const badge = document.createElement('span');
    badge.className = 'reaction-badge';
    badge.innerHTML = `${emoji} <span style="font-size: 0.65rem;">${count}</span>`;
    badge.title = reactionsList.filter(r => r.emoji === emoji).map(r => r.username).join(', ');

    badge.onclick = e => {
      e.stopPropagation();
      const hasMyReaction = reactionsList.some(r => r.user_id === currentUser.id && r.emoji === emoji);
      socket.emit('react_message', {
        id,
        is_group: (typeof currentActiveChatId === 'string' && currentActiveChatId.startsWith('group_')),
        emoji: hasMyReaction ? null : emoji
      });
    };
    row.appendChild(badge);
  });

  bubble.appendChild(row);
}

function updateBubbleStatusUI(bubble, status) {
  const tick = bubble.querySelector('.msg-status-tick');
  if (tick) {
    if (status === 'read') {
      tick.className = 'fa-solid fa-check-double msg-status-tick';
      tick.style.color = '#3b82f6';
    } else if (status === 'delivered') {
      tick.className = 'fa-solid fa-check-double msg-status-tick';
      tick.style.color = 'var(--text-muted)';
    } else {
      tick.className = 'fa-solid fa-check msg-status-tick';
      tick.style.color = 'var(--text-muted)';
    }
  }
}

function startQuotedReply(id, text) {
  activeReplyMessageId = id;
  const bubble = document.querySelector(`.msg-bubble[data-msg-id="${id}"]`);
  
  let senderName = 'Message';
  if (bubble) {
    const nameEl = bubble.querySelector('span');
    if (nameEl) senderName = nameEl.textContent;
    else if (bubble.classList.contains('outgoing')) senderName = 'You';
    else senderName = activeChat.partnerName || 'Peer';
  }

  const previewText = text.startsWith('[FILE_JSON]:') ? getMessagePreviewText(text) : text;
  el('chats-reply-preview-title').textContent = `Replying to ${senderName}`;
  el('chats-reply-preview-text').textContent = previewText;
  el('chats-reply-preview-bar').classList.remove('hidden');
  el('chats-message-input').focus();
}

function startEditingMessage(id, text) {
  if (text.startsWith('[FILE_JSON]:')) {
    toast('Cannot edit file attachments.', 'warning');
    return;
  }
  editMessageId = id;
  el('chats-message-input').value = text;
  el('chats-message-input').focus();
  el('chats-message-input').style.border = '1px solid var(--accent)';
  toast('Editing message (press Esc to cancel)', 'info');
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getMessagePreviewText(text) {
  if (text.startsWith('[FILE_JSON]:')) {
    try {
      const fileInfo = JSON.parse(text.slice(12));
      return fileInfo.type === 'image' ? '📷 Photo' : `📄 Document: ${fileInfo.fileName}`;
    } catch {
      return '📎 Attachment';
    }
  }
  return text;
}

async function openCreateGroupModal() {
  show('create-group-modal');
  el('group-name-input').value = '';
  hide('create-group-error');

  const listContainer = el('create-group-peers-list');
  if (!listContainer) return;

  listContainer.innerHTML = '<div class="skills-empty-hint"><i class="fa-solid fa-spinner fa-spin"></i> Loading peers...</div>';

  try {
    const data = await api('GET', '/api/users/explore');
    const peers = data.users || [];
    
    listContainer.innerHTML = '';
    if (peers.length === 0) {
      listContainer.innerHTML = '<div class="skills-empty-hint">No other users found.</div>';
      return;
    }

    peers.forEach(m => {
      const div = document.createElement('div');
      div.style.display = 'flex';
      div.style.alignItems = 'center';
      div.style.gap = '10px';
      div.style.padding = '6px 0';
      
      const avatarHtml = m.avatar_url 
        ? `<img src="${m.avatar_url}" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover; flex-shrink: 0;">` 
        : `<div style="width: 28px; height: 28px; border-radius: 50%; background: rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center; color: var(--text-muted); flex-shrink: 0;"><i class="fa-solid fa-user" style="font-size: 0.85rem;"></i></div>`;

      div.innerHTML = `
        <input type="checkbox" id="group-invite-${m.id}" name="group-member-invite" value="${m.id}" style="cursor: pointer; width: 16px; height: 16px; flex-shrink: 0;">
        ${avatarHtml}
        <label for="group-invite-${m.id}" style="font-size: 0.95rem; cursor: pointer; color: var(--text-primary); flex: 1; margin: 0; display: flex; align-items: center; font-weight: 500;">
          ${m.fullname || m.username}
        </label>
      `;
      listContainer.appendChild(div);
    });
  } catch (err) {
    listContainer.innerHTML = `<div class="error-msg">Failed to load peers: ${err.message}</div>`;
  }
}

// ==================================================
//  AUTO LOGIN (session persistence)
// ==================================================
async function tryAutoLogin() {
  try {
    const data = await api('GET', '/api/auth/me');
    if (data.user) {
      currentUser = data.user;
      launchApp();
      return true;
    }
  } catch {}
  return false;
}

// ==================================================
//  INIT
// ==================================================
document.addEventListener('DOMContentLoaded', async () => {
  initLanding();
  initAuthModal();

  const autoLoggedIn = await tryAutoLogin();
  if (!autoLoggedIn) {
    show('landing-view');
    hide('app-view');
  }

  // Window popstate event listener for Native back button/gesture
  window.addEventListener('popstate', e => {
    const callOverlay = el('call-overlay');
    const isCallActive = callOverlay && !callOverlay.classList.contains('hidden');

    if (isCallActive) {
      if (!callOverlay.classList.contains('minimized')) {
        callOverlay.classList.add('minimized');
        makeDraggable(callOverlay);
        document.body.classList.remove('mobile-call-active');
        toast('Call minimized to bubble', 'info');
      } else {
        endCall();
      }
      return;
    }

    const chatsWindow = el('chats-window');
    if (chatsWindow && chatsWindow.classList.contains('mobile-active')) {
      chatsWindow.classList.remove('mobile-active');
      document.body.classList.remove('mobile-chat-active');
      currentActiveChatId = null;
    }
  });

  // Fade out and remove the app loading screen (mitigates Render free tier cold starts)
  const loadingScreen = el('app-loading-screen');
  if (loadingScreen) {
    loadingScreen.style.opacity = '0';
    setTimeout(() => loadingScreen.remove(), 500);
  }
});

// Utility: Make Element Draggable
// Utility: Make Element Draggable (supports touch & mouse)
function makeDraggable(element) {
  if (!element) return;
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  
  element.onmousedown = dragMouseDown;
  element.addEventListener('touchstart', dragTouchStart, { passive: false });

  function dragMouseDown(e) {
    if (element.id === 'call-overlay' && !element.classList.contains('minimized')) return;
    const rect = element.getBoundingClientRect();
    if (e.clientX > rect.right - 20 && e.clientY > rect.bottom - 20) return;
    
    e = e || window.event;
    e.preventDefault();
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
  }

  function elementDrag(e) {
    e = e || window.event;
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    element.style.top = (element.offsetTop - pos2) + "px";
    element.style.left = (element.offsetLeft - pos1) + "px";
    element.style.bottom = 'auto';
    element.style.right = 'auto';
  }

  function closeDragElement() {
    document.onmouseup = null;
    document.onmousemove = null;
  }

  function dragTouchStart(e) {
    if (element.id === 'call-overlay' && !element.classList.contains('minimized')) return;
    const rect = element.getBoundingClientRect();
    const touch = e.touches[0];
    // Don't drag if touching near the bottom right resize corner
    if (touch.clientX > rect.right - 25 && touch.clientY > rect.bottom - 25) return;
    
    e.preventDefault(); // prevent scrolling
    pos3 = touch.clientX;
    pos4 = touch.clientY;
    
    document.addEventListener('touchmove', elementTouchDrag, { passive: false });
    document.addEventListener('touchend', closeDragTouch);
  }

  function elementTouchDrag(e) {
    e.preventDefault(); // prevent page bounce/scrolling while dragging
    const touch = e.touches[0];
    pos1 = pos3 - touch.clientX;
    pos2 = pos4 - touch.clientY;
    pos3 = touch.clientX;
    pos4 = touch.clientY;
    element.style.top = (element.offsetTop - pos2) + "px";
    element.style.left = (element.offsetLeft - pos1) + "px";
    element.style.bottom = 'auto';
    element.style.right = 'auto';
  }

  function closeDragTouch() {
    document.removeEventListener('touchmove', elementTouchDrag);
    document.removeEventListener('touchend', closeDragTouch);
  }
}

// Active Speaker Detection using WebAudio API
function startSpeakerHighlighting(stream, feedElement) {
  if (!window.AudioContext && !window.webkitAudioContext) return;
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
      const resume = () => {
        audioContext.resume();
        document.removeEventListener('click', resume);
      };
      document.addEventListener('click', resume);
    }
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let silenceCounter = 0;

    const checkVolume = () => {
      if (!feedElement || !feedElement.parentNode) return;
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      if (average > 15) {
        feedElement.classList.add('active-speaker-feed');
        silenceCounter = 0;
      } else {
        silenceCounter++;
        if (silenceCounter > 15) {
          feedElement.classList.remove('active-speaker-feed');
        }
      }
      requestAnimationFrame(checkVolume);
    };
    requestAnimationFrame(checkVolume);
  } catch (err) {
    console.error('Audio analysis failed:', err);
  }
}

// Reflow group calling video tiles dynamically
function updateVideoGridLayout() {
  const grid = el('classroom-video-feeds');
  if (!grid) return;
  const feeds = Array.from(grid.querySelectorAll('.video-feed'));
  const count = feeds.length;
  grid.style.display = '';
  grid.style.gridTemplateColumns = '';
  
  if (count <= 1) {
    grid.style.display = 'block';
    feeds.forEach(f => {
      f.style.width = '100%';
      f.style.height = '100%';
    });
  } else if (count === 2) {
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = '1fr 1fr';
    feeds.forEach(f => {
      f.style.width = '100%';
      f.style.height = '100%';
    });
  } else if (count <= 4) {
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = '1fr 1fr';
    grid.style.gridAutoRows = '1fr';
    feeds.forEach(f => {
      f.style.width = '100%';
      f.style.height = '100%';
    });
  } else {
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(120px, 1fr))';
    grid.style.gridAutoRows = 'min-content';
    feeds.forEach(f => {
      f.style.width = '100%';
      f.style.height = 'auto';
      f.style.aspectRatio = '16/9';
    });
  }
}

// Auto-trigger native browser Picture-in-Picture on switching tabs
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    const callOverlay = el('call-overlay');
    if (callOverlay && !callOverlay.classList.contains('hidden')) {
      let remoteVideo = el('remote-video');
      if (isGroupCall) {
        remoteVideo = document.querySelector('.video-feed:not(.local-feed) video');
      }
      if (remoteVideo && remoteVideo.srcObject && !document.pictureInPictureElement) {
        try {
          remoteVideo.requestPictureInPicture();
        } catch (e) {
          console.warn('Native PiP failed:', e);
        }
      }
    }
  }
});

async function openAddMemberModal(groupId, existingMembers) {
  const modal = el('add-member-modal');
  const listEl = el('add-member-peers-list');
  const errorEl = el('add-member-error');

  if (!modal || !listEl) return;

  hide(errorEl);
  listEl.innerHTML = '<div class="skills-empty-hint"><i class="fa-solid fa-spinner fa-spin"></i> Loading matches...</div>';
  show('add-member-modal');

  try {
    const matchesData = await api('GET', '/api/matches').catch(() => ({ matches: [] }));
    const matches = matchesData.matches || [];

    const existingIds = new Set(existingMembers.map(m => m.id));
    const candidates = matches.filter(peer => !existingIds.has(peer.id));

    if (candidates.length === 0) {
      listEl.innerHTML = '<div class="skills-empty-hint">No matches available. All matches are already in this group.</div>';
      return;
    }

    listEl.innerHTML = '';
    candidates.forEach(peer => {
      const div = document.createElement('div');
      div.style.cssText = 'display: flex; align-items: center; gap: 10px; color: #fff; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);';
      div.innerHTML = `
        <input type="checkbox" id="add-peer-chk-${peer.id}" value="${peer.id}" class="add-peer-checkbox" style="width: 16px; height: 16px; accent-color: var(--accent);">
        <label for="add-peer-chk-${peer.id}" style="cursor: pointer; display: flex; align-items: center; gap: 8px; flex: 1; font-size: 0.88rem; color: #f1f5f9;">
          <span>${peer.fullname || peer.username}</span>
        </label>
      `;
      listEl.appendChild(div);
    });

    const form = el('add-member-form');
    form.onsubmit = async e => {
      e.preventDefault();
      const selectedIds = Array.from(document.querySelectorAll('.add-peer-checkbox:checked')).map(cb => cb.value);
      if (selectedIds.length === 0) {
        errorEl.textContent = 'Please select at least one member to add.';
        show(errorEl);
        return;
      }

      try {
        await api('POST', `/api/groups/${groupId}/members`, { memberIds: selectedIds });
        toast('Members added successfully.', 'success');
        hide('add-member-modal');
        selectChat(currentActiveChatId, el('chats-header-name').textContent, activeChat.avatarUrl);
      } catch (err) {
        errorEl.textContent = err.message;
        show(errorEl);
      }
    };
  } catch (err) {
    listEl.innerHTML = `<div class="error-msg">Failed to load matches: ${err.message}</div>`;
  }
}
