// WebRTC client service: manages 1-on-1 and mesh group video calls, peer connections, media tracks, and quality stats.
import { state, ICE_SERVERS, el, show, hide, toast } from './state.js';
import { api } from './api.js';

export async function addIceCandidateSafely(pc, candidate) {
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

export async function drainIceQueue(pc) {
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

export async function openVideoCall(peerId, peerName, sessionId = null) {
  state.isGroupCall = false;
  state.activeCallPartnerId = peerId;
  state.activeChat.partnerId = peerId;
  state.activeChat.partnerName = peerName;
  if (el('classroom-peer-name')) el('classroom-peer-name').textContent = peerName;

  const overlay = el('call-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.classList.remove('minimized');
    overlay.classList.add('show-workspace');
    overlay.style.top = '';
    overlay.style.left = '';
    overlay.style.right = '';
    overlay.style.bottom = '';
    overlay.style.width = '';
    overlay.style.height = '';
  }
  el('call-toggle-workspace')?.classList.add('active');

  const remoteMock = el('remote-mock-stream');
  if (remoteMock) {
    const avatarUrl = state.activeChat.avatarUrl;
    if (avatarUrl) {
      remoteMock.innerHTML = `
        <img src="${avatarUrl}" style="width: 100px; height: 100px; border-radius: 50%; object-fit: cover; border: 3px solid var(--primary-light); box-shadow: 0 4px 15px rgba(0,0,0,0.5);">
        <p style="margin-top: 12px; font-weight: 600;">${peerName}</p>
        <p style="font-size: 0.8rem; color: var(--text-muted);">Waiting to connect...</p>
      `;
    } else {
      remoteMock.innerHTML = `
        <div class="feed-mock-icon"><i class="fa-solid fa-user-graduate"></i></div>
        <p>${peerName}</p>
        <p>Waiting to connect...</p>
      `;
    }
  }

  el('classroom-video-feeds')?.classList.remove('group-grid');
  el('classroom-participants-drawer')?.classList.add('hidden');
  
  const drawerActions = el('classroom-drawer-actions');
  if (drawerActions) drawerActions.style.display = 'none';

  startCallTimer();

  if (sessionId) {
    try { await api('PUT', `/api/sessions/${sessionId}/status`, { status: 'active' }); } catch {}
  }

  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (el('local-video')) el('local-video').srcObject = state.localStream;
    hide('local-mock-stream');
  } catch (e) {
    show('local-mock-stream');
    toast('Camera/mic unavailable — running in screen-share/text mode.', 'warning');
  }

  initPeerConnection(peerId);

  try {
    const offer = await state.peerConnection.createOffer();
    await state.peerConnection.setLocalDescription(offer);
    
    if (state.socket) {
      state.socket.emit('call_user', {
        to: peerId,
        offer: offer,
        senderName: state.currentUser.fullname || state.currentUser.username
      });
    }
  } catch (e) {
    console.error("Failed to create offer:", e);
  }

  toast(`📞 Classroom call placed to ${peerName}!`, 'info');
}

export async function acceptDirectCall(callerId, callerName, offer) {
  state.isGroupCall = false;
  state.activeCallPartnerId = callerId;
  state.activeChat.partnerId = callerId;
  state.activeChat.partnerName = callerName;
  if (el('classroom-peer-name')) el('classroom-peer-name').textContent = callerName;
  const overlay = el('call-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.classList.remove('minimized');
    overlay.classList.add('show-workspace');
  }
  el('call-toggle-workspace')?.classList.add('active');
  el('classroom-video-feeds')?.classList.remove('group-grid');
  el('classroom-participants-drawer')?.classList.add('hidden');
  
  const drawerActions = el('classroom-drawer-actions');
  if (drawerActions) drawerActions.style.display = 'none';
  
  startCallTimer();
  
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (el('local-video')) el('local-video').srcObject = state.localStream;
    hide('local-mock-stream');
  } catch (e) {
    show('local-mock-stream');
    toast('Camera/mic unavailable.', 'warning');
  }
  
  initPeerConnection(callerId);
  
  try {
    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    await drainIceQueue(state.peerConnection);
    const answer = await state.peerConnection.createAnswer();
    await state.peerConnection.setLocalDescription(answer);
    
    if (state.socket) {
      state.socket.emit('accept_call', { to: callerId, answer: answer });
    }
  } catch (e) {
    console.error("Failed to accept call:", e);
  }
}

