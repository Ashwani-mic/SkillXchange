// Sessions view: manages skill session bookings, scheduling filters, review modals, and classroom invitations.
import { state, el, show, hide, qsa, toast } from '../state.js';
import { apiGetMySessions, apiBookSession, apiUpdateSessionStatus, apiSubmitReview, apiExploreUsers } from '../api.js';
import { openVideoCall, startGroupCall, updateGroupParticipantsList } from '../webrtc.js';

let switchTabFn = null;
export function setSessionsNavigationHandler(fn) {
  switchTabFn = fn;
}

export function initSessionsPage() {
  qsa('.sessions-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      qsa('.sessions-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadSessions(tab.dataset.filter);
    });
  });
}

export async function loadSessions(filter = 'all') {
  try {
    const data = await apiGetMySessions();
    let sessions = data.sessions || [];
    if (filter !== 'all') sessions = sessions.filter(s => s.status === filter);

    const list = el('sessions-list');
    if (!list) return;
    if (!sessions.length) {
      list.innerHTML = `<div class="empty-state-card"><i class="fa-solid fa-calendar-alt"></i><p>No ${filter === 'all' ? '' : filter} classes found.<br>Book a session from a matched peer card.</p></div>`;
      return;
    }
    list.innerHTML = '';
    sessions.forEach(s => list.appendChild(renderSessionCard(s)));
  } catch {}
}

export function renderSessionCard(session) {
  const card = document.createElement('div');
  card.className = 'session-card glass-card';
  const dateStr = session.scheduled_at ? new Date(session.scheduled_at).toLocaleString() : 'Not scheduled';
  const isTeacher = session.teacher_id === state.currentUser?.id;
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
    openVideoCall(parseInt(btn.dataset.peerId, 10), btn.dataset.peerName, parseInt(btn.dataset.sessionId, 10));
  });
  card.querySelector('.review-session-btn')?.addEventListener('click', e => {
    openReviewModal(e.currentTarget.dataset.sessionId, e.currentTarget.dataset.peerName);
  });
  card.querySelector('.cancel-session-btn')?.addEventListener('click', async e => {
    try {
      await apiUpdateSessionStatus(e.currentTarget.dataset.sessionId, 'cancelled');
      toast('Session cancelled.', 'info');
      loadSessions();
    } catch (err) { 
      toast(err.message, 'error'); 
    }
  });
  return card;
}

export function openBookModal(peer) {
  state.currentBookingPeer = peer;
  show('book-modal');
  hide('book-error');

  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  if (el('book-datetime')) {
    el('book-datetime').min = now.toISOString().slice(0, 16);
    el('book-datetime').value = '';
  }

  const skillSel = el('book-skill-name');
  if (skillSel) {
    skillSel.innerHTML = '';
    const peerTeach = (peer.teach_skills || []).map(s => s.skill_name || s);
    peerTeach.forEach(skill => {
      const opt = document.createElement('option');
      opt.value = skill; 
      opt.textContent = skill;
      skillSel.appendChild(opt);
    });
    if (!peerTeach.length) {
      const opt = document.createElement('option');
      opt.value = 'General Exchange'; 
      opt.textContent = 'General Exchange';
      skillSel.appendChild(opt);
    }
  }
}

export function openReviewModal(sessionId, peerName) {
  state.currentReviewSession = { sessionId };
  show('review-modal');
  if (el('review-comment')) el('review-comment').value = '';
  qsa('input[name="modal-rating"]').forEach(r => r.checked = false);
  hide('review-error');
}

export function openGroupCallModal() {
  show('group-call-modal');
  hide('group-call-error');
  
  const submitBtn = el('launch-group-call-btn');
  if (submitBtn) {
    if (state.isGroupCall && state.groupRoomId) {
      submitBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Send Invites';
      const h2 = el('group-call-modal')?.querySelector('h2');
      if (h2) h2.textContent = 'Invite Peers to Class';
    } else {
      submitBtn.innerHTML = '<i class="fa-solid fa-video"></i> Start Group Class';
      const h2 = el('group-call-modal')?.querySelector('h2');
      if (h2) h2.textContent = 'Start a Group Class';
    }
  }

  const listContainer = el('group-call-peers-list');
  if (!listContainer) return;
  
  apiExploreUsers().then(data => {
    const sortedPeers = [...(data.users || [])]
      .filter(u => u.id !== state.currentUser?.id)
      .sort((a, b) => {
        const aOnline = state.onlineUserIdsSet.has(a.id) ? 1 : 0;
        const bOnline = state.onlineUserIdsSet.has(b.id) ? 1 : 0;
        return bOnline - aOnline;
      });
    
    listContainer.innerHTML = '';
    
    if (!sortedPeers.length) {
      listContainer.innerHTML = '<div class="skills-empty-hint">No peers found in the network.</div>';
      if (submitBtn) submitBtn.disabled = true;
      return;
    }
    
    sortedPeers.forEach(peer => {
      const isOnline = state.onlineUserIdsSet.has(peer.id);
      const displayName = peer.fullname || peer.username;
      
      const existingP = (state.isGroupCall && state.groupRoomId)
        ? state.groupParticipants.find(p => p.userId === peer.id)
        : null;

      const div = document.createElement('div');
      div.style.cssText = 'display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);';
      
      const avatarHtml = peer.avatar_url 
        ? `<img src="${peer.avatar_url}" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover;">`
        : `<div style="width: 28px; height: 28px; border-radius: 50%; background: rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center; font-size: 0.8rem; color: var(--text-muted);"><i class="fa-solid fa-user"></i></div>`;

      if (existingP) {
        div.innerHTML = `
          ${avatarHtml}
          <div style="flex: 1; font-size: 0.9rem; color: var(--text-muted);">${displayName}</div>
          <span style="font-size: 0.72rem; color: #8b5cf6;">${existingP.status === 'host' ? 'Host' : existingP.status === 'connected' ? 'In Call' : 'Invited'}</span>
        `;
      } else {
        div.innerHTML = `
          <input type="checkbox" id="invite-peer-${peer.id}" name="invite-peer" value="${peer.id}" data-name="${displayName}" style="cursor: pointer; width: 16px; height: 16px;">
          ${avatarHtml}
          <label for="invite-peer-${peer.id}" style="cursor: pointer; flex: 1; font-size: 0.9rem; color: var(--text-primary); margin: 0; display: flex; align-items: center; gap: 6px;">
            <span>${displayName}</span>
            <span class="status-only-dot ${isOnline ? 'online' : 'offline'}" style="margin-left: auto;"></span>
          </label>
        `;
      }
      listContainer.appendChild(div);
    });
  }).catch(err => {
    listContainer.innerHTML = `<div class="error-msg">Failed to load peers: ${err.message}</div>`;
  });
}

