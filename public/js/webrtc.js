/**
 * Antigravity Chatting - WebRTC Voice Call Manager
 * Native WebRTC implementation supporting 1-on-1 calls and group calls (up to 8 participants)
 */

class WebRTCManager {
  constructor() {
    this.localStream = null;
    this.peerConnections = new Map(); // targetKey -> RTCPeerConnection
    this.remoteAudios = new Map(); // targetKey -> HTMLAudioElement
    this.isMuted = false;
    this.currentCall = null; // { callId, type: 'DIRECT'|'GROUP', targetId, targetName, startTime, timerInterval }
    this.audioContext = null;
    this.ringtoneInterval = null;

    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    };
  }

  // =========================================================================
  // Web Audio Ringtone Generator (Zero external mp3 dependencies)
  // =========================================================================
  startRingtone() {
    this.stopRingtone();
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.audioContext = new AudioCtx();

      const playTone = () => {
        if (!this.audioContext) return;
        try {
          const osc1 = this.audioContext.createOscillator();
          const osc2 = this.audioContext.createOscillator();
          const gain = this.audioContext.createGain();

          osc1.type = 'sine';
          osc2.type = 'sine';
          osc1.frequency.setValueAtTime(440, this.audioContext.currentTime);
          osc2.frequency.setValueAtTime(480, this.audioContext.currentTime);

          gain.gain.setValueAtTime(0.12, this.audioContext.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 1.2);

          osc1.connect(gain);
          osc2.connect(gain);
          gain.connect(this.audioContext.destination);

          osc1.start();
          osc2.start();
          osc1.stop(this.audioContext.currentTime + 1.2);
          osc2.stop(this.audioContext.currentTime + 1.2);
        } catch (e) {}
      };

      playTone();
      this.ringtoneInterval = setInterval(playTone, 2500);
    } catch (e) {
      console.warn('Ringtone init error:', e);
    }
  }

  stopRingtone() {
    if (this.ringtoneInterval) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = null;
    }
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch (e) {}
      this.audioContext = null;
    }
  }

  // =========================================================================
  // Local Microphone Access
  // =========================================================================
  async getLocalMedia() {
    if (this.localStream) return this.localStream;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      return this.localStream;
    } catch (err) {
      console.error('Error accessing microphone:', err);
      throw new Error('Tidak dapat mengakses mikrofon. Mohon izinkan akses mikrofon di browser.');
    }
  }

  // =========================================================================
  // 1-on-1 Call Flow (FR-CALL-01, FR-CALL-03, FR-CALL-04, FR-CALL-05)
  // =========================================================================
  async startDirectCall(receiverId, receiverName) {
    await this.getLocalMedia();

    // Show active call dialog in "Calling..." state
    this.showActiveCallUI({
      type: 'DIRECT',
      title: receiverName,
      status: 'Memanggil...',
    });

    // Send initiate event to socket
    socketClient.socket.emit('call:initiate', {
      receiverId,
      callerName: state.currentUser?.biodata
        ? `${state.currentUser.biodata.first_name} ${state.currentUser.biodata.last_name}`
        : state.currentUser?.email,
    }, (response) => {
      if (response?.callId) {
        this.currentCall = {
          callId: response.callId,
          type: 'DIRECT',
          targetId: receiverId,
          targetName: receiverName,
          status: 'calling',
        };
      }
    });
  }

  async handleIncomingCall(data) {
    // Start ringtone
    this.startRingtone();

    // Store incoming call data
    this.incomingCallData = data;

    // Show incoming call modal
    const modal = document.getElementById('modal-incoming-call');
    const avatar = document.getElementById('incoming-call-avatar');
    const name = document.getElementById('incoming-call-name');
    const typeLabel = document.getElementById('incoming-call-type');

    if (avatar) avatar.textContent = (data.callerName || 'U').charAt(0).toUpperCase();
    if (name) name.textContent = data.callerName || 'Pengguna';
    if (typeLabel) typeLabel.textContent = data.callType === 'GROUP' ? 'Panggilan Suara Grup' : 'Panggilan Suara Pribadi';

    if (modal) modal.classList.remove('hidden');
  }

  async acceptIncomingCall() {
    this.stopRingtone();
    const data = this.incomingCallData;
    if (!data) return;

    const modal = document.getElementById('modal-incoming-call');
    if (modal) modal.classList.add('hidden');

    try {
      await this.getLocalMedia();

      this.currentCall = {
        callId: data.callId,
        type: 'DIRECT',
        targetId: data.callerId,
        targetName: data.callerName,
        status: 'connecting',
      };

      this.showActiveCallUI({
        type: 'DIRECT',
        title: data.callerName,
        status: 'Menghubungkan...',
      });

      // Emit accept
      socketClient.socket.emit('call:accept', {
        callId: data.callId,
        callerId: data.callerId,
      });

      // Setup Peer Connection
      const pc = this.createPeerConnection(data.callerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socketClient.socket.emit('call:signal', {
        targetUserId: data.callerId,
        signal: { type: 'offer', sdp: offer },
      });
    } catch (err) {
      showToast('Gagal Menjawab', err.message, 'error', '❌');
      this.rejectIncomingCall();
    }
  }

  rejectIncomingCall() {
    this.stopRingtone();
    const data = this.incomingCallData;
    if (data) {
      socketClient.socket.emit('call:reject', {
        callId: data.callId,
        callerId: data.callerId,
      });
    }
    const modal = document.getElementById('modal-incoming-call');
    if (modal) modal.classList.add('hidden');
    this.incomingCallData = null;
  }

  // =========================================================================
  // Peer Connection Helper
  // =========================================================================
  createPeerConnection(targetKey, isGroup = false) {
    if (this.peerConnections.has(targetKey)) {
      this.peerConnections.get(targetKey).close();
    }

    const pc = new RTCPeerConnection(this.rtcConfig);
    this.peerConnections.set(targetKey, pc);

    // Add local audio tracks
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        pc.addTrack(track, this.localStream);
      });
    }

    // ICE Candidate
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        if (isGroup) {
          socketClient.socket.emit('group_call:signal', {
            targetSocketId: targetKey,
            signal: { type: 'candidate', candidate: event.candidate },
          });
        } else {
          socketClient.socket.emit('call:signal', {
            targetUserId: targetKey,
            signal: { type: 'candidate', candidate: event.candidate },
          });
        }
      }
    };

    // Remote Audio Stream
    pc.ontrack = (event) => {
      let audio = this.remoteAudios.get(targetKey);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        this.remoteAudios.set(targetKey, audio);
      }
      audio.srcObject = event.streams[0];
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.startCallTimer();
        this.updateCallStatusUI('Terhubung');
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.endCall(false);
      }
    };

    return pc;
  }

  // =========================================================================
  // WebRTC Signal Dispatcher
  // =========================================================================
  async handleSignal(senderId, signal) {
    let pc = this.peerConnections.get(senderId);
    if (!pc) {
      pc = this.createPeerConnection(senderId);
    }

    if (signal.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socketClient.socket.emit('call:signal', {
        targetUserId: senderId,
        signal: { type: 'answer', sdp: answer },
      });
    } else if (signal.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    } else if (signal.type === 'candidate' && signal.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } catch (e) {
        console.warn('Error adding ICE candidate:', e);
      }
    }
  }

  // =========================================================================
  // Group Call Flow (FR-CALL-02: Max 8 participants)
  // =========================================================================
  async startGroupCall(groupId, groupName) {
    try {
      await this.getLocalMedia();

      this.currentCall = {
        type: 'GROUP',
        groupId,
        groupName,
        status: 'joining',
      };

      this.showActiveCallUI({
        type: 'GROUP',
        title: groupName,
        status: 'Bergabung ke panggilan grup...',
      });

      const myName = state.currentUser?.biodata
        ? `${state.currentUser.biodata.first_name} ${state.currentUser.biodata.last_name}`
        : state.currentUser?.email;

      socketClient.socket.emit('group_call:join', { groupId, userName: myName }, async (response) => {
        if (response?.error === 'GROUP_CALL_FULL') {
          showToast('Panggilan Penuh', 'Kapasitas panggilan grup penuh (maksimal 8 peserta).', 'error', '👥');
          this.endCall(false);
          return;
        }

        this.startCallTimer();
        this.updateCallStatusUI('Terhubung');
        this.updateParticipantCountUI(response?.participantsCount || 1);

        // Connect to existing participants
        if (response?.participants) {
          for (const p of response.participants) {
            const pc = this.createPeerConnection(p.socketId, true);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            socketClient.socket.emit('group_call:signal', {
              targetSocketId: p.socketId,
              signal: { type: 'offer', sdp: offer },
            });
          }
        }
      });
    } catch (err) {
      showToast('Gagal Panggilan Grup', err.message, 'error', '❌');
      this.endCall(false);
    }
  }

  async handleGroupSignal(senderSocketId, signal) {
    let pc = this.peerConnections.get(senderSocketId);
    if (!pc) {
      pc = this.createPeerConnection(senderSocketId, true);
    }

    if (signal.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socketClient.socket.emit('group_call:signal', {
        targetSocketId: senderSocketId,
        signal: { type: 'answer', sdp: answer },
      });
    } else if (signal.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    } else if (signal.type === 'candidate' && signal.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } catch (e) {}
    }
  }

  // =========================================================================
  // Call Controls: Mute & End Call (FR-CALL-04, FR-CALL-05)
  // =========================================================================
  toggleMute() {
    if (!this.localStream) return;
    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !this.isMuted;
    });

    const btnMute = document.getElementById('btn-call-mute');
    if (btnMute) {
      btnMute.innerHTML = this.isMuted ? '🔇 Buka Mic' : '🎙️ Matikan Mic';
      btnMute.className = `btn btn-sm ${this.isMuted ? 'btn-danger' : 'btn-outline'}`;
    }
  }

  endCall(emitEvent = true) {
    this.stopRingtone();

    let durationSeconds = 0;
    if (this.currentCall?.startTime) {
      durationSeconds = Math.floor((Date.now() - this.currentCall.startTime) / 1000);
    }

    if (emitEvent && this.currentCall) {
      if (this.currentCall.type === 'DIRECT') {
        socketClient.socket.emit('call:end', {
          callId: this.currentCall.callId,
          targetUserId: this.currentCall.targetId,
          duration: durationSeconds,
        });
      } else if (this.currentCall.type === 'GROUP') {
        socketClient.socket.emit('group_call:leave', {
          groupId: this.currentCall.groupId,
        });
      }
    }

    // Stop all local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    // Close all peer connections
    this.peerConnections.forEach((pc) => pc.close());
    this.peerConnections.clear();

    // Stop remote audios
    this.remoteAudios.forEach((audio) => {
      audio.srcObject = null;
      audio.remove();
    });
    this.remoteAudios.clear();

    // Clear timer
    if (this.currentCall?.timerInterval) {
      clearInterval(this.currentCall.timerInterval);
    }

    this.currentCall = null;
    this.isMuted = false;

    // Hide UI
    const callModal = document.getElementById('modal-active-call');
    if (callModal) callModal.classList.add('hidden');

    // Reload active chat to display call log entry
    if (typeof loadChatMessages === 'function' && state.activeChat) {
      loadChatMessages();
    }
  }

  // =========================================================================
  // UI Helpers
  // =========================================================================
  showActiveCallUI(info) {
    const modal = document.getElementById('modal-active-call');
    const title = document.getElementById('active-call-title');
    const status = document.getElementById('active-call-status');
    const duration = document.getElementById('active-call-duration');
    const participantsInfo = document.getElementById('active-call-participants');

    if (title) title.textContent = info.title || 'Panggilan Suara';
    if (status) status.textContent = info.status || 'Menghubungkan...';
    if (duration) duration.textContent = '00:00';
    if (participantsInfo) {
      participantsInfo.textContent = info.type === 'GROUP' ? '1/8 Peserta' : '';
    }

    const btnMute = document.getElementById('btn-call-mute');
    if (btnMute) {
      btnMute.innerHTML = '🎙️ Matikan Mic';
      btnMute.className = 'btn btn-outline btn-sm';
    }

    if (modal) modal.classList.remove('hidden');
  }

  startCallTimer() {
    if (!this.currentCall) return;
    this.currentCall.startTime = Date.now();
    const durationEl = document.getElementById('active-call-duration');

    if (this.currentCall.timerInterval) {
      clearInterval(this.currentCall.timerInterval);
    }

    this.currentCall.timerInterval = setInterval(() => {
      if (!this.currentCall?.startTime) return;
      const elapsed = Math.floor((Date.now() - this.currentCall.startTime) / 1000);
      const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
      const secs = (elapsed % 60).toString().padStart(2, '0');
      if (durationEl) durationEl.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  updateCallStatusUI(text) {
    const status = document.getElementById('active-call-status');
    if (status) status.textContent = text;
  }

  updateParticipantCountUI(count) {
    const el = document.getElementById('active-call-participants');
    if (el) el.textContent = `${count}/8 Peserta`;
  }
}

// Global instance
const webrtcManager = new WebRTCManager();
