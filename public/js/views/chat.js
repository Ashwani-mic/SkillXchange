// Chat view: manages direct and group messaging, attachments, emoji reactions, quoted replies, and chat sidebar.
import { state, el, show, hide, qsa, toast, formatBytes, getMessagePreviewText } from '../state.js';
import { 
  api,
  apiGetGroups, 
  apiCreateGroup,
  apiExploreUsers, 
  apiGetMatches, 
  apiGetMessages, 
  apiSendMessage, 
  apiGetGroup, 
  apiGetGroupMessages, 
  apiPostGroupMessage, 
  apiGetGroupMembers, 
  apiAddGroupMembers, 
  apiDeleteGroup, 
  apiRemoveGroupMember 
} from '../api.js';
import { openVideoCall, startGroupCall } from '../webrtc.js';

let switchTabFn = null;
export function setChatNavigationHandler(fn) {
  switchTabFn = fn;
}

export function initChatsPage() {
  el('create-group-btn')?.addEventListener('click', openCreateGroupModal);
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

  // Attach button triggers file input
  el('chats-attach-btn')?.addEventListener('click', e => {
    e.preventDefault();
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
    state.activeUploadFile = file;
    const reader = new FileReader();
    reader.onload = function(evt) {
      state.activeUploadDataUrl = evt.target.result;
      const previewBody = el('chats-preview-body');
      if (!previewBody) return;
      previewBody.innerHTML = '';
      if (file.type.startsWith('image/')) {
        previewBody.innerHTML = `
          <img src="${state.activeUploadDataUrl}" style="max-width: 100%; max-height: 250px; object-fit: contain; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.5);">
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
      if (el('chats-preview-caption')) el('chats-preview-caption').value = '';
      el('chats-file-preview-overlay')?.classList.remove('hidden');
      el('chats-preview-caption')?.focus();
    };
    reader.readAsDataURL(file);
  });

  const discardPreview = () => {
    el('chats-file-preview-overlay')?.classList.add('hidden');
    if (el('chats-file-input')) el('chats-file-input').value = '';
    state.activeUploadFile = null;
    state.activeUploadDataUrl = null;
  };
  el('chats-preview-discard-btn')?.addEventListener('click', discardPreview);
  el('chats-preview-cancel-btn')?.addEventListener('click', discardPreview);

  el('chats-preview-send-btn')?.addEventListener('click', async () => {
    if (!state.activeUploadFile || !state.activeUploadDataUrl) return;
    const caption = el('chats-preview-caption')?.value.trim() || '';
    const payload = '[FILE_JSON]:' + JSON.stringify({
      type: state.activeUploadFile.type.startsWith('image/') ? 'image' : 'file',
      fileName: state.activeUploadFile.name,
      fileSize: state.activeUploadFile.size,
      fileType: state.activeUploadFile.type,
      fileData: state.activeUploadDataUrl,
      caption: caption
    });
    try {
      await sendChatMessage(payload);
      discardPreview();
    } catch (err) {
      toast('Failed to send file: ' + err.message, 'error');
    }
  });

  el('close-image-viewer-btn')?.addEventListener('click', () => {
    el('image-viewer-overlay')?.classList.add('hidden');
  });

  el('create-group-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    hide('create-group-error');
    const name = el('group-name-input')?.value.trim();
    if (!name) return;

    const checkedBoxes = document.querySelectorAll('input[name="group-member-invite"]:checked');
    const memberIds = Array.from(checkedBoxes).map(cb => parseInt(cb.value, 10));

    try {
      const res = await apiCreateGroup({ name, memberIds });
      hide('create-group-modal');
      toast(`👥 Group "${name}" created!`, 'success');
      loadChatsPage();
      selectChat(`group_${res.groupId}`, name, null);
    } catch (err) {
      if (el('create-group-error')) {
        el('create-group-error').textContent = err.message;
        show('create-group-error');
      }
    }
  });

  el('chats-search-input')?.addEventListener('input', e => {
    const query = e.target.value.toLowerCase().trim();
    qsa('.chat-item').forEach(item => {
      const name = item.querySelector('.chat-item-name')?.textContent.toLowerCase() || '';
      item.style.display = name.includes(query) ? 'flex' : 'none';
    });
  });

  el('chats-toggle-search-btn')?.addEventListener('click', () => {
    const container = el('chats-local-search-container');
    if (!container) return;
    container.classList.toggle('hidden');
    if (!container.classList.contains('hidden')) {
      el('chats-local-search-input')?.focus();
    } else {
      if (el('chats-local-search-input')) el('chats-local-search-input').value = '';
      document.querySelectorAll('.msg-bubble').forEach(b => b.style.display = '');
    }
  });

  el('chats-local-search-close')?.addEventListener('click', () => {
    el('chats-local-search-container')?.classList.add('hidden');
    if (el('chats-local-search-input')) el('chats-local-search-input').value = '';
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

  el('chats-reply-cancel-btn')?.addEventListener('click', clearReplyPreview);

  const inputEl = el('chats-message-input');
  inputEl?.addEventListener('input', () => {
    if (!state.currentActiveChatId || !state.socket || !state.socket.connected) return;
    const isGroup = typeof state.currentActiveChatId === 'string' && state.currentActiveChatId.startsWith('group_');
    const receiverId = isGroup ? state.currentActiveChatId.replace('group_', '') : state.currentActiveChatId;

    if (!state.isTyping) {
      state.isTyping = true;
      state.socket.emit('typing', { receiver_id: receiverId, is_group: isGroup });
    }

    clearTimeout(state.typingTimeout);
    state.typingTimeout = setTimeout(() => {
      state.isTyping = false;
      state.socket.emit('stop_typing', { receiver_id: receiverId, is_group: isGroup });
    }, 2000);
  });

  inputEl?.addEventListener('keydown', e => {
    if (e.key === 'Escape' && state.editMessageId) {
      state.editMessageId = null;
      inputEl.value = '';
      inputEl.style.border = '';
      toast('Edit cancelled', 'info');
    }
  });

  el('chats-input-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const input = el('chats-message-input');
    const message = input?.value.trim();
    if (!message || !state.currentActiveChatId) return;

    try {
      if (state.isTyping) {
        state.isTyping = false;
        const isGroup = typeof state.currentActiveChatId === 'string' && state.currentActiveChatId.startsWith('group_');
        const receiverId = isGroup ? state.currentActiveChatId.replace('group_', '') : state.currentActiveChatId;
        if (state.socket) state.socket.emit('stop_typing', { receiver_id: receiverId, is_group: isGroup });
        clearTimeout(state.typingTimeout);
      }

      await sendChatMessage(message);
      if (input) input.value = '';
    } catch (err) {
      toast('Failed to send message: ' + err.message, 'error');
    }
  });
}

export async function sendChatMessage(message) {
  const isGroup = typeof state.currentActiveChatId === 'string' && state.currentActiveChatId.startsWith('group_');
  const logEl = el('chats-messages-log');

  if (state.editMessageId) {
    if (state.socket && state.socket.connected) {
      state.socket.emit('edit_message', { id: state.editMessageId, is_group: isGroup, message });
    }
    state.editMessageId = null;
    if (el('chats-message-input')) el('chats-message-input').style.border = '';
    return;
  }

  if (!navigator.onLine) {
    saveOfflineMessage({
      chatId: state.currentActiveChatId,
      message,
      replyToId: state.activeReplyMessageId,
      timestamp: new Date().toISOString()
    });
    if (logEl) appendChatMessageToElement(logEl, message, 'outgoing', null, `offline_${Date.now()}`, 'offline', state.activeReplyMessageId);
    clearReplyPreview();
    return;
  }

  const replyToId = state.activeReplyMessageId;
  clearReplyPreview();

  if (isGroup) {
    const groupId = state.currentActiveChatId.replace('group_', '');
    if (state.socket && state.socket.connected) {
      state.socket.emit('send_group_message', { group_id: groupId, message, reply_to_id: replyToId });
      if (logEl) appendChatMessageToElement(logEl, message, 'outgoing', null, null, 'sent', replyToId);
    } else {
      const res = await apiPostGroupMessage(groupId, { message, reply_to_id: replyToId });
      if (logEl) appendChatMessageToElement(logEl, message, 'outgoing', null, res.messageId, 'sent', replyToId);
    }
  } else {
    if (state.socket && state.socket.connected) {
      state.socket.emit('send_message', { 
        receiver_id: state.currentActiveChatId, 
        message, 
        sender_name: state.currentUser?.username, 
        reply_to_id: replyToId 
      });
      if (logEl) appendChatMessageToElement(logEl, message, 'outgoing', null, null, 'sent', replyToId);
    } else {
      const res = await apiSendMessage(state.currentActiveChatId, message, replyToId);
      if (logEl) appendChatMessageToElement(logEl, message, 'outgoing', null, res.id, 'sent', replyToId);
    }
  }
}

export function clearReplyPreview() {
  state.activeReplyMessageId = null;
  el('chats-reply-preview-bar')?.classList.add('hidden');
}

export function saveOfflineMessage(msg) {
  state.offlineMessageQueue.push(msg);
  try {
    localStorage.setItem('offline_messages_queue', JSON.stringify(state.offlineMessageQueue));
  } catch {}
  toast('You are offline. Message queued and will send on reconnect.', 'warning');
}

export async function flushOfflineMessages() {
  if (state.offlineMessageQueue.length === 0) return;
  toast('Connection restored! Sending queued messages...', 'success');
  const queue = [...state.offlineMessageQueue];
  state.offlineMessageQueue = [];
  try {
    localStorage.removeItem('offline_messages_queue');
  } catch {}
  
  for (const msg of queue) {
    if (msg.chatId === state.currentActiveChatId) {
      document.querySelectorAll('.msg-bubble[data-msg-id^="offline_"]').forEach(b => b.remove());
    }
    try {
      state.currentActiveChatId = msg.chatId;
      state.activeReplyMessageId = msg.replyToId;
      await sendChatMessage(msg.message);
    } catch (e) {
      console.error('Failed to send offline message:', e);
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', flushOfflineMessages);
  window.addEventListener('load', () => {
    try {
      state.offlineMessageQueue = JSON.parse(localStorage.getItem('offline_messages_queue') || '[]');
      if (navigator.onLine && state.offlineMessageQueue.length > 0) {
        flushOfflineMessages();
      }
    } catch {}
  });
}

export async function loadChatsPage() {
  const listContainer = el('chats-list-container');
  if (!listContainer) return;

  listContainer.innerHTML = '<div class="skills-empty-hint"><i class="fa-solid fa-spinner fa-spin"></i> Loading chats...</div>';

  try {
    const [groupsData, exploreData, matchesData] = await Promise.all([
      apiGetGroups(),
      apiExploreUsers(),
      apiGetMatches().catch(() => ({ matches: [] }))
    ]);

    state.activeGroupsList = groupsData.groups || [];
    const peers = exploreData.users || [];
    const matches = matchesData.matches || [];
    const matchIds = new Set(matches.map(m => m.id));
    const perfectMatchIds = new Set(matches.filter(m => m.match_type === 'perfect').map(m => m.id));

    listContainer.innerHTML = '';

    if (state.activeGroupsList.length > 0) {
      const groupHeader = document.createElement('div');
      groupHeader.className = 'col-header teach-header';
      groupHeader.style.margin = '8px 0 4px 0';
      groupHeader.innerHTML = '<i class="fa-solid fa-users"></i> Study Groups';
      listContainer.appendChild(groupHeader);

      state.activeGroupsList.forEach(g => {
        const item = document.createElement('div');
        item.className = 'chat-item';
        item.dataset.groupId = g.id;
        if (state.currentActiveChatId === `group_${g.id}`) item.classList.add('active');

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
        if (state.currentActiveChatId === m.id) item.classList.add('active');

        const isOnline = state.onlineUserIdsSet.has(m.id);
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
            <span class="online-dot-badge ${isOnline ? 'online' : 'offline'}"></span>
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
    if (err.message && err.message.toLowerCase().includes('not authenticated')) {
      state.currentUser = null;
      hide('app-view');
      show('landing-view');
      toast('Your session has expired. Please log in again.', 'warning');
      return;
    }
    listContainer.innerHTML = `<div class="error-msg">Failed to load: ${err.message}</div>`;
  }
}

export async function selectChat(id, name, avatarUrl) {
  state.currentActiveChatId = id;
  state.activeChat.avatarUrl = avatarUrl;

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
  if (nameEl) nameEl.textContent = name;

  const avatarEl = el('chats-header-avatar');
  const isGroup = typeof id === 'string' && id.startsWith('group_');
  if (avatarEl) {
    if (avatarUrl) {
      avatarEl.innerHTML = `<img src="${avatarUrl}" alt="avatar">`;
    } else {
      avatarEl.innerHTML = isGroup ? `<i class="fa-solid fa-people-group"></i>` : `<i class="fa-solid fa-user"></i>`;
    }
  }

  const statusEl = el('chats-header-status');
  const callBtn = el('chats-start-call-btn');
  const deleteGroupBtn = el('chats-delete-group-btn');
  const toggleMembersBtn = el('chats-toggle-members-btn');
  const membersSidebar = el('chats-members-sidebar');
  const membersListEl = el('chats-members-list');

  if (isGroup) {
    if (statusEl) {
      statusEl.textContent = 'Group Chat';
      statusEl.className = 'online-dot online';
    }
    if (callBtn) {
      callBtn.innerHTML = '<i class="fa-solid fa-users"></i> <span>Start Class</span>';
      callBtn.onclick = async () => {
        const groupId = id.replace('group_', '');
        try {
          const membersData = await apiGetGroupMembers(groupId);
          state.classroomGroupMembers = (membersData.members || [])
            .filter(m => m.id !== state.currentUser.id)
            .map(m => ({ id: m.id, name: m.fullname || m.name || m.username }));
          
          await startGroupCall([]);
        } catch (err) {
          toast('Failed to start group call: ' + err.message, 'error');
        }
      };
    }

    toggleMembersBtn?.classList.remove('hidden');
    if (window.innerWidth > 768) {
      membersSidebar?.classList.remove('hidden');
    } else {
      membersSidebar?.classList.add('hidden');
    }

    if (toggleMembersBtn) {
      toggleMembersBtn.onclick = () => {
        membersSidebar?.classList.toggle('hidden');
      };
    }

    const groupId = id.replace('group_', '');
    apiGetGroup(groupId).then(groupData => {
      if (!membersListEl) return;
      membersListEl.innerHTML = '';
      
      const isOwner = groupData.created_by === state.currentUser.id;
      let isAdmin = false;
      
      if (groupData && Array.isArray(groupData.members)) {
        const meInGroup = groupData.members.find(m => m.id === state.currentUser.id);
        if (meInGroup && meInGroup.role === 'admin') {
          isAdmin = true;
        }

        const addMemberBtn = el('chats-group-add-btn');
        const inviteLinkBtn = el('chats-group-invite-btn');
        const showButtons = isOwner || isAdmin;

        if (addMemberBtn) {
          if (showButtons) {
            addMemberBtn.classList.remove('hidden');
            addMemberBtn.onclick = () => {
              openAddMemberModal(groupId, groupData.members);
            };
          } else {
            addMemberBtn.classList.add('hidden');
          }
        }

        if (inviteLinkBtn) {
          if (showButtons) {
            inviteLinkBtn.classList.remove('hidden');
            inviteLinkBtn.onclick = () => {
              const inviteUrl = `${window.location.origin}/#join-group_${groupId}`;
              navigator.clipboard.writeText(inviteUrl).then(() => {
                toast('Group invite link copied to clipboard!', 'success');
              }).catch(() => {
                toast('Failed to copy link. Here it is: ' + inviteUrl, 'warning');
              });
            };
          } else {
            inviteLinkBtn.classList.add('hidden');
          }
        }

        groupData.members.forEach(member => {
          const isMe = member.id === state.currentUser.id;
          const isOnline = state.onlineUserIdsSet.has(member.id);
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
                  await apiRemoveGroupMember(groupId, member.id);
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

      if (deleteGroupBtn) {
        if (isOwner || isAdmin) {
          deleteGroupBtn.classList.remove('hidden');
          deleteGroupBtn.onclick = () => {
            const confirmed = confirm('Are you sure you want to delete this group? This action cannot be undone.');
            if (confirmed) {
              apiDeleteGroup(groupId)
                .then(() => {
                  toast('Group deleted successfully.', 'success');
                  hide('chats-window-active');
                  show('chats-window-empty');
                  state.currentActiveChatId = null;
                  loadChatsPage();
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
      if (membersListEl) membersListEl.innerHTML = '<div style="font-size: 0.85rem; color: var(--danger); padding: 8px;">Failed to load roster</div>';
      if (deleteGroupBtn) deleteGroupBtn.classList.add('hidden');
    });
  } else {
    toggleMembersBtn?.classList.add('hidden');
    membersSidebar?.classList.add('hidden');
    deleteGroupBtn?.classList.add('hidden');

    const isOnline = state.onlineUserIdsSet.has(id);
    if (statusEl) {
      statusEl.textContent = isOnline ? 'online' : 'offline';
      statusEl.className = 'online-dot ' + (isOnline ? 'online' : 'offline');
    }
    if (callBtn) {
      callBtn.innerHTML = '<i class="fa-solid fa-video"></i> <span>Start Class</span>';
      callBtn.onclick = () => {
        openVideoCall(id, name);
      };
    }
  }

  const logEl = el('chats-messages-log');
  if (!logEl) return;
  logEl.innerHTML = '<div class="skills-empty-hint"><i class="fa-solid fa-spinner fa-spin"></i> Loading messages...</div>';

  try {
    if (isGroup) {
      const groupId = id.replace('group_', '');
      const data = await apiGetGroupMessages(groupId);
      logEl.innerHTML = '';
      data.messages.forEach(m => {
        appendChatMessageToElement(logEl, m.message, m.sender_id === state.currentUser?.id ? 'outgoing' : 'incoming', m.sender_name, m.id, 'sent', m.reply_to_id, m.reactions, m.is_edited, m.is_deleted, m.read_by);
      });
      if (state.socket && state.socket.connected) {
        state.socket.emit('mark_group_as_read', { group_id: groupId });
      }
    } else {
      const data = await apiGetMessages(id);
      logEl.innerHTML = '';
      data.messages.forEach(m => {
        if (m.is_call_log) {
          appendChatMessageToElement(logEl, m.message, m.sender_id === state.currentUser?.id ? 'outgoing call-log' : 'incoming call-log');
        } else {
          appendChatMessageToElement(logEl, m.message, m.sender_id === state.currentUser?.id ? 'outgoing' : 'incoming', null, m.id, m.status, m.reply_to_id, m.reactions, m.is_edited, m.is_deleted);
        }
      });
      if (state.socket && state.socket.connected) {
        state.socket.emit('mark_as_read', { partner_id: id });
      }
    }
    logEl.scrollTop = logEl.scrollHeight;
  } catch (err) {
    logEl.innerHTML = `<div class="error-msg">Failed to load: ${err.message}</div>`;
  }
}

export function appendChatMessageToElement(logEl, text, direction, senderName = null, id = null, status = 'sent', replyToId = null, reactions = '[]', isEdited = 0, isDeleted = 0, readBy = null) {
  const div = document.createElement('div');
  div.className = `msg-bubble ${direction}`;
  if (id) div.setAttribute('data-msg-id', id);
  if (readBy) div.setAttribute('data-read-by', readBy);

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
  } else if (text && text.startsWith('[FILE_JSON]:')) {
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
          const viewerImg = el('viewer-img');
          if (viewerImg) viewerImg.src = fileInfo.fileData;
          el('image-viewer-overlay')?.classList.remove('hidden');
        });
        textEl.appendChild(img);
      } else if (fileInfo.type === 'audio' || fileInfo.fileName?.endsWith('.webm')) {
        const audio = document.createElement('audio');
        audio.src = fileInfo.fileData;
        audio.controls = true;
        audio.style.cssText = 'max-width: 250px; height: 36px; border-radius: 18px; display: block; outline: none; margin-top: 4px;';
        textEl.appendChild(audio);
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

  if (isEdited) {
    const editedLabel = document.createElement('span');
    editedLabel.className = 'msg-edited-label';
    editedLabel.style.cssText = 'font-size: 0.65rem; color: var(--text-muted); margin-left: 6px; font-style: italic;';
    editedLabel.textContent = '(edited)';
    div.appendChild(editedLabel);
  }

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

  if (id && reactions) {
    renderBubbleReactions(div, id, reactions);
  }

  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

export function showMsgActionsMenu(bubble, id, text, direction) {
  document.querySelectorAll('.msg-actions-menu').forEach(m => m.remove());
  document.querySelectorAll('.msg-reactions-picker').forEach(p => p.remove());

  const menu = document.createElement('div');
  menu.className = 'msg-actions-menu';
  menu.style.cssText = 'position: absolute; background: #0f1322; border: 1px solid rgba(139,92,246,0.3); border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); padding: 4px; display: flex; flex-direction: column; gap: 4px; z-index: 1000; font-size: 0.8rem;';

  const rect = bubble.getBoundingClientRect();
  const parentRect = bubble.parentElement.getBoundingClientRect();
  menu.style.top = (rect.top - parentRect.top - 40) + 'px';
  menu.style.left = (rect.left - parentRect.left + rect.width / 2 - 50) + 'px';

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
        if (state.socket) {
          state.socket.emit('delete_message', { 
            id, 
            is_group: (typeof state.currentActiveChatId === 'string' && state.currentActiveChatId.startsWith('group_')) 
          });
        }
      }
    };
    menu.appendChild(deleteBtn);
  }

  const readBy = bubble.getAttribute('data-read-by');
  if (readBy) {
    const seenInfo = document.createElement('div');
    seenInfo.style.cssText = 'border-top: 1px solid rgba(255,255,255,0.08); padding: 6px 12px 2px; font-size: 0.72rem; color: var(--text-muted); white-space: nowrap; font-style: italic;';
    seenInfo.innerHTML = `<i class="fa-solid fa-eye" style="margin-right: 4px;"></i> Seen by: ${readBy}`;
    menu.appendChild(seenInfo);
  }

  bubble.parentElement.appendChild(menu);

  const closeHandler = () => {
    menu.remove();
    document.removeEventListener('click', closeHandler);
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 100);
}

export function showEmojiPicker(bubble, id) {
  document.querySelectorAll('.msg-reactions-picker').forEach(p => p.remove());

  const picker = document.createElement('div');
  picker.className = 'msg-reactions-picker';

  const emojis = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
  emojis.forEach(e => {
    const span = document.createElement('span');
    span.textContent = e;
    span.onclick = () => {
      picker.remove();
      if (state.socket) {
        state.socket.emit('react_message', {
          id,
          is_group: (typeof state.currentActiveChatId === 'string' && state.currentActiveChatId.startsWith('group_')),
          emoji: e
        });
      }
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

export function renderBubbleReactions(bubble, id, reactions) {
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
      const hasMyReaction = reactionsList.some(r => r.user_id === state.currentUser?.id && r.emoji === emoji);
      if (state.socket) {
        state.socket.emit('react_message', {
          id,
          is_group: (typeof state.currentActiveChatId === 'string' && state.currentActiveChatId.startsWith('group_')),
          emoji: hasMyReaction ? null : emoji
        });
      }
    };
    row.appendChild(badge);
  });

  bubble.appendChild(row);
}

export function updateBubbleStatusUI(bubble, status) {
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

export function startQuotedReply(id, text) {
  state.activeReplyMessageId = id;
  const bubble = document.querySelector(`.msg-bubble[data-msg-id="${id}"]`);
  
  let senderName = 'Message';
  if (bubble) {
    const nameEl = bubble.querySelector('span');
    if (nameEl) senderName = nameEl.textContent;
    else if (bubble.classList.contains('outgoing')) senderName = 'You';
    else senderName = state.activeChat.partnerName || 'Peer';
  }

  const previewText = text.startsWith('[FILE_JSON]:') ? getMessagePreviewText(text) : text;
  if (el('chats-reply-preview-title')) el('chats-reply-preview-title').textContent = `Replying to ${senderName}`;
  if (el('chats-reply-preview-text')) el('chats-reply-preview-text').textContent = previewText;
  el('chats-reply-preview-bar')?.classList.remove('hidden');
  el('chats-message-input')?.focus();
}

export function startEditingMessage(id, text) {
  if (text.startsWith('[FILE_JSON]:')) {
    toast('Cannot edit file attachments.', 'warning');
    return;
  }
  state.editMessageId = id;
  const input = el('chats-message-input');
  if (input) {
    input.value = text;
    input.focus();
    input.style.border = '1px solid var(--accent)';
  }
  toast('Editing message (press Esc to cancel)', 'info');
}

export async function openCreateGroupModal() {
  show('create-group-modal');
  if (el('group-name-input')) el('group-name-input').value = '';
  hide('create-group-error');

  const listContainer = el('create-group-peers-list');
  if (!listContainer) return;

  listContainer.innerHTML = '<div class="skills-empty-hint"><i class="fa-solid fa-spinner fa-spin"></i> Loading peers...</div>';

  try {
    const data = await apiExploreUsers();
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

export async function openAddMemberModal(groupId, existingMembers) {
  const modal = el('add-member-modal');
  const listEl = el('add-member-peers-list');
  const errorEl = el('add-member-error');

  if (!modal || !listEl) return;

  hide(errorEl);
  listEl.innerHTML = '<div class="skills-empty-hint"><i class="fa-solid fa-spinner fa-spin"></i> Loading matches...</div>';
  show('add-member-modal');

  try {
    const matchesData = await apiGetMatches().catch(() => ({ matches: [] }));
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
    if (form) {
      form.onsubmit = async e => {
        e.preventDefault();
        const selectedIds = Array.from(document.querySelectorAll('.add-peer-checkbox:checked')).map(cb => cb.value);
        if (selectedIds.length === 0) {
          if (errorEl) {
            errorEl.textContent = 'Please select at least one member to add.';
            show(errorEl);
          }
          return;
        }

        try {
          await apiAddGroupMembers(groupId, selectedIds);
          toast('Members added successfully.', 'success');
          hide('add-member-modal');
          selectChat(state.currentActiveChatId, el('chats-header-name')?.textContent || '', state.activeChat.avatarUrl);
        } catch (err) {
          if (errorEl) {
            errorEl.textContent = err.message;
            show(errorEl);
          }
        }
      };
    }
  } catch (err) {
    listEl.innerHTML = `<div class="error-msg">Failed to load matches: ${err.message}</div>`;
  }
}

// Sidebar Chat Panel
export function initChatPanel() {
  el('close-chat-btn')?.addEventListener('click', closeChat);
  el('chat-input-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = el('chat-message-input')?.value.trim();
    if (!msg || !state.activeChat.partnerId) return;
    if (el('chat-message-input')) el('chat-message-input').value = '';
    
    appendChatMessage(msg, 'outgoing');
    
    if (state.socket && state.socket.connected) {
      state.socket.emit('send_message', { 
        receiver_id: state.activeChat.partnerId, 
        message: msg, 
        sender_name: state.currentUser?.username 
      });
    } else {
      try {
        await apiSendMessage(state.activeChat.partnerId, msg);
      } catch (err) {
        toast('Failed to send message: connection lost.', 'error');
      }
    }
  });

  el('start-call-btn')?.addEventListener('click', () => {
    if (!state.activeChat.partnerId) return;
    openVideoCall(state.activeChat.partnerId, state.activeChat.partnerName);
  });

  el('start-group-call-btn')?.addEventListener('click', () => {
    startGroupCall([]);
  });

  el('ai-help-btn')?.addEventListener('click', () => {
    el('ai-drawer')?.classList.toggle('closed');
  });
}

export function openChat(peerId, peerName, avatarUrl) {
  if (switchTabFn) switchTabFn('chats');
  qsa('.header-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'chats'));
  selectChat(peerId, peerName, avatarUrl);
}

export function closeChat() {
  el('chat-sidebar')?.classList.add('closed');
  el('ai-drawer')?.classList.add('closed');
}

export function appendChatMessage(text, direction) {
  const log = el('chat-messages-log');
  if (log) {
    appendChatMessageToElement(log, text, direction);
  }
}
