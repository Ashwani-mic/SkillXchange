// Socket.IO client module: connection lifecycle, real-time messaging, presence sync, classroom & WebRTC signaling
import { state, el, show, hide, toast, triggerNewMessageNotification, triggerIncomingCallNotification, getMessagePreviewText } from './state.js';
import { appendChatMessageToElement, updateBubbleStatusUI, renderBubbleReactions, loadChatsPage } from './views/chat.js';
import { 
  initPeerConnection, 
  drainIceQueue, 
  addIceCandidateSafely, 
  acceptDirectCall, 
  endCall, 
  endCallLocal, 
  joinGroupCall, 
  createGroupPeerConnection, 
  updateGroupParticipantsList, 
  updateVideoGridLayout 
} from './webrtc.js';

export function updateUserPresenceUI(userId, isOnline) {
  userId = parseInt(userId);
  
  // 1. Update active chat partner status in the chat header
  if (state.activeChat.partnerId === userId) {
    const statusDot = el('chats-header-status');
    if (statusDot) {
      statusDot.textContent = isOnline ? 'online' : 'offline';
      statusDot.className = 'online-dot ' + (isOnline ? 'online' : 'offline');
    }
  }
  
  // 2. Update peer profile modal status if open
  const profileModal = el('peer-profile-modal');
  if (profileModal && !profileModal.classList.contains('hidden')) {
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
  const userCards = document.querySelectorAll('.peer-card');
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
    const dotColor = isOnline ? '#10b981' : '#475569';
    const dotShadow = isOnline ? 'box-shadow: 0 0 5px #10b981;' : 'box-shadow: none;';
    groupMemberDot.style.background = dotColor;
    groupMemberDot.style.boxShadow = dotShadow;
  }

  // 6. Update Classroom Candidates / invite list
  if (state.isGroupCall && state.groupRoomId) {
    updateGroupParticipantsList();
  }
}