export function initPeerConnection(peerId) {
  state.peerConnection = new RTCPeerConnection(ICE_SERVERS);
  state.peerConnection.remoteDescriptionSet = false;
  state.peerConnection.iceQueue = [...state.globalIceQueue];
  state.globalIceQueue = [];

  if (state.localStream) {
    state.localStream.getTracks().forEach(t => state.peerConnection.addTrack(t, state.localStream));
  }

  state.peerConnection.ontrack = e => {
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
      remoteVideo.play().catch(err => console.log('Autoplay play error:', err));
    }
  };

  state.peerConnection.onicecandidate = e => {
    if (e.candidate && state.socket) {
      console.log("Sending ICE candidate to peer:", e.candidate.candidate);
      const candData = e.candidate.toJSON ? e.candidate.toJSON() : e.candidate;
      state.socket.emit('webrtc_ice', { candidate: candData, to: peerId });
    }
  };

  state.peerConnection.oniceconnectionstatechange = () => {
    console.log("ICE Connection State:", state.peerConnection.iceConnectionState);
  };

  state.peerConnection.onconnectionstatechange = async () => {
    console.log("Connection State Changed:", state.peerConnection.connectionState);
    if (state.peerConnection.connectionState === 'connected') {
      toast('🔗 Peer connected!', 'success');
    } else if (state.peerConnection.connectionState === 'failed') {
      toast('❌ Connection failed. Attempting ICE recovery...', 'warning');
      if (!state.peerConnection.hasRestartedIce) {
        state.peerConnection.hasRestartedIce = true;
        console.log("Attempting 1:1 ICE restart via silent renegotiation...");
        try {
          const offer = await state.peerConnection.createOffer({ iceRestart: true });
          await state.peerConnection.setLocalDescription(offer);
          if (state.socket) state.socket.emit('webrtc_offer', { offer, to: peerId });
        } catch (err) {
          console.error("1:1 ICE Restart offer creation failed:", err);
        }
      } else {
        toast('❌ Connection recovery failed. Please check network settings.', 'error');
      }
    }
  };
}

export function toggleTrack(type) {
  if (!state.localStream) return;
  const tracks = type === 'audio' ? state.localStream.getAudioTracks() : state.localStream.getVideoTracks();
  const btn = el(`call-toggle-${type}`);
  tracks.forEach(t => { t.enabled = !t.enabled; });
  const isEnabled = tracks[0]?.enabled;
  if (btn) btn.classList.toggle('active', isEnabled);
  if (type === 'video') {
    const mock = el('local-mock-stream');
    if (mock) mock.style.display = isEnabled ? 'none' : 'flex';
  }
}

export async function shareScreen() {
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];
    if (state.peerConnection) {
      const sender = state.peerConnection.getSenders().find(s => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(screenTrack);
    }
    if (el('local-video')) el('local-video').srcObject = screenStream;
    el('call-toggle-screen')?.classList.add('active');
    screenTrack.onended = () => {
      el('call-toggle-screen')?.classList.remove('active');
      if (state.localStream) {
        if (el('local-video')) el('local-video').srcObject = state.localStream;
        const videoTrack = state.localStream.getVideoTracks()[0];
        const sender = state.peerConnection?.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack);
      }
    };
    toast('Screen sharing started', 'info');
  } catch {
    toast('Screen share cancelled or not supported.', 'warning');
  }
}

