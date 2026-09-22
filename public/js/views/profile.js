// Profile view: manages user profile editing, skill additions/deletions, AI bio tag extraction, and AI coaching.
import { state, el, show, hide, qsa, toast } from '../state.js';
import { 
  apiGetMyProfile, 
  apiUpdateMyProfile, 
  apiGetMyReviews, 
  apiGetMySkills, 
  apiAddSkill, 
  apiDeleteSkill, 
  apiAIExtractTags, 
  apiAIChat,
  apiGetAIConfig 
} from '../api.js';
import { renderStars, loadMatches } from './explore.js';

let switchTabFn = null;
export function setProfileNavigationHandler(fn) {
  switchTabFn = fn;
}

export function initProfilePage() {
  el('profile-edit-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    hide('profile-save-error');
    hide('profile-save-success');
    try {
      const data = await apiUpdateMyProfile({
        fullname: el('profile-fullname')?.value.trim(),
        bio: el('profile-bio')?.value.trim(),
        avatar_url: el('profile-avatar')?.value.trim(),
        hide_last_seen: el('profile-hide-last-seen')?.checked
      });
      state.currentUser = { ...state.currentUser, ...data.user };
      show('profile-save-success');
      toast('Profile updated successfully!', 'success');
      loadProfile();
    } catch (err) {
      if (el('profile-save-error')) {
        el('profile-save-error').textContent = err.message;
        show('profile-save-error');
      }
    }
  });

  el('profile-ai-extract-btn')?.addEventListener('click', async () => {
    const btn = el('profile-ai-extract-btn');
    const bioText = el('profile-bio')?.value.trim() || '';
    if (!bioText) {
      toast('Please write a bio first so we can suggest skills!', 'warning');
      return;
    }
    await extractSkillsHelper(btn, bioText);
  });
}

export async function loadProfile() {
  try {
    const data = await apiGetMyProfile();
    const u = data.user;
    state.currentUser = { ...state.currentUser, ...u };

    if (el('profile-display-name')) el('profile-display-name').textContent = u.fullname || u.username;
    if (el('profile-fullname')) el('profile-fullname').value = u.fullname || '';
    if (el('profile-bio')) el('profile-bio').value = u.bio || '';
    if (el('profile-avatar')) el('profile-avatar').value = u.avatar_url || '';
    if (el('profile-credits')) el('profile-credits').textContent = u.credits || 0;
    if (el('credits-count')) el('credits-count').textContent = u.credits || 0;

    const hideLastSeenChk = el('profile-hide-last-seen');
    if (hideLastSeenChk) {
      hideLastSeenChk.checked = u.hide_last_seen === 1;
    }

    const rating = parseFloat(u.average_rating || 0);
    if (el('profile-avg-rating')) el('profile-avg-rating').textContent = rating.toFixed(1);
    if (el('dropdown-rating')) el('dropdown-rating').textContent = rating.toFixed(1);
    if (el('profile-stars')) el('profile-stars').innerHTML = renderStars(rating);

    if (u.avatar_url) {
      if (el('profile-big-avatar')) el('profile-big-avatar').innerHTML = `<img src="${u.avatar_url}" alt="avatar">`;
      if (el('header-avatar')) el('header-avatar').innerHTML = `<img src="${u.avatar_url}" alt="avatar">`;
    }

    loadMyReviews();
  } catch {}
}

export async function loadMyReviews() {
  try {
    const data = await apiGetMyReviews();
    const list = el('my-reviews-list');
    if (!list) return;
    if (!data.reviews.length) {
      list.innerHTML = '<div class="empty-state-card"><i class="fa-solid fa-star"></i><p>No reviews yet.<br>Complete sessions to receive feedback.</p></div>';
      return;
    }
    list.innerHTML = '';
    data.reviews.forEach(r => {
      const div = document.createElement('div');
      div.className = 'review-item glass-card';
      div.innerHTML = `
        <div class="review-item-header">
          <span class="reviewer-name">${r.reviewer_name}</span>
          <span class="review-stars">${renderStars(r.rating)}</span>
        </div>
        <p class="review-comment">${r.comment || 'No comment provided.'}</p>
        <span class="review-date">${new Date(r.created_at).toLocaleDateString()}</span>
      `;
      list.appendChild(div);
    });
  } catch {}
}

