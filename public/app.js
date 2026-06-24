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
let groupPeerConnections = {}; // socketId -> RTCPeerConnection
let groupParticipants = []; // array of { userId, socketId, userName, status }
const onlineUserIdsSet = new Set();

// WebRTC ICE Candidate Queues to prevent race conditions during signaling
let globalIceQueue = [];
let groupIceQueues = {}; // peerSocketId -> array of candidates

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.services.mozilla.com' }
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
  updateHeaderUser();
  initSocketIO();
  initNavTabs();
  initSkillsPanel();
  initMatchTabs();
  initExplorePage();
  initSessionsPage();
  initProfilePage();
  initChatPanel();
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
  socket.emit('authenticate', currentUser.id);

  socket.on('online_users_list', userIds => {
    userIds.forEach(id => {
      const userId = parseInt(id);
      onlineUserIdsSet.add(userId);
      updateUserPresenceUI(userId, true);
    });
  });

  socket.on('receive_message', msg => {
    if (activeChat.partnerId === msg.sender_id) {
      if (msg.is_call_log) {
        appendChatMessage(msg.message, msg.sender_id === currentUser.id ? 'outgoing call-log' : 'incoming call-log');
      } else {
        appendChatMessage(msg.message, 'incoming');
      }
    } else {
      if (!msg.is_call_log) {
        toast(`💬 ${msg.sender_name}: ${msg.message.slice(0, 60)}...`, 'info');
      }
    }
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
    show('incoming-call-modal');
    el('incoming-call-title').textContent = 'Incoming Class Call';
    el('incoming-call-msg').textContent = `${callerName} is inviting you to a live 1-on-1 session.`;
    
    el('accept-call-btn').onclick = async () => {
      hide('incoming-call-modal');
      await acceptDirectCall(callerId, callerName, offer);
    };
    
    el('decline-call-btn').onclick = () => {
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
    hide('incoming-call-modal');
    toast('Call cancelled by caller.', 'info');
    endCallLocal();
  });

  // WebRTC Group Calling Signaling (Mesh Network)
  socket.on('incoming_group_call', ({ roomId, callerId, callerName, invitedUserIds }) => {
    show('incoming-call-modal');
    el('incoming-call-title').textContent = 'Incoming Group Call';
    el('incoming-call-msg').textContent = `${callerName} is inviting you to a Group Classroom.`;
    
    el('accept-call-btn').onclick = async () => {
      hide('incoming-call-modal');
      await joinGroupCall(roomId, callerName);
    };
    
    el('decline-call-btn').onclick = () => {
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
  });

  socket.on('group_participants_update', (participants) => {
    groupParticipants = participants;
    updateGroupParticipantsList();
  });
}

function updateUserPresenceUI(userId, isOnline) {
  userId = parseInt(userId);
  if (activeChat.partnerId === userId) {
    const statusDot = el('chat-partner-status');
    if (statusDot) {
      statusDot.textContent = isOnline ? 'online' : 'offline';
      statusDot.className = 'online-dot ' + (isOnline ? 'online' : 'offline');
    }
  }
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
  
  const userCards = qsa('.peer-card');
  userCards.forEach(card => {
    const viewBtn = card.querySelector('[data-action="profile"]');
    if (viewBtn && parseInt(viewBtn.dataset.id) === userId) {
      let badge = card.querySelector('.match-badge');
      if (badge) {
        badge.style.border = isOnline ? '1px solid var(--emerald)' : '';
        badge.innerHTML = isOnline ? '🟢 Online' : (badge.classList.contains('perfect') ? '⚡ Perfect Match' : badge.classList.contains('partial') ? '🤝 Partial Match' : '👤 Peer');
      }
    }
  });
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
    hide('skill-error');
    const skillName = el('skill-name').value;
    const skillType = el('skill-type').value;
    const proficiency = el('skill-proficiency').value;

    if (!skillName) { el('skill-error').textContent = 'Please select a skill.'; show('skill-error'); return; }

    try {
      el('add-skill-submit-btn').disabled = true;
      await api('POST', '/api/skills', { skill_name: skillName, skill_type: skillType, proficiency_level: proficiency });
      toast(`✅ "${skillName}" added to your ${skillType === 'teach' ? 'teaching' : 'learning'} list!`, 'success');
      el('skill-name').value = '';
      await loadMySkills();
      await loadMatches();
    } catch (err) {
      el('skill-error').textContent = err.message;
      show('skill-error');
    } finally {
      el('add-skill-submit-btn').disabled = false;
    }
  });

  el('onboarding-warning-btn')?.addEventListener('click', () => {
    el('skills-card-anchor')?.scrollIntoView({ behavior: 'smooth' });
  });
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
  div.innerHTML = `
    <span class="skill-pill-name">
      <span>${skill.skill_name}</span>
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
  activeChat = { partnerId: peerId, partnerName: peerName };
  el('chat-partner-name').textContent = peerName;
  el('chat-partner-status').className = 'online-dot offline';

  const avatarEl = el('chat-peer-avatar');
  avatarEl.innerHTML = avatarUrl ? `<img src="${avatarUrl}" alt="avatar">` : `<i class="fa-solid fa-user"></i>`;

  el('chat-messages-log').innerHTML = '';
  el('chat-sidebar').classList.remove('closed');
  loadChatHistory(peerId);
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
  const div = document.createElement('div');
  div.className = `msg-bubble ${direction}`;
  if (direction.includes('call-log')) {
    div.innerHTML = text;
  } else {
    div.textContent = text;
  }
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
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
}

function appendAIBubble(text, role) {
  const log = el('ai-chat-history');
  const div = document.createElement('div');
  div.className = `ai-bubble ${role}`;
  if (role === 'assistant') div.innerHTML = `<i class="fa-solid fa-robot"></i><p>${text}</p>`;
  else div.textContent = text;
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
    loadingEl.querySelector('p').textContent = res.reply;
  } catch {
    const fallbacks = [
      `Great question about learning! Start by breaking your skill into 3-5 key modules. Practice each one for 20-minute sessions and review after each.`,
      `For a one-hour exchange: Start with 10 min introductions → 20 min Peer A teaches → 5 min Q&A → 20 min Peer B teaches → 5 min wrap-up.`,
      `Track progress with weekly mini-challenges. Set 3 achievable goals per session and review them at the end. Celebrate small wins!`,
      `A good icebreaker: each person shares one cool thing they built or learned this week. It instantly builds connection and trust.`,
    ];
    loadingEl.querySelector('p').textContent = fallbacks[Math.floor(Math.random() * fallbacks.length)];
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
  
  el('show-participants-btn')?.addEventListener('click', () => {
    el('classroom-participants-drawer').classList.toggle('hidden');
  });
  el('close-participants-btn')?.addEventListener('click', () => {
    el('classroom-participants-drawer').classList.add('hidden');
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
  el('call-overlay').classList.remove('hidden');
  el('classroom-video-feeds').classList.remove('group-grid');
  el('classroom-participants-drawer').classList.add('hidden');

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

  peerConnection.onconnectionstatechange = () => {
    console.log("Connection State Changed:", peerConnection.connectionState);
    if (peerConnection.connectionState === 'connected') {
      toast('🔗 Peer connected!', 'success');
    } else if (peerConnection.connectionState === 'failed') {
      toast('❌ Connection failed. Retrying...', 'error');
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
  
  el('call-overlay').classList.add('hidden');
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
  el('call-overlay').classList.remove('hidden');
  el('classroom-participants-drawer').classList.remove('hidden');
  
  const videoGrid = el('classroom-video-feeds');
  videoGrid.innerHTML = ''; 
  videoGrid.classList.add('group-grid');
  
  const localWrapper = document.createElement('div');
  localWrapper.className = 'video-feed';
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
  
  updateGroupParticipantsList();
  toast('Group call started!', 'success');
}

async function joinGroupCall(roomId, initiatorName) {
  isGroupCall = true;
  groupRoomId = roomId;
  el('classroom-peer-name').textContent = 'Group Class';
  el('call-overlay').classList.remove('hidden');
  el('classroom-participants-drawer').classList.remove('hidden');
  
  const videoGrid = el('classroom-video-feeds');
  videoGrid.innerHTML = ''; 
  videoGrid.classList.add('group-grid');
  
  const localWrapper = document.createElement('div');
  localWrapper.className = 'video-feed';
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
  updateGroupParticipantsList();
}

function createGroupPeerConnection(peerSocketId, peerUserId, peerUserName, isInitiator) {
  const pc = new RTCPeerConnection(ICE_SERVERS);
  pc.remoteDescriptionSet = false;
  pc.iceQueue = groupIceQueues[peerSocketId] || [];
  delete groupIceQueues[peerSocketId];
  
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }
  
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

  pc.onconnectionstatechange = () => {
    console.log(`Group Connection State for ${peerUserName}:`, pc.connectionState);
    if (pc.connectionState === 'connected') {
      const idx = groupParticipants.findIndex(p => p.userId === peerUserId);
      if (idx !== -1) {
        groupParticipants[idx].status = 'connected';
        updateGroupParticipantsList();
      }
    }
  };

  return pc;
}

function renderRemoteGroupStream(peerSocketId, peerUserId, peerUserName, e) {
  const videoGrid = el('classroom-video-feeds');
  let peerFeed = el(`feed_${peerSocketId}`);
  
  if (!peerFeed) {
    peerFeed = document.createElement('div');
    peerFeed.className = 'video-feed';
    peerFeed.id = `feed_${peerSocketId}`;
    peerFeed.innerHTML = `
      <video id="video_${peerSocketId}" autoplay playsinline></video>
      <div class="feed-label"><i class="fa-solid fa-circle live-dot"></i> ${peerUserName}</div>
    `;
    videoGrid.appendChild(peerFeed);
  }
  
  const videoEl = el(`video_${peerSocketId}`);
  if (videoEl) {
    if (e.streams && e.streams[0]) {
      videoEl.srcObject = e.streams[0];
    } else {
      if (!videoEl.srcObject) {
        videoEl.srcObject = new MediaStream();
      }
      videoEl.srcObject.addTrack(e.track);
    }
  }
  
  const pIdx = groupParticipants.findIndex(p => p.userId === peerUserId);
  if (pIdx !== -1) {
    groupParticipants[pIdx].status = 'connected';
  } else {
    groupParticipants.push({ userId: peerUserId, userName: peerUserName, status: 'connected' });
  }
  updateGroupParticipantsList();
}

function updateGroupParticipantsList() {
  const list = el('classroom-participants-list');
  if (!list) return;
  
  list.innerHTML = '';
  let count = 0;
  
  groupParticipants.forEach(p => {
    if (p.status === 'connected' || p.status === 'host') count++;
    
    const item = document.createElement('li');
    item.className = 'participant-item';
    item.innerHTML = `
      <span class="participant-name">${p.userName}</span>
      <span class="participant-badge ${p.status}">${p.status}</span>
    `;
    list.appendChild(item);
  });
  
  el('participants-count').textContent = count;
}

function openGroupCallModal() {
  show('group-call-modal');
  hide('group-call-error');
  
  const listContainer = el('group-call-peers-list');
  if (!listContainer) return;
  
  api('GET', '/api/users/explore')
    .then(data => {
      const onlinePeers = data.users.filter(u => u.id !== currentUser.id && onlineUserIdsSet.has(u.id));
      listContainer.innerHTML = '';
      
      if (!onlinePeers.length) {
        listContainer.innerHTML = '<div class="skills-empty-hint">No matched peers are online right now.</div>';
        el('launch-group-call-btn').disabled = true;
        return;
      }
      
      onlinePeers.forEach(peer => {
        const item = document.createElement('label');
        item.className = 'invite-peer-checkbox-item';
        const displayName = peer.fullname || peer.username;
        item.innerHTML = `
          <input type="checkbox" name="invite-peer" value="${peer.id}" data-name="${displayName}">
          <span><strong>${displayName}</strong> (${peer.teach_skills || 'Tutor'})</span>
        `;
        item.querySelector('input').addEventListener('change', () => {
          const checked = document.querySelectorAll('input[name="invite-peer"]:checked').length;
          el('launch-group-call-btn').disabled = checked === 0;
        });
        listContainer.appendChild(item);
      });
      el('launch-group-call-btn').disabled = true;
    })
    .catch(() => {
      listContainer.innerHTML = '<div class="skills-empty-hint">Error loading online peers list.</div>';
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
    await startGroupCall(invitedUsers);
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
});

// Utility: Make Element Draggable
function makeDraggable(el) {
  if (!el) return;
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  
  el.onmousedown = dragMouseDown;

  function dragMouseDown(e) {
    const rect = el.getBoundingClientRect();
    // Prevent drag if clicking the bottom right resize corner
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
    el.style.top = (el.offsetTop - pos2) + "px";
    el.style.left = (el.offsetLeft - pos1) + "px";
    el.style.bottom = 'auto';
    el.style.right = 'auto';
  }

  function closeDragElement() {
    document.onmouseup = null;
    document.onmousemove = null;
  }
}
