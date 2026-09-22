// Classroom View: call overlay UI controls (PIP, workspace toggle, collaborative code editor & whiteboard)
import { state, el, qsa, toast } from '../state.js';
import { endCall, toggleTrack, shareScreen, makeDraggable } from '../webrtc.js';
import { openGroupCallModal } from './sessions.js';

export function initCallUI() {
  el('call-end-btn')?.addEventListener('click', endCall);
  el('call-toggle-audio')?.addEventListener('click', () => toggleTrack('audio'));
  el('call-toggle-video')?.addEventListener('click', () => toggleTrack('video'));
  el('call-toggle-screen')?.addEventListener('click', shareScreen);

  // Call Minimize (WhatsApp floating PIP)
  el('call-minimize-btn')?.addEventListener('click', () => {
    const overlay = el('call-overlay');
    if (overlay) {
      overlay.classList.add('minimized');
      makeDraggable(overlay);
      toast('Call minimized to bubble', 'info');
    }
  });

  // Call Maximize (Restore full screen focus view)
  const restoreCallOverlay = () => {
    const overlay = el('call-overlay');
    if (overlay) {
      overlay.classList.remove('minimized');
      overlay.style.top = '';
      overlay.style.left = '';
      overlay.style.right = '';
      overlay.style.bottom = '';
      overlay.style.width = '';
      overlay.style.height = '';
      toast('Call maximized', 'info');
    }
  };
  el('call-maximize-btn')?.addEventListener('click', restoreCallOverlay);

  // Click floating bubble to restore full screen call
  el('call-overlay')?.addEventListener('click', () => {
    const overlay = el('call-overlay');
    if (overlay && overlay.classList.contains('minimized')) {
      restoreCallOverlay();
    }
  });

  // Workspace Toggle (split screen vs focus video mode)
  el('call-toggle-workspace')?.addEventListener('click', () => {
    const overlay = el('call-overlay');
    const btn = el('call-toggle-workspace');
    if (overlay) {
      const active = overlay.classList.toggle('show-workspace');
      btn?.classList.toggle('active', active);
      toast(active ? 'Workspace split active' : 'Workspace hidden (Focus mode)', 'info');
    }
  });
  
  el('show-participants-btn')?.addEventListener('click', () => {
    el('classroom-participants-drawer')?.classList.toggle('hidden');
  });
  el('close-participants-btn')?.addEventListener('click', () => {
    el('classroom-participants-drawer')?.classList.add('hidden');
  });

  // Invite More Peers button click handler
  el('classroom-add-peer-btn')?.addEventListener('click', () => {
    openGroupCallModal();
  });

  el('tab-code-editor-btn')?.addEventListener('click', () => switchWorkspace('code-editor'));
  el('tab-whiteboard-btn')?.addEventListener('click', () => switchWorkspace('whiteboard'));

  el('code-editor-text')?.addEventListener('input', () => {
    if (state.socket) {
      const target = state.isGroupCall ? state.groupRoomId : (state.activeCallPartnerId || state.activeChat.partnerId);
      if (target) {
        state.socket.emit('code_update', {
          code: el('code-editor-text').value,
          to: target,
          userId: state.currentUser?.id,
          isGroup: state.isGroupCall
        });
      }
    }
  });

  el('whiteboard-text')?.addEventListener('input', () => {
    if (state.socket) {
      const target = state.isGroupCall ? state.groupRoomId : (state.activeCallPartnerId || state.activeChat.partnerId);
      if (target) {
        state.socket.emit('whiteboard_update', {
          text: el('whiteboard-text').value,
          to: target,
          userId: state.currentUser?.id,
          isGroup: state.isGroupCall
        });
      }
    }
  });
}

export function switchWorkspace(tab) {
  const overlay = el('call-overlay');
  if (overlay) {
    overlay.classList.add('show-workspace');
  }
  el('call-toggle-workspace')?.classList.add('active');

  qsa('.ws-tab').forEach(t => t.classList.remove('active'));
  qsa('.ws-pane').forEach(p => {
    p.classList.remove('active');
    p.style.display = 'none';
  });

  const activeTab = el(`tab-${tab}-btn`);
  const activePane = el(`pane-${tab}`);
  if (activeTab) activeTab.classList.add('active');
  if (activePane) {
    activePane.classList.add('active');
    activePane.style.display = 'flex';
  }
}
