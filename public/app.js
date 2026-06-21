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

const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

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
}

// ==================================================
//  SOCKET.IO
// ==================================================
function initSocketIO() {
  socket = io();
  socket.emit('authenticate', currentUser.id);

  socket.on('receive_message', msg => {
    if (activeChat.partnerId === msg.sender_id) {
      appendChatMessage(msg.message, 'incoming');
    } else {
      toast(`💬 ${msg.sender_name}: ${msg.message.slice(0, 60)}...`, 'info');
    }
  });

  socket.on('user_online', userId => {
    if (activeChat.partnerId === userId) {
      const statusDot = el('chat-partner-status');
      if (statusDot) { statusDot.textContent = ''; statusDot.className = 'online-dot online'; }
    }
  });

  socket.on('user_offline', userId => {
    if (activeChat.partnerId === userId) {
      const statusDot = el('chat-partner-status');
      if (statusDot) { statusDot.textContent = ''; statusDot.className = 'online-dot offline'; }
    }
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

  // WebRTC signaling
  socket.on('webrtc_offer', async ({ offer, from }) => {
    if (!peerConnection) initPeerConnection(from);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('webrtc_answer', { answer, to: from });
  });

  socket.on('webrtc_answer', async ({ answer }) => {
    if (peerConnection) await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  });

  socket.on('webrtc_ice', async ({ candidate }) => {
    if (peerConnection) {
      try { await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
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
    try {
      await api('POST', '/api/messages', { receiver_id: activeChat.partnerId, message: msg });
      appendChatMessage(msg, 'outgoing');
      socket.emit('send_message', { receiver_id: activeChat.partnerId, message: msg, sender_name: currentUser.username });
    } catch {}
  });

  el('start-call-btn')?.addEventListener('click', () => {
    if (!activeChat.partnerId) return;
    openVideoCall(activeChat.partnerId, activeChat.partnerName);
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
      appendChatMessage(m.message, m.sender_id === currentUser.id ? 'outgoing' : 'incoming');
    });
  } catch {}
}

function appendChatMessage(text, direction) {
  const log = el('chat-messages-log');
  const div = document.createElement('div');
  div.className = `msg-bubble ${direction}`;
  div.textContent = text;
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
//  VIDEO CALL (WebRTC)
// ==================================================
function initCallUI() {
  el('call-end-btn')?.addEventListener('click', endCall);
  el('call-toggle-audio')?.addEventListener('click', () => toggleTrack('audio'));
  el('call-toggle-video')?.addEventListener('click', () => toggleTrack('video'));
  el('call-toggle-screen')?.addEventListener('click', shareScreen);

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
  activeChat.partnerId = peerId;
  activeChat.partnerName = peerName;
  el('classroom-peer-name').textContent = peerName;
  el('call-overlay').classList.remove('hidden');

  startCallTimer();

  if (sessionId) {
    try { await api('PUT', `/api/sessions/${sessionId}/status`, { status: 'active' }); } catch {}
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    el('local-video').srcObject = localStream;
    hide('local-mock-stream');
    initPeerConnection(peerId);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('webrtc_offer', { offer, to: peerId });
  } catch (e) {
    show('local-mock-stream');
    toast('Camera/mic unavailable — running in screen-share/text mode.', 'warning');
  }

  toast(`🎓 Classroom session started with ${peerName}!`, 'success');
}

function initPeerConnection(peerId) {
  peerConnection = new RTCPeerConnection(ICE_SERVERS);

  if (localStream) localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

  peerConnection.ontrack = e => {
    el('remote-video').srcObject = e.streams[0];
    hide('remote-mock-stream');
  };

  peerConnection.onicecandidate = e => {
    if (e.candidate) socket.emit('webrtc_ice', { candidate: e.candidate, to: peerId });
  };

  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === 'connected') {
      toast('🔗 Peer connected!', 'success');
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
    el('call-timer').textContent = `${m}:${s}`;
  }, 1000);
}

async function endCall() {
  clearInterval(callTimer);
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  el('remote-video').srcObject = null;
  el('local-video').srcObject = null;
  show('remote-mock-stream');
  show('local-mock-stream');
  el('call-overlay').classList.add('hidden');
  el('call-timer').textContent = '00:00';
  toast('Session ended. Great teaching!', 'success');
  await loadSessions();
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
