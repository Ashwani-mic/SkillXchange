// Auth view: handles landing page animations, auth modals, login, and registration form workflows.
import { state, el, show, hide, toast } from '../state.js';
import { apiLogin, apiRegister } from '../api.js';

export function initLanding(onStartAuth) {
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

export function animateCounter(element) {
  const target = parseInt(element.dataset.count, 10);
  const duration = 2000;
  const step = target / (duration / 16);
  let current = 0;
  const timer = setInterval(() => {
    current += step;
    if (current >= target) { 
      element.textContent = target.toLocaleString(); 
      clearInterval(timer); 
    } else {
      element.textContent = Math.floor(current).toLocaleString();
    }
  }, 16);
}

export function openAuthModal(tab = 'login') {
  show('auth-modal');
  if (tab === 'signup') {
    hide('login-form'); 
    el('login-form')?.classList.remove('active');
    el('signup-form')?.classList.add('active'); 
    show('signup-form');
  } else {
    hide('signup-form'); 
    el('signup-form')?.classList.remove('active');
    el('login-form')?.classList.add('active'); 
    show('login-form');
  }
  hide('auth-error');
  hide('auth-loading');
}

export function closeAuthModal() {
  hide('auth-modal');
}

export function initAuthModal(onAuthSuccess) {
  el('auth-modal-close')?.addEventListener('click', closeAuthModal);
  el('auth-modal')?.addEventListener('click', e => { 
    if (e.target === el('auth-modal')) closeAuthModal(); 
  });
  el('to-signup')?.addEventListener('click', e => { 
    e.preventDefault(); 
    openAuthModal('signup'); 
  });
  el('to-login')?.addEventListener('click', e => { 
    e.preventDefault(); 
    openAuthModal('login'); 
  });

  el('login-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    hide('auth-error');
    show('auth-loading');
    try {
      const data = await apiLogin(
        el('login-username').value.trim(),
        el('login-password').value
      );
      state.currentUser = data.user;
      closeAuthModal();
      if (onAuthSuccess) onAuthSuccess();
    } catch (err) {
      if (el('auth-error')) {
        el('auth-error').textContent = err.message;
        show('auth-error');
      }
    } finally { 
      hide('auth-loading'); 
    }
  });

  el('signup-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    hide('auth-error');
    show('auth-loading');
    try {
      const data = await apiRegister({
        username: el('signup-username').value.trim(),
        fullname: el('signup-fullname').value.trim(),
        email: el('signup-email').value.trim(),
        password: el('signup-password').value,
        bio: el('signup-bio').value.trim()
      });
      state.currentUser = data.user;
      closeAuthModal();
      if (onAuthSuccess) onAuthSuccess();
    } catch (err) {
      if (el('auth-error')) {
        el('auth-error').textContent = err.message;
        show('auth-error');
      }
    } finally { 
      hide('auth-loading'); 
    }
  });
}
