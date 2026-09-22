// Main entry point: bootstraps views, socket lifecycle, navigation tabs, and initial auto-login session
import { state, el, show, hide, qsa, toast, requestNotificationPermission } from './state.js';
import { api, apiGetMe, apiLogout, apiGetCallHistory } from './api.js';
import { initSocketIO } from './socket.js';
import { initLanding, initAuthModal } from './views/auth.js';
import { initMatchTabs, initExplorePage, loadMatches, loadExplorePeers } from './views/explore.js';
import { initChatPanel, initChatsPage, loadChatsPage, selectChat, setChatNavigationHandler } from './views/chat.js';
import { initSessionsPage, initModals, loadSessions, setSessionsNavigationHandler } from './views/sessions.js';
import { initSkillsPanel, initProfilePage, initAIPanel, loadMySkills, loadProfile, setProfileNavigationHandler } from './views/profile.js';
import { initCallUI } from './views/classroom.js';

export function updateHeaderUser() {
  if (!state.currentUser) return;
  if (el('header-username')) el('header-username').textContent = state.currentUser.username;
  if (el('header-avatar')) {
    el('header-avatar').innerHTML = state.currentUser.avatar_url
      ? `<img src="${state.currentUser.avatar_url}" alt="avatar">`
      : `<i class="fa-solid fa-user"></i>`;
  }
  if (el('welcome-name')) el('welcome-name').textContent = state.currentUser.fullname || state.currentUser.username;
  if (el('credits-count')) el('credits-count').textContent = state.currentUser.credits || 5;
  if (el('dropdown-fullname')) el('dropdown-fullname').textContent = state.currentUser.fullname || state.currentUser.username;
  if (el('dropdown-rating')) el('dropdown-rating').textContent = parseFloat(state.currentUser.average_rating || 0).toFixed(1);
}

export function initNavTabs() {
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
      await apiLogout();
      state.currentUser = null;
      if (state.socket) state.socket.disconnect();
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

export function switchTab(tabName) {
  qsa('.tab-section').forEach(s => s.classList.remove('active'));
  el(`tab-${tabName}`)?.classList.add('active');
  if (tabName === 'chats') loadChatsPage();
  if (tabName === 'explore') loadExplorePeers();
  if (tabName === 'sessions') loadSessions();
  if (tabName === 'profile') loadProfile();
}

export async function loadDashboard() {
  await loadMySkills();
  await loadMatches();
}

export async function loadCallHistory() {
  const container = el('call-history-list');
  if (!container) return;
  
  try {
    const data = await apiGetCallHistory();
    const logs = data.logs;
    if (!logs || !logs.length) {
      container.innerHTML = '<div class="empty-state-card"><i class="fa-solid fa-phone"></i><p>No recent classes logged.</p></div>';
      return;
    }
    
    container.innerHTML = '';
    logs.forEach(log => {
      const isCaller = log.caller_id === state.currentUser?.id;
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

export function launchApp() {
  hide('landing-view');
  show('app-view');
  el('app-view')?.classList.remove('hidden');
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

export async function tryAutoLogin() {
  try {
    const data = await apiGetMe();
    if (data.user) {
      state.currentUser = data.user;
      launchApp();
      return true;
    }
  } catch {}
  return false;
}

// Wire cross-module navigation handlers
setChatNavigationHandler(switchTab);
setSessionsNavigationHandler(switchTab);
setProfileNavigationHandler(switchTab);

// Initialize application on DOM ready
document.addEventListener('DOMContentLoaded', async () => {
  initLanding();
  initAuthModal(() => launchApp());

  const autoLoggedIn = await tryAutoLogin();
  if (!autoLoggedIn) {
    show('landing-view');
    hide('app-view');
  }

  // Fade out and remove the app loading screen (mitigates Render free tier cold starts)
  const loadingScreen = el('app-loading-screen');
  if (loadingScreen) {
    loadingScreen.style.opacity = '0';
    setTimeout(() => loadingScreen.remove(), 500);
  }

  // Handle invite links routing
  const handleHashRouting = async () => {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#join-group_')) {
      const groupId = hash.replace('#join-group_', '');
      try {
        await api('POST', `/api/groups/${groupId}/join`);
        toast('Joined group via invite link!', 'success');
        window.location.hash = '';
        await loadChatsPage();
        selectChat(`group_${groupId}`, 'Group Chat', '');
      } catch (err) {
        toast('Failed to join group via link: ' + err.message, 'error');
        window.location.hash = '';
      }
    }
  };
  window.addEventListener('hashchange', handleHashRouting);
  setTimeout(handleHashRouting, 1200);
});