export function startCallTimer() {
  state.callSeconds = 0;
  clearInterval(state.callTimer);
  state.callTimer = setInterval(() => {
    state.callSeconds++;
    const m = String(Math.floor(state.callSeconds / 60)).padStart(2, '0');
    const s = String(state.callSeconds % 60).padStart(2, '0');
    if (el('call-timer')) el('call-timer').textContent = `${m}:${s}`;
  }, 1000);

  clearInterval(state.networkStatsInterval);
  state.networkStatsInterval = setInterval(async () => {
    if (state.isGroupCall && Object.keys(state.groupPeerConnections).length > 0) {
      for (const [peerSocketId, pc] of Object.entries(state.groupPeerConnections)) {
        if (pc.connectionState !== 'connected') continue;
        try {
          const stats = await pc.getStats();
          let rtt = 80;
          stats.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              rtt = (report.currentRoundTripTime || 0.08) * 1000;
            }
          });
          const qEl = el(`quality_${peerSocketId}`);
          if (qEl) {
            if (rtt < 100) {
              qEl.innerHTML = '<i class="fa-solid fa-signal" style="color: #10b981;"></i>';
              qEl.title = `Excellent RTT: ${Math.round(rtt)}ms`;
            } else if (rtt < 250) {
              qEl.innerHTML = '<i class="fa-solid fa-signal" style="color: #eab308;"></i>';
              qEl.title = `Fair RTT: ${Math.round(rtt)}ms`;
            } else {
              qEl.innerHTML = '<i class="fa-solid fa-signal" style="color: #f43f5e;"></i>';
              qEl.title = `Poor RTT: ${Math.round(rtt)}ms`;
            }
          }
        } catch {}
      }
    } else if (!state.isGroupCall && state.peerConnection && state.peerConnection.connectionState === 'connected') {
      try {
        const stats = await state.peerConnection.getStats();
        let rtt = 80;
        stats.forEach(report => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            rtt = (report.currentRoundTripTime || 0.08) * 1000;
          }
        });
        const qEl = el('call-quality-indicator') || el('classroom-peer-name');
        if (qEl) {
          let signalColor = '#10b981';
          let labelText = 'Good Connection';
          if (rtt >= 250) {
            signalColor = '#f43f5e';
            labelText = 'Poor Connection';
          } else if (rtt >= 100) {
            signalColor = '#eab308';
            labelText = 'Fair Connection';
          }
          let statusIndicator = el('11-call-quality');
          if (!statusIndicator) {
            statusIndicator = document.createElement('span');
            statusIndicator.id = '11-call-quality';
            statusIndicator.style.marginLeft = '8px';
            qEl.appendChild(statusIndicator);
          }
          statusIndicator.innerHTML = `<i class="fa-solid fa-signal" style="color: ${signalColor}; font-size: 0.8rem;" title="${labelText}: ${Math.round(rtt)}ms"></i>`;
        }
      } catch {}
    }
  }, 3000);

  setTimeout(() => {
    const localFeed = document.querySelector('.local-feed');
    if (localFeed) {
      localFeed.classList.add('draggable-pip');
      makeDraggable(localFeed);
    }
  }, 100);
}

export async function endCall() {
  if (state.isGroupCall) {
    if (state.socket) state.socket.emit('leave_group_room', { roomId: state.groupRoomId });
    for (const id in state.groupPeerConnections) {
      state.groupPeerConnections[id].close();
    }
    state.groupPeerConnections = {};
  } else {
    if (state.activeCallPartnerId && state.socket) {
      state.socket.emit('hang_up', {
        to: state.activeCallPartnerId,
        callerId: state.currentUser.id,
        receiverId: state.activeCallPartnerId
      });
    }
  }
  
  endCallLocal();
  toast('Session ended.', 'success');
}

export function endCallLocal() {
  clearInterval(state.callTimer);
  clearInterval(state.networkStatsInterval);
  if (state.localStream) { 
    state.localStream.getTracks().forEach(t => t.stop()); 
    state.localStream = null; 
  }
  if (state.peerConnection) { 
    state.peerConnection.close(); 
    state.peerConnection = null; 
  }
  
  for (const id in state.groupPeerConnections) {
    state.groupPeerConnections[id].close();
  }
  state.groupPeerConnections = {};
  
  state.globalIceQueue = [];
  state.groupIceQueues = {};
  state.classroomGroupMembers = [];
  
  const videoGrid = el('classroom-video-feeds');
  if (videoGrid) {
    videoGrid.classList.remove('has-pinned-feed', 'group-grid');
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
  }
  
  const overlay = el('call-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.classList.remove('minimized');
    overlay.classList.remove('show-workspace');
  }
  if (el('call-timer')) el('call-timer').textContent = '00:00';
  state.isGroupCall = false;
  state.groupRoomId = null;
  state.activeCallPartnerId = null;
}