export function initModals() {
  el('close-peer-profile-btn')?.addEventListener('click', () => hide('peer-profile-modal'));
  el('peer-profile-modal')?.addEventListener('click', e => { 
    if (e.target === el('peer-profile-modal')) hide('peer-profile-modal'); 
  });

  el('close-book-modal-btn')?.addEventListener('click', () => hide('book-modal'));
  el('cancel-book-modal-btn')?.addEventListener('click', () => hide('book-modal'));
  el('book-modal')?.addEventListener('click', e => { 
    if (e.target === el('book-modal')) hide('book-modal'); 
  });

  el('close-group-call-btn')?.addEventListener('click', () => hide('group-call-modal'));
  el('cancel-group-call-btn')?.addEventListener('click', () => hide('group-call-modal'));
  el('group-call-modal')?.addEventListener('click', e => { 
    if (e.target === el('group-call-modal')) hide('group-call-modal'); 
  });

  el('group-call-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    hide('group-call-modal');
    const checkedBoxes = document.querySelectorAll('input[name="invite-peer"]:checked');
    const invitedUsers = Array.from(checkedBoxes).map(cb => ({
      id: parseInt(cb.value, 10),
      name: cb.dataset.name
    }));
    if (!invitedUsers.length) return;
    
    if (state.isGroupCall && state.groupRoomId) {
      if (state.socket) {
        state.socket.emit('group_call_invite', {
          roomId: state.groupRoomId,
          invitedUsers,
          senderName: state.currentUser?.fullname || state.currentUser?.username
        });
      }
      invitedUsers.forEach(u => {
        if (!state.groupParticipants.some(p => p.userId === u.id)) {
          state.groupParticipants.push({ userId: u.id, userName: u.name, status: 'invited' });
        }
      });
      updateGroupParticipantsList();
      toast('Mid-call invitations sent!', 'success');
    } else {
      await startGroupCall(invitedUsers);
    }
  });

  el('book-session-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    hide('book-error');
    if (!state.currentBookingPeer) return;
    try {
      await apiBookSession({
        teacher_id: state.currentBookingPeer.id,
        skill_name: el('book-skill-name')?.value,
        scheduled_at: el('book-datetime')?.value
      });
      hide('book-modal');
      toast(`📅 Class booked with ${state.currentBookingPeer.fullname || state.currentBookingPeer.username}!`, 'success');
      if (state.currentUser?.credits) {
        state.currentUser.credits = Math.max(0, state.currentUser.credits - 1);
        if (el('credits-count')) el('credits-count').textContent = state.currentUser.credits;
      }
      if (switchTabFn) switchTabFn('sessions');
      qsa('.header-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'sessions'));
      loadSessions();
    } catch (err) {
      if (el('book-error')) {
        el('book-error').textContent = err.message;
        show('book-error');
      }
    }
  });

  el('skip-review-btn')?.addEventListener('click', () => hide('review-modal'));
  el('review-modal')?.addEventListener('click', e => { 
    if (e.target === el('review-modal')) hide('review-modal'); 
  });

  el('review-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    hide('review-error');
    if (!state.currentReviewSession) return;
    const rating = parseInt(document.querySelector('input[name="modal-rating"]:checked')?.value || '0', 10);
    if (!rating) { 
      if (el('review-error')) {
        el('review-error').textContent = 'Please select a rating.'; 
        show('review-error'); 
      }
      return; 
    }

    try {
      await apiSubmitReview({
        session_id: state.currentReviewSession.sessionId,
        rating,
        comment: el('review-comment')?.value.trim() || ''
      });
      hide('review-modal');
      toast('Thanks for your review! 🌟', 'success');
      loadSessions();
    } catch (err) {
      if (el('review-error')) {
        el('review-error').textContent = err.message;
        show('review-error');
      }
    }
  });
}
