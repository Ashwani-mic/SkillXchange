// Explore view: handles browse/match user screens, search filtering, match tabs, and peer card rendering.
import { state, el, show, hide, toast } from '../state.js';
import { apiGetMatches, apiExploreUsers, apiGetUser } from '../api.js';

let openChatHandler = null;
let openBookModalHandler = null;

export function setExploreActionHandlers(handlers) {
  if (handlers.openChat) openChatHandler = handlers.openChat;
  if (handlers.openBookModal) openBookModalHandler = handlers.openBookModal;
}

export function initMatchTabs() {
  el('mt-perfect')?.addEventListener('click', () => {
    el('mt-perfect')?.classList.add('active'); 
    el('mt-partial')?.classList.remove('active');
    el('match-panel-perfect')?.classList.add('active'); 
    el('match-panel-partial')?.classList.remove('active');
  });
  el('mt-partial')?.addEventListener('click', () => {
    el('mt-partial')?.classList.add('active'); 
    el('mt-perfect')?.classList.remove('active');
    el('match-panel-partial')?.classList.add('active'); 
    el('match-panel-perfect')?.classList.remove('active');
  });
}

export async function loadMatches() {
  try {
    const data = await apiGetMatches();
    const perfect = data.matches.filter(m => m.match_type === 'perfect');
    const partial = data.matches.filter(m => m.match_type === 'partial');

    if (el('qs-matches')) el('qs-matches').textContent = data.matches.length;
    if (el('match-count')) el('match-count').textContent = `${data.matches.length} found`;

    renderMatchGrid('perfect-matches-grid', perfect, 'perfect');
    renderMatchGrid('partial-matches-grid', partial, 'partial');
  } catch {}
}

export function renderMatchGrid(containerId, peers, badgeType) {
  const grid = el(containerId);
  if (!grid) return;
  if (!peers.length) {
    const icons = { perfect: 'fa-circle-nodes', partial: 'fa-handshake' };
    const msgs  = { perfect: 'No perfect matches yet.<br>Add reciprocal skills to unlock!', partial: 'No partial matches found.' };
    grid.innerHTML = `<div class="empty-state-card"><i class="fa-solid ${icons[badgeType] || icons.partial}"></i><p>${msgs[badgeType] || ''}</p></div>`;
    return;
  }
  grid.innerHTML = '';
  peers.forEach(p => grid.appendChild(renderPeerCard(p, badgeType)));
}

export function renderPeerCard(peer, badgeType = 'peer') {
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
    if (!btn) { 
      openPeerProfile(peer.id); 
      return; 
    }
    e.stopPropagation();
    if (btn.dataset.action === 'chat' && openChatHandler) {
      openChatHandler(peer.id, peer.fullname || peer.username, peer.avatar_url);
    }
    if (btn.dataset.action === 'profile') {
      openPeerProfile(peer.id);
    }
  });
  return card;
}

export function renderStars(rating) {
  const full = Math.floor(rating);
  let html = '';
  for (let i = 0; i < 5; i++) {
    html += `<i class="fa-${i < full ? 'solid' : 'regular'} fa-star" style="color:${i < full ? '#f59e0b' : '#444'}"></i>`;
  }
  return html;
}

export function initExplorePage() {
  el('explore-search-btn')?.addEventListener('click', loadExplorePeers);
  el('explore-search-input')?.addEventListener('keydown', e => { 
    if (e.key === 'Enter') loadExplorePeers(); 
  });
}

export async function loadExplorePeers() {
  const search = el('explore-search-input')?.value.trim() || '';
  const filterType = el('explore-filter-type')?.value || '';
  const filterRating = parseFloat(el('explore-filter-rating')?.value || '0');

  try {
    const data = await apiExploreUsers(search, filterType);
    let peers = (data.users || []).filter(u => u.id !== state.currentUser?.id);
    if (filterRating > 0) peers = peers.filter(p => (p.average_rating || 0) >= filterRating);

    const grid = el('explore-grid');
    if (!grid) return;
    if (!peers.length) {
      grid.innerHTML = `<div class="empty-state-card full-width"><i class="fa-solid fa-user-slash"></i><p>No peers found.<br>Try different search terms.</p></div>`;
      return;
    }
    grid.innerHTML = '';
    peers.forEach(p => grid.appendChild(renderPeerCard(p, 'peer')));
  } catch {}
}

export async function openPeerProfile(peerId) {
  show('peer-profile-modal');
  try {
    const data = await apiGetUser(peerId);
    const u = data.user;
    if (el('modal-peer-name')) el('modal-peer-name').textContent = u.fullname || u.username;
    if (el('modal-peer-bio')) el('modal-peer-bio').textContent = u.bio || 'No bio provided.';
    if (el('modal-peer-rating')) el('modal-peer-rating').innerHTML = `${renderStars(u.average_rating || 0)} ${parseFloat(u.average_rating || 0).toFixed(1)}`;
    if (el('modal-peer-status')) el('modal-peer-status').className = 'online-dot ' + (u.is_online ? 'online' : 'offline');

    if (el('modal-peer-avatar')) {
      if (u.avatar_url) el('modal-peer-avatar').innerHTML = `<img src="${u.avatar_url}" alt="avatar">`;
      else el('modal-peer-avatar').innerHTML = `<i class="fa-solid fa-user-astronaut"></i>`;
    }

    const teachList = el('modal-teach-skills');
    const learnList = el('modal-learn-skills');
    if (teachList) teachList.innerHTML = '';
    if (learnList) learnList.innerHTML = '';
    (u.teach_skills || []).forEach(s => {
      const tag = document.createElement('div');
      tag.className = 'modal-skill-tag';
      tag.textContent = s.skill_name;
      teachList?.appendChild(tag);
    });
    (u.learn_skills || []).forEach(s => {
      const tag = document.createElement('div');
      tag.className = 'modal-skill-tag';
      tag.textContent = s.skill_name;
      learnList?.appendChild(tag);
    });

    const reviewsList = el('modal-reviews-list');
    if (reviewsList) {
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
    }

    const chatBtn = el('modal-chat-btn');
    if (chatBtn) {
      chatBtn.onclick = () => {
        hide('peer-profile-modal');
        if (openChatHandler) openChatHandler(u.id, u.fullname || u.username, u.avatar_url);
      };
    }

    const bookBtn = el('modal-book-btn');
    if (bookBtn) {
      bookBtn.onclick = () => {
        hide('peer-profile-modal');
        if (openBookModalHandler) openBookModalHandler(u);
      };
    }
  } catch (err) {
    toast('Could not load profile.', 'error');
  }
}