export async function startGroupCall(invitedUsers) {
  state.isGroupCall = true;
  state.groupRoomId = 'group_' + Date.now();
  if (el('classroom-peer-name')) el('classroom-peer-name').textContent = 'Group Class';

  const overlay = el('call-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.classList.remove('minimized');
    overlay.classList.add('show-workspace');
    overlay.style.top = '';
    overlay.style.left = '';
    overlay.style.right = '';
    overlay.style.bottom = '';
    overlay.style.width = '';
    overlay.style.height = '';
  }
  el('call-toggle-workspace')?.classList.add('active');
  el('classroom-participants-drawer')?.classList.remove('hidden');
  
  const drawerActions = el('classroom-drawer-actions');
  if (drawerActions) drawerActions.style.display = 'block';
  
  const videoGrid = el('classroom-video-feeds');
  if (videoGrid) {
    videoGrid.innerHTML = ''; 
    videoGrid.classList.add('group-grid');
    
    const localWrapper = document.createElement('div');
    localWrapper.className = 'video-feed local-feed';
    localWrapper.id = 'feed_local';
    localWrapper.innerHTML = `
      <video id="local-video" autoplay playsinline muted></video>
      <div class="feed-mock" id="local-mock-stream" style="display: none;">
        <div class="feed-mock-icon"><i class="fa-solid fa-video-slash"></i></div>
        <p>Camera Off</p>
      </div>
      <div class="feed-label">You (Host)</div>
      <div class="video-hover-controls">
        <button class="pin-btn" title="Pin / Maximize"><i class="fa-solid fa-thumbtack"></i></button>
      </div>
    `;
    videoGrid.appendChild(localWrapper);
    
    const localPinBtn = localWrapper.querySelector('.pin-btn');
    if (localPinBtn) {
      localPinBtn.onclick = () => togglePinFeed('feed_local');
    }
  }

  startCallTimer();
  
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (el('local-video')) el('local-video').srcObject = state.localStream;
    if (el('local-mock-stream')) el('local-mock-stream').style.display = 'none';
  } catch (e) {
    if (el('local-mock-stream')) el('local-mock-stream').style.display = 'flex';
    toast('Camera/mic unavailable.', 'warning');
  }

  if (state.socket) {
    state.socket.emit('group_call_invite', {
      roomId: state.groupRoomId,
      invitedUsers,
      senderName: state.currentUser.fullname || state.currentUser.username
    });
    
    state.socket.emit('join_group_room', {
      roomId: state.groupRoomId,
      userName: state.currentUser.fullname || state.currentUser.username
    });
  }

  state.groupParticipants = [
    { userId: state.currentUser.id, userName: state.currentUser.fullname || state.currentUser.username, status: 'host' }
  ];
  invitedUsers.forEach(u => {
    state.groupParticipants.push({ userId: u.id, userName: u.name, status: 'invited' });
  });
  
  loadClassroomCandidates();
  toast('Group call started!', 'success');
}