export function initSocketIO() {
  state.socket = io();
  let heartbeatInterval = null;

  state.socket.on('connect', () => {
    // 1. Re-authenticate upon connection/reconnection to sync server state
    if (state.currentUser?.id) {
      state.socket.emit('authenticate', state.currentUser.id);
    }
    
    // 2. Start heartbeat pinging every 25 seconds
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      if (state.socket && state.socket.connected) {
        state.socket.emit('heartbeat');
      }
    }, 25000);
  });

  state.socket.on('disconnect', () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  });

  state.socket.on('online_users_list', userIds => {
    // Reset and reconcile presence state upon reconnection to prevent desync
    state.onlineUserIdsSet.forEach(userId => {
      updateUserPresenceUI(userId, false);
    });
    state.onlineUserIdsSet.clear();

    userIds.forEach(id => {
      const userId = parseInt(id);
      state.onlineUserIdsSet.add(userId);
      updateUserPresenceUI(userId, true);
    });
  });

  state.socket.on('receive_message', msg => {
    const isActiveTab = (state.activeChat.partnerId === msg.sender_id) || (state.currentActiveChatId === msg.sender_id);
    if (isActiveTab) {
      state.socket.emit('mark_as_read', { partner_id: msg.sender_id });
    }

    const logEl = el('chats-messages-log');
    const isChatsTabActive = (state.currentActiveChatId === msg.sender_id);
    if (logEl && isChatsTabActive) {
      if (msg.is_call_log) {
        appendChatMessageToElement(logEl, msg.message, msg.sender_id === state.currentUser?.id ? 'outgoing call-log' : 'incoming call-log');
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

  state.socket.on('message_status_update', ({ id, status }) => {
    const bubble = document.querySelector(`.msg-bubble[data-msg-id="${id}"]`);
    if (bubble) {
      updateBubbleStatusUI(bubble, status);
    }
  });

  state.socket.on('messages_read_by_peer', ({ reader_id }) => {
    if (state.currentActiveChatId === reader_id) {
      document.querySelectorAll('.msg-bubble.outgoing .msg-status-tick').forEach(tick => {
        tick.className = 'fa-solid fa-check-double msg-status-tick';
        tick.style.color = '#3b82f6';
      });
    }
  });

  state.socket.on('user_typing', ({ sender_id, group_id, username }) => {
    if (group_id) {
      if (state.currentActiveChatId === `group_${group_id}`) {
        const headerStatus = el('chats-header-status');
        if (headerStatus) {
          headerStatus.innerHTML = `${username} is typing<span class="typing-dot">.</span><span class="typing-dot">.</span><span class="typing-dot">.</span>`;
        }
      }
    } else {
      if (state.currentActiveChatId === sender_id) {
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

  state.socket.on('user_stop_typing', ({ sender_id, group_id }) => {
    const headerStatus = el('chats-header-status');
    if (group_id) {
      if (state.currentActiveChatId === `group_${group_id}`) {
        if (headerStatus) headerStatus.textContent = 'Group Chat';
      }
    } else {
      if (state.currentActiveChatId === sender_id) {
        const isOnline = state.onlineUserIdsSet.has(sender_id);
        if (headerStatus) {
          headerStatus.textContent = isOnline ? 'online' : 'offline';
        }
      }
      loadChatsPage();
    }
  });

  state.socket.on('message_edited', ({ id, is_group, message }) => {
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

  state.socket.on('message_deleted', ({ id }) => {
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

  state.socket.on('message_reacted', ({ id, reactions }) => {
    const bubble = document.querySelector(`.msg-bubble[data-msg-id="${id}"]`);
    if (bubble) {
      renderBubbleReactions(bubble, id, reactions);
    }
  });

  state.socket.on('peer_raise_hand', ({ socketId, userId, is_raised }) => {
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

  state.socket.on('kicked_from_class', () => {
    toast('You have been removed from the classroom by the host.', 'error');
    endCall();
  });

  state.socket.on('force_mute_mic', () => {
    if (state.localStream) {
      const audioTrack = state.localStream.getAudioTracks()[0];
      if (audioTrack && audioTrack.enabled) {
        audioTrack.enabled = false;
        const muteBtn = el('call-toggle-audio');
        if (muteBtn) {
          muteBtn.classList.add('muted');
          muteBtn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
        }
        toast('You have been muted by the host.', 'warning');
      }
    }
  });

  state.socket.on('user_online', userId => {
    userId = parseInt(userId);
    state.onlineUserIdsSet.add(userId);
    updateUserPresenceUI(userId, true);
  });

  state.socket.on('user_offline', userId => {
    userId = parseInt(userId);
    state.onlineUserIdsSet.delete(userId);
    updateUserPresenceUI(userId, false);
  });

  state.socket.on('code_update', ({ code, userId }) => {
    if (userId !== state.currentUser?.id) {
      const ta = el('code-editor-text');
      if (ta && document.activeElement !== ta) ta.value = code;
    }
  });

  state.socket.on('whiteboard_update', ({ text, userId }) => {
    if (userId !== state.currentUser?.id) {
      const ta = el('whiteboard-text');
      if (ta && document.activeElement !== ta) ta.value = text;
    }
  });

  // WebRTC signaling (legacy fallback)
  state.socket.on('webrtc_offer', async ({ offer, from }) => {
    if (!state.peerConnection) initPeerConnection(from);
    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await state.peerConnection.createAnswer();
    await state.peerConnection.setLocalDescription(answer);
    state.socket.emit('webrtc_answer', { answer, to: from });
  });

  state.socket.on('webrtc_answer', async ({ answer }) => {
    if (state.peerConnection) {
      try {
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        await drainIceQueue(state.peerConnection);
      } catch (e) {
        console.error('Failed to set remote description answer:', e);
      }
    }
  });

  state.socket.on('webrtc_ice', async ({ candidate }) => {
    if (state.peerConnection) {
      await addIceCandidateSafely(state.peerConnection, candidate);
    } else {
      state.globalIceQueue.push(candidate);
      console.log("Cached ICE candidate in global queue:", candidate);
    }
  });

  // WebRTC 1-on-1 Signaling Enhanced Flow
  state.socket.on('incoming_call', ({ callerId, callerName, offer }) => {
    triggerIncomingCallNotification(callerName, false);
    show('incoming-call-modal');
    if (el('incoming-call-title')) el('incoming-call-title').textContent = 'Incoming Class Call';
    if (el('incoming-call-msg')) el('incoming-call-msg').textContent = `${callerName} is inviting you to a live 1-on-1 session.`;
    
    if (el('accept-call-btn')) {
      el('accept-call-btn').onclick = async () => {
        hide('incoming-call-modal');
        await acceptDirectCall(callerId, callerName, offer);
      };
    }
    
    if (el('decline-call-btn')) {
      el('decline-call-btn').onclick = () => {
        hide('incoming-call-modal');
        state.socket.emit('decline_call', { to: callerId });
      };
    }
  });

  state.socket.on('call_declined', () => {
    toast('Call declined by peer.', 'warning');
    endCallLocal();
  });

  state.socket.on('call_accepted', async ({ answer }) => {
    toast('Call accepted! Connecting...', 'success');
    if (state.peerConnection) {
      try {
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        await drainIceQueue(state.peerConnection);
      } catch (e) {
        console.error('Failed to set remote description answer:', e);
      }
    }
  });

  state.socket.on('call_ended', () => {
    toast('Call ended by peer.', 'info');
    endCallLocal();
  });

  state.socket.on('call_cancelled', () => {
    hide('incoming-call-modal');
    toast('Call cancelled by caller.', 'info');
    endCallLocal();
  });

  // WebRTC Group Calling Signaling (Mesh Network)
  state.socket.on('incoming_group_call', ({ roomId, callerId, callerName, invitedUserIds }) => {
    triggerIncomingCallNotification(callerName, true);
    show('incoming-call-modal');
    if (el('incoming-call-title')) el('incoming-call-title').textContent = 'Incoming Group Call';
    if (el('incoming-call-msg')) el('incoming-call-msg').textContent = `${callerName} is inviting you to a Group Classroom.`;
    
    if (el('accept-call-btn')) {
      el('accept-call-btn').onclick = async () => {
        hide('incoming-call-modal');
        await joinGroupCall(roomId, callerName);
      };
    }
    
    if (el('decline-call-btn')) {
      el('decline-call-btn').onclick = () => {
        hide('incoming-call-modal');
        state.socket.emit('decline_group_call', { initiatorId: callerId });
      };
    }
  });

  state.socket.on('group_user_joined', async ({ userId, socketId, userName }) => {
    toast(`👋 ${userName} joined the class!`, 'success');
    const pc = createGroupPeerConnection(socketId, userId, userName, true);
    state.groupPeerConnections[socketId] = pc;
    
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      state.socket.emit('group_signal', { 
        toSocketId: socketId, 
        signalData: { 
          type: 'offer', 
          offer,
          senderName: state.currentUser?.fullname || state.currentUser?.username
        } 
      });
    } catch (e) {
      console.error('Failed to create offer for new peer:', e);
    }
  });

  state.socket.on('group_signal', async ({ fromSocketId, fromUserId, signalData }) => {
    if (signalData.type === 'offer') {
      const pc = createGroupPeerConnection(fromSocketId, fromUserId, signalData.senderName || 'Peer', false);
      state.groupPeerConnections[fromSocketId] = pc;
      
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(signalData.offer));
        await drainIceQueue(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        state.socket.emit('group_signal', { 
          toSocketId: fromSocketId, 
          signalData: { 
            type: 'answer', 
            answer,
            senderName: state.currentUser?.fullname || state.currentUser?.username
          } 
        });
      } catch (e) {
        console.error('Failed to handle group offer:', e);
      }
    } else if (signalData.type === 'answer') {
      const pc = state.groupPeerConnections[fromSocketId];
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(signalData.answer));
          await drainIceQueue(pc);
        } catch (e) {
          console.error('Failed to set remote description answer:', e);
        }
      }
    } else if (signalData.type === 'ice-candidate') {
      const pc = state.groupPeerConnections[fromSocketId];
      if (pc) {
        await addIceCandidateSafely(pc, signalData.candidate);
      } else {
        if (!state.groupIceQueues[fromSocketId]) state.groupIceQueues[fromSocketId] = [];
        state.groupIceQueues[fromSocketId].push(signalData.candidate);
      }
    }
  });

  state.socket.on('group_user_left', ({ socketId, userId }) => {
    if (state.groupPeerConnections[socketId]) {
      state.groupPeerConnections[socketId].close();
      delete state.groupPeerConnections[socketId];
    }
    el(`feed_${socketId}`)?.remove();
    updateVideoGridLayout();
  });

  state.socket.on('group_participants_update', (participants) => {
    state.groupParticipants = participants;
    updateGroupParticipantsList();
  });

  state.socket.on('receive_group_message', msg => {
    const logEl = el('chats-messages-log');
    const isGroupTabActive = (state.currentActiveChatId === `group_${msg.group_id}`);
    
    if (logEl && isGroupTabActive) {
      appendChatMessageToElement(logEl, msg.message, msg.sender_id === state.currentUser?.id ? 'outgoing' : 'incoming', msg.sender_name);
    } else {
      const preview = getMessagePreviewText(msg.message);
      toast(`👥 [${msg.sender_name} in Group]: ${preview.slice(0, 50)}${preview.length > 50 ? '...' : ''}`, 'info');
      if (document.hidden) {
        triggerNewMessageNotification(`Group message from ${msg.sender_name}`, preview);
      }
    }
  });
}