export function initSkillsPanel() {
  el('add-skill-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = el('add-skill-submit-btn');
    if (btn) btn.disabled = true;
    hide('skill-error');
    const skillName = el('skill-name')?.value;
    const skillType = el('skill-type')?.value;
    const proficiency = el('skill-proficiency')?.value;

    if (!skillName) {
      if (el('skill-error')) {
        el('skill-error').textContent = 'Please select a skill.';
        show('skill-error');
      }
      if (btn) btn.disabled = false;
      return;
    }

    try {
      await apiAddSkill({ skill_name: skillName, skill_type: skillType, proficiency_level: proficiency });
      toast(`✅ "${skillName}" added to your ${skillType === 'teach' ? 'teaching' : 'learning'} list!`, 'success');
      if (el('skill-name')) el('skill-name').value = '';
      await loadMySkills();
      await loadMatches();
    } catch (err) {
      if (el('skill-error')) {
        el('skill-error').textContent = err.message;
        show('skill-error');
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  el('onboarding-warning-btn')?.addEventListener('click', () => {
    el('skills-card-anchor')?.scrollIntoView({ behavior: 'smooth' });
  });

  el('ai-extract-skills-btn')?.addEventListener('click', async () => {
    const btn = el('ai-extract-skills-btn');
    const bioText = state.currentUser?.bio || '';
    if (!bioText.trim()) {
      toast('Please write a bio in your Profile settings first so we can suggest skills!', 'warning');
      return;
    }
    await extractSkillsHelper(btn, bioText);
  });

  el('close-ai-suggestions-btn')?.addEventListener('click', () => {
    hide('ai-suggestions-container');
  });
}

export async function extractSkillsHelper(btn, bioText) {
  const originalHTML = btn.innerHTML;
  try {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Extracting...`;
    const data = await apiAIExtractTags(bioText);
    renderSuggestions(data);
    
    if (el('dashboard')?.classList.contains('hidden')) {
      if (switchTabFn) switchTabFn('dashboard');
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

export function renderSuggestions(data) {
  const container = el('ai-suggestions-container');
  const list = el('ai-suggestions-list');
  if (!container || !list) return;

  list.innerHTML = '';
  const tags = [...new Set([...(data.teach || []), ...(data.learn || [])])].filter(Boolean);
  
  if (!tags.length) {
    list.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-muted);">No skills detected in your bio. Try adding some action words!</div>';
    container.classList.remove('hidden');
    return;
  }

  tags.forEach(tag => {
    const teachPill = document.createElement('button');
    teachPill.type = 'button';
    teachPill.style.cssText = 'font-size: 0.75rem; padding: 6px 12px; border-radius: 50px; background: rgba(139,92,246,0.08); border: 1px solid rgba(139,92,246,0.3); color: var(--primary-light); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: all 0.2s;';
    teachPill.innerHTML = `<i class="fa-solid fa-graduation-cap"></i> Teach ${tag}`;
    teachPill.onmouseenter = () => { teachPill.style.background = 'rgba(139,92,246,0.18)'; };
    teachPill.onmouseleave = () => { teachPill.style.background = 'rgba(139,92,246,0.08)'; };

    const learnPill = document.createElement('button');
    learnPill.type = 'button';
    learnPill.style.cssText = 'font-size: 0.75rem; padding: 6px 12px; border-radius: 50px; background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.3); color: var(--emerald-light); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: all 0.2s;';
    learnPill.innerHTML = `<i class="fa-solid fa-book-open"></i> Learn ${tag}`;
    learnPill.onmouseenter = () => { learnPill.style.background = 'rgba(16,185,129,0.18)'; };
    learnPill.onmouseleave = () => { learnPill.style.background = 'rgba(16,185,129,0.08)'; };

    teachPill.addEventListener('click', async () => {
      try {
        teachPill.disabled = true;
        await apiAddSkill({ skill_name: tag, skill_type: 'teach', proficiency_level: 'intermediate' });
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

    learnPill.addEventListener('click', async () => {
      try {
        learnPill.disabled = true;
        await apiAddSkill({ skill_name: tag, skill_type: 'learn', proficiency_level: 'beginner' });
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

export async function loadMySkills() {
  try {
    const data = await apiGetMySkills();
    const teachList = el('teach-skills-list');
    const learnList = el('learn-skills-list');
    if (!teachList || !learnList) return;

    const teachSkills = data.skills.filter(s => s.skill_type === 'teach');
    const learnSkills = data.skills.filter(s => s.skill_type === 'learn');

    teachList.innerHTML = teachSkills.length ? '' : '<div class="skills-empty-hint">Add a skill you can teach above</div>';
    learnList.innerHTML = learnSkills.length ? '' : '<div class="skills-empty-hint">Add a skill you want to learn above</div>';

    teachSkills.forEach(skill => teachList.appendChild(renderSkillPill(skill)));
    learnSkills.forEach(skill => learnList.appendChild(renderSkillPill(skill)));

    const total = data.skills.length;
    if (el('total-skills-badge')) el('total-skills-badge').textContent = `${total} skill${total !== 1 ? 's' : ''}`;
    if (el('qs-teaching')) el('qs-teaching').textContent = teachSkills.length;
    if (el('qs-learning')) el('qs-learning').textContent = learnSkills.length;

    const showBanner = total === 0;
    const warning = el('onboarding-warning');
    if (warning) {
      if (showBanner) warning.classList.remove('hidden');
      else warning.classList.add('hidden');
    }
  } catch {}
}

export function renderSkillPill(skill) {
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
  div.querySelector('.skill-del-btn')?.addEventListener('click', async e => {
    e.stopPropagation();
    const id = e.currentTarget.dataset.id;
    try {
      await apiDeleteSkill(id);
      toast('Skill removed.', 'info');
      await loadMySkills();
      await loadMatches();
    } catch (err) { 
      toast(err.message, 'error'); 
    }
  });
  return div;
}

export async function updateAIStatus() {
  const statusText = el('ai-status-text');
  const statusDot = el('ai-status-dot');
  if (!statusText || !statusDot) return;

  try {
    const res = await apiGetAIConfig();
    if (res && res.online) {
      statusText.textContent = `AI Status: online (${res.model || 'Gemini 2.5'})`;
      statusText.style.color = '#10b981';
      statusDot.style.background = '#10b981';
      statusDot.style.boxShadow = '0 0 8px rgba(16, 185, 129, 0.7)';
      if (res.validFormat === false) {
        statusText.title = 'Warning: API key format does not match Google AI Studio (starts with AIzaSy).';
      }
    } else {
      statusText.textContent = 'AI Status: offline (No API key)';
      statusText.style.color = 'var(--text-muted)';
      statusDot.style.background = 'var(--text-muted)';
      statusDot.style.boxShadow = 'none';
    }
  } catch {
    statusText.textContent = 'AI Status: offline';
    statusText.style.color = 'var(--text-muted)';
    statusDot.style.background = 'var(--text-muted)';
    statusDot.style.boxShadow = 'none';
  }
}

export function initAIPanel() {
  const toggleAIDrawer = () => {
    const drawer = el('ai-drawer');
    if (drawer) {
      drawer.classList.toggle('closed');
      if (!drawer.classList.contains('closed')) {
        el('ai-chat-input')?.focus();
        updateAIStatus();
      }
    }
  };

  updateAIStatus();

  el('header-ai-btn')?.addEventListener('click', toggleAIDrawer);
  el('chats-ai-btn')?.addEventListener('click', toggleAIDrawer);
  el('ai-help-btn')?.addEventListener('click', toggleAIDrawer);
  el('close-ai-btn')?.addEventListener('click', () => el('ai-drawer')?.classList.add('closed'));

  el('ai-chat-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const input = el('ai-chat-input');
    const msg = input?.value.trim();
    if (!msg) return;
    if (input) input.value = '';
    appendAIBubble(msg, 'user');

    const loadingEl = appendAIBubble('Thinking...', 'ai', true);

    try {
      const res = await apiAIChat(msg, `Active exchange: teaching/learning with peers`);
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
    const history = el('ai-chat-history');
    if (history) history.scrollTop = history.scrollHeight;
  });

  qsa('.ai-quick-prompts .ai-chip, .ai-quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt;
      const input = el('ai-chat-input');
      if (input && prompt) {
        input.value = prompt;
        el('ai-chat-form')?.dispatchEvent(new Event('submit'));
      }
    });
  });
}

export function formatMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/^### (.*$)/gim, '<strong style="display:block;margin:6px 0 2px;color:var(--primary-light);">$1</strong>')
    .replace(/^## (.*$)/gim, '<strong style="display:block;margin:8px 0 2px;font-size:0.95rem;color:var(--text-primary);">$1</strong>')
    .replace(/^# (.*$)/gim, '<strong style="display:block;margin:10px 0 4px;font-size:1rem;color:var(--accent);">$1</strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.1);padding:2px 5px;border-radius:4px;font-size:0.8em;">$1</code>')
    .replace(/^- (.*$)/gim, '• $1')
    .replace(/\n\n/g, '</p><p style="margin:6px 0;">')
    .replace(/\n/g, '<br>');
}

export function appendAIBubble(text, role, isLoading = false) {
  const history = el('ai-chat-history');
  if (!history) return null;
  const div = document.createElement('div');
  div.className = `ai-bubble ${role}`;
  if (isLoading) div.classList.add('ai-loading');

  if (role === 'ai') {
    div.innerHTML = `<i class="fa-solid fa-robot"></i><div><p>${formatMarkdown(text)}</p></div>`;
  } else {
    div.innerHTML = `<p>${text}</p>`;
  }

  history.appendChild(div);
  history.scrollTop = history.scrollHeight;
  return div;
}