export async function joinGroupCall(roomId, initiatorName) {
  state.isGroupCall = true;
  state.groupRoomId = roomId;
  if (el('classroom-peer-name')) el('classroom-peer-name').textContent = 'Group Class';

  const overlay = el('call-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.classList.remove('minimized');
    overlay.classList.add('show-workspace');
    overlay.style.top = '';
    overlay.style.left = '';
    overlay.style.right = '';
    overlay.style.bottom = '';
    overlay.style.width = '';
    overlay.style.height = '';
  }
  el('call-toggle-workspace')?.classList.add('active');
  el('classroom-participants-drawer')?.classList.remove('hidden');
  
  const drawerActions = el('classroom-drawer-actions');
  if (drawerActions) drawerActions.style.display = 'block';
  
  const videoGrid = el('classroom-video-feeds');
  if (videoGrid) {
    videoGrid.innerHTML = ''; 
    videoGrid.classList.add('group-grid');
    
    const localWrapper = document.createElement('div');
    localWrapper.className = 'video-feed local-feed';
    localWrapper.id = 'feed_local';
    localWrapper.innerHTML = `
      <video id="local-video" autoplay playsinline muted></video>
      <div class="feed-mock" id="local-mock-stream" style="display: none;">
        <div class="feed-mock-icon"><i class="fa-solid fa-video-slash"></i></div>
        <p>Camera Off</p>
      </div>
      <div class="feed-label">You</div>
      <div class="video-hover-controls">
        <button class="pin-btn" title="Pin / Maximize"><i class="fa-solid fa-thumbtack"></i></button>
      </div>
    `;
    videoGrid.appendChild(localWrapper);
    
    const localPinBtn = localWrapper.querySelector('.pin-btn');
    if (localPinBtn) {
      localPinBtn.onclick = () => togglePinFeed('feed_local');
    }
  }

  startCallTimer();
  
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (el('local-video')) el('local-video').srcObject = state.localStream;
    if (el('local-mock-stream')) el('local-mock-stream').style.display = 'none';
  } catch (e) {
    if (el('local-mock-stream')) el('local-mock-stream').style.display = 'flex';
    toast('Camera/mic unavailable.', 'warning');
  }

  if (state.socket) {
    state.socket.emit('join_group_room', {
      roomId,
      userName: state.currentUser.fullname || state.currentUser.username
    });
  }
  
  state.groupParticipants = [
    { userId: state.currentUser.id, userName: state.currentUser.fullname || state.currentUser.username, status: 'connected' }
  ];
  loadClassroomCandidates();
}

export function createPeerFeedContainer(peerSocketId, peerUserName) {
  const videoGrid = el('classroom-video-feeds');
  if (!videoGrid) return;
  
  let peerFeed = el(`feed_${peerSocketId}`);
  if (!peerFeed) {
    peerFeed = document.createElement('div');
    peerFeed.className = 'video-feed';
    peerFeed.id = `feed_${peerSocketId}`;
    peerFeed.innerHTML = `
      <video id="video_${peerSocketId}" autoplay playsinline style="display: none; width: 100%; height: 100%; object-fit: cover;"></video>
      <div class="feed-mock" id="mock_${peerSocketId}">
        <div class="feed-mock-icon"><i class="fa-solid fa-user-graduate"></i></div>
        <p>Connecting...</p>
      </div>
      <div class="feed-label" id="label_${peerSocketId}" style="display: flex; align-items: center; gap: 6px;">
        <i class="fa-solid fa-circle live-dot"></i> 
        <span>${peerUserName}</span>
        <span class="quality-indicator" id="quality_${peerSocketId}" style="margin-left: 6px; display: inline-flex;" title="Network Quality: Good"><i class="fa-solid fa-signal" style="color: #10b981;"></i></span>
      </div>
      <div class="video-hover-controls">
        <button class="pin-btn" title="Pin / Maximize"><i class="fa-solid fa-thumbtack"></i></button>
      </div>
    `;
    videoGrid.appendChild(peerFeed);
    
    const pinBtn = peerFeed.querySelector('.pin-btn');
    if (pinBtn) {
      pinBtn.onclick = () => togglePinFeed(`feed_${peerSocketId}`);
    }
  }
}

export function createGroupPeerConnection(peerSocketId, peerUserId, peerUserName, isInitiator) {
  const pc = new RTCPeerConnection(ICE_SERVERS);
  pc.remoteDescriptionSet = false;
  pc.iceQueue = state.groupIceQueues[peerSocketId] || [];
  delete state.groupIceQueues[peerSocketId];
  
  if (state.localStream) {
    state.localStream.getTracks().forEach(track => pc.addTrack(track, state.localStream));
  }
  
  createPeerFeedContainer(peerSocketId, peerUserName);
  
  pc.ontrack = e => {
    console.log("Group OnTrack event received from peer:", peerUserName, e);
    renderRemoteGroupStream(peerSocketId, peerUserId, peerUserName, e);
  };
  
  pc.onicecandidate = e => {
    if (e.candidate && state.socket) {
      const candData = e.candidate.toJSON ? e.candidate.toJSON() : e.candidate;
      state.socket.emit('group_signal', {
        toSocketId: peerSocketId,
        signalData: { type: 'ice-candidate', candidate: candData }
      });
    }
  };

  pc.onconnectionstatechange = async () => {
    if (pc.connectionState === 'connected') {
      const idx = state.groupParticipants.findIndex(p => p.userId === peerUserId);
      if (idx !== -1) {
        state.groupParticipants[idx].status = 'connected';
        updateGroupParticipantsList();
      }
    } else if (pc.connectionState === 'failed') {
      if (!pc.hasRestartedIce) {
        pc.hasRestartedIce = true;
        try {
          const offer = await pc.createOffer({ iceRestart: true });
          await pc.setLocalDescription(offer);
          if (state.socket) {
            state.socket.emit('group_signal', {
              toSocketId: peerSocketId,
              signalData: offer
            });
          }
        } catch (err) {
          console.error(`Group ICE Restart failed for ${peerUserName}:`, err);
        }
      }
    }
  };

  return pc;
}

export function renderRemoteGroupStream(peerSocketId, peerUserId, peerUserName, e) {
  createPeerFeedContainer(peerSocketId, peerUserName);
  
  const videoEl = el(`video_${peerSocketId}`);
  const mockEl = el(`mock_${peerSocketId}`);
  
  if (videoEl) {
    if (e.streams && e.streams[0]) {
      videoEl.srcObject = e.streams[0];
    } else {
      if (!videoEl.srcObject) {
        videoEl.srcObject = new MediaStream();
      }
      videoEl.srcObject.addTrack(e.track);
    }
    
    videoEl.style.display = 'block';
    if (mockEl) mockEl.style.display = 'none';
    videoEl.play().catch(err => console.log('Autoplay play error for group peer:', err));
    
    if (videoEl.srcObject) {
      startSpeakerHighlighting(videoEl.srcObject, el(`feed_${peerSocketId}`));
    }
    updateVideoGridLayout();
  }
  
  const pIdx = state.groupParticipants.findIndex(p => p.userId === peerUserId);
  if (pIdx !== -1) {
    state.groupParticipants[pIdx].status = 'connected';
  } else {
    state.groupParticipants.push({ userId: peerUserId, userName: peerUserName, status: 'connected' });
  }
  updateGroupParticipantsList();
}

export function invitePeerToClassroom(userId, userName) {
  if (state.socket) {
    state.socket.emit('group_call_invite', {
      roomId: state.groupRoomId,
      invitedUsers: [{ id: userId, name: userName }],
      senderName: state.currentUser.fullname || state.currentUser.username
    });
  }
  
  if (!state.groupParticipants.some(p => p.userId === userId)) {
    state.groupParticipants.push({ userId, userName, status: 'invited' });
  }
  updateGroupParticipantsList();
  toast(`Invitation sent to ${userName}!`, 'success');
}

export async function loadClassroomCandidates() {
  if (state.classroomGroupMembers && state.classroomGroupMembers.length > 0) {
    updateGroupParticipantsList();
    return;
  }
  try {
    const data = await api('GET', '/api/users/explore');
    state.classroomGroupMembers = (data.users || [])
      .filter(u => u.id !== state.currentUser.id)
      .map(u => ({ id: u.id, name: u.fullname || u.username }));
    updateGroupParticipantsList();
  } catch (err) {
    console.error('Failed to load classroom candidates:', err);
  }
}

export function updateGroupParticipantsList() {
  const list = el('classroom-participants-list');
  if (!list) return;
  
  list.innerHTML = '';
  
  const hosts   = state.groupParticipants.filter(p => p.status === 'host');
  const active  = state.groupParticipants.filter(p => p.status === 'connected');
  const pending = state.groupParticipants.filter(p => p.status === 'invited');
  const isHost  = state.groupParticipants.some(p => p.status === 'host' && p.userId === state.currentUser.id);

  const makeItem = (p, label, badgeClass) => {
    const avatarHtml = p.avatarUrl
      ? `<img src="${p.avatarUrl}" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover; flex-shrink: 0;">`
      : `<div style="width: 28px; height: 28px; border-radius: 50%; background: linear-gradient(135deg, var(--primary), var(--accent)); display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: #fff; flex-shrink: 0;"><i class="fa-solid fa-user"></i></div>`;

    const li = document.createElement('li');
    li.className = 'participant-item';
    li.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,0.02); margin-bottom: 4px;';
    
    let actionBtnHtml = '';
    if (isHost && p.userId !== state.currentUser.id) {
      if (p.status === 'connected') {
        actionBtnHtml = `<button class="kick-peer-btn" title="Kick participant" style="background: transparent; border: none; color: #f43f5e; cursor: pointer; font-size: 0.8rem; padding: 2px 6px; display: inline-flex; align-items: center;"><i class="fa-solid fa-user-xmark"></i></button>`;
      } else if (p.status === 'invited') {
        actionBtnHtml = `<button class="reinvite-peer-btn" title="Re-invite participant" style="background: transparent; border: none; color: var(--accent); cursor: pointer; font-size: 0.8rem; padding: 2px 6px; display: inline-flex; align-items: center;"><i class="fa-solid fa-arrow-rotate-right"></i></button>`;
      }
    }

    li.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
        ${avatarHtml}
        <span class="participant-name" style="font-size: 0.85rem; font-weight: 500; color: #f1f5f9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.userName}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
        <span class="participant-badge ${badgeClass}" style="font-size: 0.7rem; padding: 2px 6px; border-radius: 4px;">${label}</span>
        ${actionBtnHtml}
      </div>
    `;

    const kickBtn = li.querySelector('.kick-peer-btn');
    if (kickBtn) {
      kickBtn.onclick = () => {
        if (confirm(`Remove ${p.userName} from the call?`)) {
          if (state.socket) state.socket.emit('kick_participant', { roomId: state.groupRoomId, userId: p.userId });
        }
      };
    }

    const reinviteBtn = li.querySelector('.reinvite-peer-btn');
    if (reinviteBtn) {
      reinviteBtn.onclick = () => {
        invitePeerToClassroom(p.userId, p.userName);
      };
    }

    return li;
  };

  if (hosts.length || active.length) {
    const secLabel = document.createElement('div');
    secLabel.className = 'participants-section-label';
    secLabel.style.cssText = 'display: flex; align-items: center; width: 100%; margin: 8px 0 4px; font-size: 0.75rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;';
    secLabel.textContent = `In Call (${hosts.length + active.length})`;
    list.appendChild(secLabel);
    hosts.forEach(p => list.appendChild(makeItem(p, 'Host', 'badge-host')));
    active.forEach(p => list.appendChild(makeItem(p, 'Connected', 'badge-connected')));
  }

  if (pending.length) {
    const secLabel = document.createElement('div');
    secLabel.className = 'participants-section-label';
    secLabel.style.cssText = 'display: flex; align-items: center; width: 100%; margin: 12px 0 4px; font-size: 0.75rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;';
    secLabel.textContent = `Invited (${pending.length})`;
    list.appendChild(secLabel);
    pending.forEach(p => list.appendChild(makeItem(p, 'Ringing...', 'badge-invited')));
  }
}

export function togglePinFeed(feedId) {
  const grid = el('classroom-video-feeds');
  if (!grid) return;
  const feed = el(feedId);
  if (!feed) return;
  
  const isAlreadyPinned = feed.classList.contains('pinned-active');
  
  document.querySelectorAll('.video-feed').forEach(f => {
    f.classList.remove('pinned-active');
    const btn = f.querySelector('.pin-btn');
    if (btn) {
      btn.innerHTML = '<i class="fa-solid fa-thumbtack"></i>';
      btn.title = 'Pin / Maximize';
    }
  });
  grid.classList.remove('has-pinned-feed');
  
  if (!isAlreadyPinned) {
    feed.classList.add('pinned-active');
    grid.classList.add('has-pinned-feed');
    const btn = feed.querySelector('.pin-btn');
    if (btn) {
      btn.innerHTML = '<i class="fa-solid fa-compress" style="color: #3b82f6;"></i>';
      btn.title = 'Unpin / Restore Grid';
    }
    toast('Video feed pinned to main screen', 'info');
  } else {
    toast('Video feed unpinned', 'info');
  }
  updateVideoGridLayout();
}

export function updateVideoGridLayout() {
  const grid = el('classroom-video-feeds');
  if (!grid) return;
  
  if (grid.classList.contains('has-pinned-feed')) {
    const feeds = Array.from(grid.querySelectorAll('.video-feed'));
    feeds.forEach(f => {
      f.style.width = '';
      f.style.height = '';
      f.style.aspectRatio = '';
    });
    grid.style.display = '';
    grid.style.gridTemplateColumns = '';
    grid.style.gridAutoRows = '';
    return;
  }
  
  const feeds = Array.from(grid.querySelectorAll('.video-feed'));
  const count = feeds.length;
  grid.style.display = '';
  grid.style.gridTemplateColumns = '';
  grid.style.gridAutoRows = '';
  
  if (count <= 1) {
    grid.style.display = 'block';
    feeds.forEach(f => {
      f.style.width = '100%';
      f.style.height = '100%';
      f.style.aspectRatio = '';
    });
  } else if (count === 2) {
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = '1fr 1fr';
    feeds.forEach(f => {
      f.style.width = '100%';
      f.style.height = '100%';
      f.style.aspectRatio = '';
    });
  } else if (count <= 4) {
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = '1fr 1fr';
    grid.style.gridAutoRows = '1fr';
    feeds.forEach(f => {
      f.style.width = '100%';
      f.style.height = '100%';
      f.style.aspectRatio = '';
    });
  } else {
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(120px, 1fr))';
    grid.style.gridAutoRows = 'min-content';
    feeds.forEach(f => {
      f.style.width = '100%';
      f.style.height = 'auto';
      f.style.aspectRatio = '16/9';
    });
  }
}

export function startSpeakerHighlighting(stream, feedElement) {
  if (!window.AudioContext && !window.webkitAudioContext) return;
  try {
    if (!state.audioContext) {
      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.audioContext.state === 'suspended') {
      const resume = () => {
        state.audioContext.resume();
        document.removeEventListener('click', resume);
      };
      document.addEventListener('click', resume);
    }
    const source = state.audioContext.createMediaStreamSource(stream);
    const analyser = state.audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let silenceCounter = 0;

    const checkVolume = () => {
      if (!feedElement || !feedElement.parentNode) return;
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      if (average > 15) {
        feedElement.classList.add('active-speaker-feed');
        silenceCounter = 0;
      } else {
        silenceCounter++;
        if (silenceCounter > 15) {
          feedElement.classList.remove('active-speaker-feed');
        }
      }
      requestAnimationFrame(checkVolume);
    };
    requestAnimationFrame(checkVolume);
  } catch (err) {
    console.error('Audio analysis failed:', err);
  }
}

export function makeDraggable(element) {
  if (!element) return;
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  
  element.onmousedown = dragMouseDown;
  element.addEventListener('touchstart', dragTouchStart, { passive: false });

  function dragMouseDown(e) {
    if (element.id === 'call-overlay' && !element.classList.contains('minimized')) return;
    const rect = element.getBoundingClientRect();
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
    element.style.top = (element.offsetTop - pos2) + "px";
    element.style.left = (element.offsetLeft - pos1) + "px";
    element.style.bottom = 'auto';
    element.style.right = 'auto';
  }

  function closeDragElement() {
    document.onmouseup = null;
    document.onmousemove = null;
  }

  function dragTouchStart(e) {
    if (element.id === 'call-overlay' && !element.classList.contains('minimized')) return;
    const rect = element.getBoundingClientRect();
    const touch = e.touches[0];
    if (touch.clientX > rect.right - 25 && touch.clientY > rect.bottom - 25) return;
    
    e.preventDefault();
    pos3 = touch.clientX;
    pos4 = touch.clientY;
    
    document.addEventListener('touchmove', elementTouchDrag, { passive: false });
    document.addEventListener('touchend', closeDragTouch);
  }

  function elementTouchDrag(e) {
    e.preventDefault();
    const touch = e.touches[0];
    pos1 = pos3 - touch.clientX;
    pos2 = pos4 - touch.clientY;
    pos3 = touch.clientX;
    pos4 = touch.clientY;
    element.style.top = (element.offsetTop - pos2) + "px";
    element.style.left = (element.offsetLeft - pos1) + "px";
    element.style.bottom = 'auto';
    element.style.right = 'auto';
  }

  function closeDragTouch() {
    document.removeEventListener('touchmove', elementTouchDrag);
    document.removeEventListener('touchend', closeDragTouch);
  }
}
