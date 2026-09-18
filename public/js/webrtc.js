/**
 * ChatSphere - Native WebRTC Voice & Video Call Manager (FR-CALL-01..05, FR-VC-01..04)
 * Supports:
 * - 1-on-1 Voice and HD Video Calls
 * - Group Voice and Video Calls (up to 8 participants - BR-VC-01)
 * - Media Controls (Mic Mute/Unmute, Camera On/Off)
 * - Screen Sharing (FR-VC-03)
 * - 30-Second Ring Timeout (BR-CALL-01, BR-VC-02)
 */

class WebRTCManager {
  constructor() {
    this.localStream = null;
    this.screenStream = null;
    this.peerConnections = new Map(); // targetKey -> RTCPeerConnection
    this.remoteAudios = new Map(); // targetKey -> HTMLAudioElement
    this.isMuted = false;
    this.isCameraOff = false;
    this.isScreenSharing = false;
    this.mediaType = 'AUDIO'; // 'AUDIO' | 'VIDEO'
    this.currentCall = null; // { callId, type: 'DIRECT'|'GROUP', targetId, targetName, startTime, timerInterval, mediaType }
    this.incomingCallData = null;
    this.audioContext = null;
    this.ringtoneInterval = null;

    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
      ],
      iceCandidatePoolSize: 10,
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
  // Synthetic Media Fallback (for devices without mic/camera or test environments)
  // =========================================================================
  createSyntheticMediaStream(withVideo = false) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const dst = ctx.createMediaStreamDestination();
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      osc.connect(gain);
      gain.connect(dst);
      osc.start();

      const combinedStream = dst.stream;

      if (withVideo) {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const cCtx = canvas.getContext('2d');

        let angle = 0;
        const drawPlaceholder = () => {
          cCtx.fillStyle = '#0f172a';
          cCtx.fillRect(0, 0, canvas.width, canvas.height);

          cCtx.save();
          cCtx.translate(canvas.width / 2, canvas.height / 2);
          cCtx.beginPath();
          cCtx.arc(0, 0, 70 + Math.sin(angle) * 8, 0, Math.PI * 2);
          cCtx.fillStyle = '#6366f1';
          cCtx.fill();

          cCtx.fillStyle = '#ffffff';
          cCtx.font = 'bold 28px sans-serif';
          cCtx.textAlign = 'center';
          cCtx.textBaseline = 'middle';
          cCtx.fillText('📹 Video Live', 0, 0);
          cCtx.restore();

          angle += 0.05;
        };

        setInterval(drawPlaceholder, 100);
        const canvasStream = canvas.captureStream ? canvas.captureStream(15) : null;
        if (canvasStream && canvasStream.getVideoTracks().length > 0) {
          combinedStream.addTrack(canvasStream.getVideoTracks()[0]);
        }
      }

      return combinedStream;
    } catch (e) {
      console.warn('Failed to create synthetic media stream:', e);
      return null;
    }
  }

  // =========================================================================
  // Local Media Access (Audio & Video) - Multi-Tier Mobile Fallback
  // =========================================================================
  async getLocalMedia(withVideo = false) {
    if (this.localStream) {
      const hasVideoTrack = this.localStream.getVideoTracks().length > 0;
      if (!withVideo || hasVideoTrack) {
        return this.localStream;
      }
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('navigator.mediaDevices tidak tersedia. Pastikan website dibuka via HTTPS.');
      }

      if (withVideo) {
        // Tier 1: Try HD front-facing camera
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: 'user',
            },
          });
        } catch (hdErr) {
          console.warn('HD camera constraint failed, falling back to basic camera:', hdErr);
          // Tier 2: Try basic camera without strict resolution (crucial for mobile phones)
          try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
              audio: true,
              video: true,
            });
          } catch (basicVideoErr) {
            console.warn('Basic camera failed, falling back to audio-only:', basicVideoErr);
            showToast('Kamera Tidak Dapat Dibuka', 'Melanjutkan dengan panggilan suara saja.', 'warning', '🎙️');
            this.mediaType = 'AUDIO';
            this.localStream = await navigator.mediaDevices.getUserMedia({
              audio: true,
              video: false,
            });
          }
        }
      } else {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
      }

      return this.localStream;
    } catch (err) {
      console.warn('Physical media access unavailable:', err);

      // Mobile user guidance based on exact error
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        showToast(
          'Izin Kamera/Mic Diblokir',
          'Akses kamera diblokir oleh setelan browser HP. Ketuk ikon gembok di address bar dan ubah ke "Izinkan".',
          'error',
          '🚫',
        );
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        showToast(
          'Kamera Sedang Dipakai',
          'Kamera sedang digunakan aplikasi lain (WhatsApp/Instagram/Kamera). Tutup aplikasi lain terlebih dahulu.',
          'error',
          '📷',
        );
      }

      // Tier 3: Synthetic media fallback for restricted/test environments
      const synthetic = this.createSyntheticMediaStream(withVideo);
      if (synthetic) {
        this.localStream = synthetic;
        showToast(
          'Simulasi Media Digunakan',
          'Kamera fisik tidak dapat diakses langsung. Panggilan tetap berjalan dengan simulasi media.',
          'info',
          '🎙️',
        );
        return this.localStream;
      }
      throw new Error('Tidak dapat mengakses perangkat media (mikrofon/kamera). Mohon periksa izin browser.');
    }
  }

  // =========================================================================
  // 1-on-1 Call Flow (FR-CALL-01..05, FR-VC-01..04)
  // =========================================================================
  async startDirectCall(receiverId, receiverName, mediaType = 'AUDIO') {
    if (!socketClient.socket || !socketClient.connected) {
      showToast('Koneksi Terputus', 'Koneksi real-time belum terhubung. Coba beberapa saat lagi.', 'warning', '⚠️');
      return;
    }

    const numReceiverId = Number(receiverId);
    this.mediaType = mediaType;

    try {
      await this.getLocalMedia(mediaType === 'VIDEO');
    } catch (err) {
      showToast('Akses Media Gagal', err.message, 'error', '🎙️');
      return;
    }

    this.currentCall = {
      callId: null,
      type: 'DIRECT',
      targetId: numReceiverId,
      targetName: receiverName,
      status: 'calling',
      mediaType: this.mediaType,
    };

    // Show active call dialog in "Calling..." state
    this.showActiveCallUI({
      type: 'DIRECT',
      title: receiverName,
      status: 'Memanggil...',
      mediaType: this.mediaType,
    });

    // Send initiate event to socket
    const myName = state.currentUser?.biodata
      ? `${state.currentUser.biodata.first_name} ${state.currentUser.biodata.last_name}`
      : state.currentUser?.email;

    socketClient.socket.emit(
      'call:initiate',
      {
        receiverId: numReceiverId,
        callerName: myName,
        mediaType: this.mediaType,
      },
      (response) => {
        if (response?.error === 'REGION_MISMATCH') {
          showToast('Akses Ditolak', 'Tidak dapat melakukan panggilan ke pengguna di wilayah/region berbeda (BR-TENANT-02).', 'error', '🚫');
          this.endCall(false);
          return;
        }

        if (response?.error) {
          showToast('Panggilan Gagal', response.error, 'error', '❌');
          this.endCall(false);
          return;
        }

        if (response?.callId && this.currentCall) {
          this.currentCall.callId = response.callId;
        }
      },
    );
  }

  async handleIncomingCall(data) {
    this.startRingtone();
    this.incomingCallData = data;
    this.mediaType = data.mediaType || 'AUDIO';

    const modal = document.getElementById('modal-incoming-call');
    const avatar = document.getElementById('incoming-call-avatar');
    const name = document.getElementById('incoming-call-name');
    const typeLabel = document.getElementById('incoming-call-type');
    const btnText = document.getElementById('incoming-call-btn-text');

    if (avatar) avatar.textContent = (data.callerName || 'U').charAt(0).toUpperCase();
    if (name) name.textContent = data.callerName || 'Pengguna';

    const isVideo = data.mediaType === 'VIDEO';
    if (typeLabel) {
      typeLabel.textContent = isVideo ? '📹 Panggilan Video Masuk...' : '📞 Panggilan Suara Masuk...';
    }
    if (btnText) {
      btnText.textContent = isVideo ? '📹 Terima Video' : '📞 Terima';
    }

    if (modal) modal.classList.remove('hidden');
  }

  async acceptIncomingCall() {
    this.stopRingtone();
    const data = this.incomingCallData;
    if (!data) return;

    const modal = document.getElementById('modal-incoming-call');
    if (modal) modal.classList.add('hidden');

    this.mediaType = data.mediaType || 'AUDIO';

    try {
      await this.getLocalMedia(this.mediaType === 'VIDEO');

      this.currentCall = {
        callId: data.callId,
        type: 'DIRECT',
        targetId: Number(data.callerId),
        targetName: data.callerName,
        status: 'connecting',
        mediaType: this.mediaType,
      };

      this.showActiveCallUI({
        type: 'DIRECT',
        title: data.callerName,
        status: 'Menghubungkan...',
        mediaType: this.mediaType,
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
        targetUserId: Number(data.callerId),
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
  // Peer Connection Helper (Audio + Video Tracks)
  // =========================================================================
  createPeerConnection(targetKey, isGroup = false) {
    const key = String(targetKey);
    if (this.peerConnections.has(key)) {
      try {
        this.peerConnections.get(key).close();
      } catch (e) {}
    }

    const pc = new RTCPeerConnection(this.rtcConfig);
    pc._iceCandidatesQueue = [];
    this.peerConnections.set(key, pc);

    // Add local tracks (Audio + Video)
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        try {
          pc.addTrack(track, this.localStream);
        } catch (e) {}
      });
    }

    // ICE Candidate
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        if (isGroup) {
          socketClient.socket.emit('group_call:signal', {
            targetSocketId: key,
            signal: { type: 'candidate', candidate: event.candidate },
          });
        } else {
          socketClient.socket.emit('call:signal', {
            targetUserId: Number(key) || key,
            signal: { type: 'candidate', candidate: event.candidate },
          });
        }
      }
    };

    // Remote Stream Handler
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;

      // Audio playback
      let audio = this.remoteAudios.get(key);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        this.remoteAudios.set(key, audio);
      }
      audio.srcObject = stream;
      audio.play().catch((e) => console.debug('Audio play policy caught:', e));

      // Video playback if in video mode
      if (this.mediaType === 'VIDEO') {
        if (!isGroup) {
          const remoteVideo = document.getElementById('remote-video');
          const fallback = document.getElementById('remote-video-fallback');
          if (remoteVideo) {
            remoteVideo.srcObject = stream;
            remoteVideo.play().catch((e) => console.debug('Video play policy caught:', e));
            if (fallback) fallback.classList.add('hidden');
          }
        } else {
          this.renderGroupVideoTile(key, stream);
        }
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.startCallTimer();
        this.updateCallStatusUI('Terhubung');
      } else if (pc.connectionState === 'failed') {
        console.warn(`Peer connection failed with ${key}`);
      }
    };

    return pc;
  }

  // =========================================================================
  // WebRTC Signal Dispatcher (with ICE Candidate Queueing)
  // =========================================================================
  async handleSignal(senderId, signal) {
    const key = String(senderId);
    let pc = this.peerConnections.get(key);
    if (!pc) {
      pc = this.createPeerConnection(key);
    }

    if (signal.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

      // Drain queued ICE candidates that arrived before remoteDescription
      if (pc._iceCandidatesQueue && pc._iceCandidatesQueue.length > 0) {
        for (const cand of pc._iceCandidatesQueue) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          } catch (e) {}
        }
        pc._iceCandidatesQueue = [];
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socketClient.socket.emit('call:signal', {
        targetUserId: Number(key) || key,
        signal: { type: 'answer', sdp: answer },
      });
    } else if (signal.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

      // Drain queued ICE candidates
      if (pc._iceCandidatesQueue && pc._iceCandidatesQueue.length > 0) {
        for (const cand of pc._iceCandidatesQueue) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          } catch (e) {}
        }
        pc._iceCandidatesQueue = [];
      }
    } else if (signal.type === 'candidate' && signal.candidate) {
      if (!pc.remoteDescription) {
        if (!pc._iceCandidatesQueue) pc._iceCandidatesQueue = [];
        pc._iceCandidatesQueue.push(signal.candidate);
      } else {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch (e) {
          console.warn('Error adding ICE candidate:', e);
        }
      }
    }
  }

  // =========================================================================
  // Group Call Flow (FR-CALL-02, BR-VC-01: Max 8 participants)
  // =========================================================================
  async startGroupCall(groupId, groupName, mediaType = 'AUDIO') {
    const numGroupId = Number(groupId);
    this.mediaType = mediaType;

    try {
      await this.getLocalMedia(mediaType === 'VIDEO');

      this.currentCall = {
        type: 'GROUP',
        groupId: numGroupId,
        groupName,
        status: 'joining',
        mediaType: this.mediaType,
      };

      this.showActiveCallUI({
        type: 'GROUP',
        title: groupName,
        status: 'Bergabung ke panggilan grup...',
        mediaType: this.mediaType,
      });

      const myName = state.currentUser?.biodata
        ? `${state.currentUser.biodata.first_name} ${state.currentUser.biodata.last_name}`
        : state.currentUser?.email;

      socketClient.socket.emit(
        'group_call:join',
        { groupId: numGroupId, userName: myName, mediaType: this.mediaType },
        async (response) => {
          if (response?.error === 'REGION_MISMATCH') {
            showToast('Akses Ditolak', 'Grup berada di wilayah/region yang berbeda (BR-TENANT-02).', 'error', '🚫');
            this.endCall(false);
            return;
          }

          if (response?.error === 'GROUP_CALL_FULL') {
            showToast('Panggilan Penuh', 'Kapasitas panggilan grup penuh (maksimal 8 peserta).', 'error', '👥');
            this.endCall(false);
            return;
          }

          this.startCallTimer();
          this.updateCallStatusUI('Terhubung');
          this.updateParticipantCountUI(response?.participantsCount || 1);

          if (typeof renderActiveGroupCallBanner === 'function' && typeof currentActiveGroupCall !== 'undefined' && currentActiveGroupCall) {
            renderActiveGroupCallBanner({ ...currentActiveGroupCall, participantsCount: response?.participantsCount || 1, isActive: true });
          }

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
        },
      );
    } catch (err) {
      showToast('Gagal Panggilan Grup', err.message, 'error', '❌');
      this.endCall(false);
    }
  }

  async handleGroupSignal(senderSocketId, signal) {
    const key = String(senderSocketId);
    let pc = this.peerConnections.get(key);
    if (!pc) {
      pc = this.createPeerConnection(key, true);
    }

    if (signal.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

      if (pc._iceCandidatesQueue && pc._iceCandidatesQueue.length > 0) {
        for (const cand of pc._iceCandidatesQueue) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          } catch (e) {}
        }
        pc._iceCandidatesQueue = [];
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socketClient.socket.emit('group_call:signal', {
        targetSocketId: key,
        signal: { type: 'answer', sdp: answer },
      });
    } else if (signal.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

      if (pc._iceCandidatesQueue && pc._iceCandidatesQueue.length > 0) {
        for (const cand of pc._iceCandidatesQueue) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          } catch (e) {}
        }
        pc._iceCandidatesQueue = [];
      }
    } else if (signal.type === 'candidate' && signal.candidate) {
      if (!pc.remoteDescription) {
        if (!pc._iceCandidatesQueue) pc._iceCandidatesQueue = [];
        pc._iceCandidatesQueue.push(signal.candidate);
      } else {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch (e) {}
      }
    }
  }

  renderGroupVideoTile(socketId, stream) {
    const grid = document.getElementById('group-video-grid');
    if (!grid) return;
    grid.classList.remove('hidden');

    let tile = document.getElementById(`group-tile-${socketId}`);
    if (!tile) {
      tile = document.createElement('div');
      tile.id = `group-tile-${socketId}`;
      tile.className = 'group-video-tile';
      tile.innerHTML = `
        <video autoplay playsinline></video>
        <span class="tile-label">Peserta</span>
      `;
      grid.appendChild(tile);
    }
    const video = tile.querySelector('video');
    if (video) video.srcObject = stream;
  }

  removeGroupVideoTile(socketId) {
    const tile = document.getElementById(`group-tile-${socketId}`);
    if (tile) tile.remove();
  }

  // =========================================================================
  // Media Controls: Mic Mute, Camera Toggle, Screen Sharing (FR-VC-03)
  // =========================================================================
  toggleMute() {
    if (!this.localStream) return;
    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !this.isMuted;
    });

    const btnMute = document.getElementById('btn-call-mute');
    if (btnMute) {
      btnMute.innerHTML = this.isMuted ? '<span>🔇 Buka Mic</span>' : '<span>🎙️ Matikan Mic</span>';
      btnMute.className = `btn btn-sm ${this.isMuted ? 'btn-danger' : 'btn-outline'}`;
    }
  }

  toggleCamera() {
    if (!this.localStream) return;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    this.isCameraOff = !this.isCameraOff;
    videoTrack.enabled = !this.isCameraOff;

    const btnCamera = document.getElementById('btn-call-camera');
    if (btnCamera) {
      btnCamera.innerHTML = this.isCameraOff
        ? '<span>📷 Nyalakan Kamera</span>'
        : '<span>📹 Matikan Kamera</span>';
      btnCamera.className = `btn btn-sm ${this.isCameraOff ? 'btn-danger' : 'btn-outline'}`;
    }

    const fallbackPip = document.getElementById('local-video-fallback');
    if (fallbackPip) {
      fallbackPip.classList.toggle('hidden', !this.isCameraOff);
    }
  }

  async toggleScreenShare() {
    if (this.isScreenSharing) {
      await this.stopScreenShare();
    } else {
      await this.startScreenShare();
    }
  }

  async startScreenShare() {
    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      const screenTrack = this.screenStream.getVideoTracks()[0];
      if (!screenTrack) return;

      screenTrack.onended = () => {
        this.stopScreenShare();
      };

      // Replace video track in active peer connections
      this.peerConnections.forEach((pc) => {
        const senders = pc.getSenders();
        const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
        if (videoSender) {
          videoSender.replaceTrack(screenTrack);
        }
      });

      this.isScreenSharing = true;
      const btnScreen = document.getElementById('btn-call-screen');
      if (btnScreen) {
        btnScreen.innerHTML = '<span>🛑 Stop Layar</span>';
        btnScreen.className = 'btn btn-sm btn-danger';
      }

      const localVideo = document.getElementById('local-video');
      if (localVideo) localVideo.srcObject = this.screenStream;

      if (this.currentCall?.type === 'DIRECT') {
        socketClient.socket?.emit('call:screen_share_start', {
          targetUserId: this.currentCall.targetId,
        });
      } else if (this.currentCall?.type === 'GROUP') {
        socketClient.socket?.emit('call:screen_share_start', {
          groupId: this.currentCall.groupId,
        });
      }

      showToast('Berbagi Layar', 'Anda sedang membagikan tampilan layar.', 'success', '🖥️');
    } catch (err) {
      console.warn('Screen share cancelled or error:', err);
    }
  }

  async stopScreenShare() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }

    this.isScreenSharing = false;

    // Restore camera video track
    const cameraTrack = this.localStream?.getVideoTracks()[0] || null;
    this.peerConnections.forEach((pc) => {
      const senders = pc.getSenders();
      const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
      if (videoSender && cameraTrack) {
        videoSender.replaceTrack(cameraTrack);
      }
    });

    const localVideo = document.getElementById('local-video');
    if (localVideo && this.localStream) localVideo.srcObject = this.localStream;

    const btnScreen = document.getElementById('btn-call-screen');
    if (btnScreen) {
      btnScreen.innerHTML = '<span>🖥️ Bagikan Layar</span>';
      btnScreen.className = 'btn btn-sm btn-outline';
    }

    if (this.currentCall?.type === 'DIRECT') {
      socketClient.socket?.emit('call:screen_share_stop', {
        targetUserId: this.currentCall.targetId,
      });
    } else if (this.currentCall?.type === 'GROUP') {
      socketClient.socket?.emit('call:screen_share_stop', {
        groupId: this.currentCall.groupId,
      });
    }
  }

  handleScreenShareStarted() {
    const badge = document.getElementById('remote-screen-badge');
    if (badge) badge.classList.remove('hidden');
    showToast('Berbagi Layar', 'Lawan bicara sedang membagikan layar.', 'info', '🖥️');
  }

  handleScreenShareStopped() {
    const badge = document.getElementById('remote-screen-badge');
    if (badge) badge.classList.add('hidden');
  }

  // =========================================================================
  // End Call & Cleanup
  // =========================================================================
  endCall(emitEvent = true) {
    this.stopRingtone();

    let durationSeconds = 0;
    if (this.currentCall?.startTime) {
      durationSeconds = Math.floor((Date.now() - this.currentCall.startTime) / 1000);
    }

    if (emitEvent && this.currentCall) {
      if (this.currentCall.type === 'DIRECT') {
        socketClient.socket?.emit('call:end', {
          callId: this.currentCall.callId,
          targetUserId: this.currentCall.targetId,
          duration: durationSeconds,
        });
      } else if (this.currentCall.type === 'GROUP') {
        socketClient.socket?.emit('group_call:leave', {
          groupId: this.currentCall.groupId,
        });
      }
    }

    if (this.isScreenSharing) {
      this.stopScreenShare();
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
    this.isCameraOff = false;
    this.isScreenSharing = false;

    // Reset UI
    const callModal = document.getElementById('modal-active-call');
    if (callModal) callModal.classList.add('hidden');

    const card = document.getElementById('active-call-card');
    if (card) card.classList.remove('video-mode');

    const viewport = document.getElementById('video-call-viewport');
    if (viewport) viewport.classList.add('hidden');

    const remoteVideo = document.getElementById('remote-video');
    if (remoteVideo) remoteVideo.srcObject = null;

    const localVideo = document.getElementById('local-video');
    if (localVideo) localVideo.srcObject = null;

    const groupGrid = document.getElementById('group-video-grid');
    if (groupGrid) {
      groupGrid.innerHTML = '';
      groupGrid.classList.add('hidden');
    }

    const screenBadge = document.getElementById('remote-screen-badge');
    if (screenBadge) screenBadge.classList.add('hidden');

    if (typeof loadChatMessages === 'function' && state.activeChat) {
      setTimeout(() => {
        loadChatMessages();
      }, 500);
    }

    if (typeof renderActiveGroupCallBanner === 'function' && typeof currentActiveGroupCall !== 'undefined' && currentActiveGroupCall) {
      renderActiveGroupCallBanner(currentActiveGroupCall);
    }
  }

  // =========================================================================
  // UI Helpers
  // =========================================================================
  showActiveCallUI(info) {
    const modal = document.getElementById('modal-active-call');
    const card = document.getElementById('active-call-card');
    const title = document.getElementById('active-call-title');
    const status = document.getElementById('active-call-status');
    const duration = document.getElementById('active-call-duration');
    const participantsInfo = document.getElementById('active-call-participants');
    const viewport = document.getElementById('video-call-viewport');
    const btnCamera = document.getElementById('btn-call-camera');
    const btnScreen = document.getElementById('btn-call-screen');
    const localVideo = document.getElementById('local-video');

    const isVideo = info.mediaType === 'VIDEO';

    if (title) {
      title.textContent = `${isVideo ? '📹 Video' : '📞 Suara'}: ${info.title || 'Panggilan'}`;
    }
    if (status) status.textContent = info.status || 'Menghubungkan...';
    if (duration) duration.textContent = '00:00';
    if (participantsInfo) {
      participantsInfo.textContent = info.type === 'GROUP' ? '1/8 Peserta' : '';
    }

    const btnMute = document.getElementById('btn-call-mute');
    if (btnMute) {
      btnMute.innerHTML = '<span>🎙️ Matikan Mic</span>';
      btnMute.className = 'btn btn-outline btn-sm';
    }

    if (isVideo) {
      if (card) card.classList.add('video-mode');
      if (viewport) viewport.classList.remove('hidden');
      if (btnCamera) {
        btnCamera.classList.remove('hidden');
        btnCamera.innerHTML = '<span>📹 Matikan Kamera</span>';
        btnCamera.className = 'btn btn-outline btn-sm';
      }
      if (btnScreen) {
        btnScreen.classList.remove('hidden');
        btnScreen.innerHTML = '<span>🖥️ Bagikan Layar</span>';
        btnScreen.className = 'btn btn-outline btn-sm';
      }
      if (localVideo && this.localStream) {
        localVideo.srcObject = this.localStream;
      }
    } else {
      if (card) card.classList.remove('video-mode');
      if (viewport) viewport.classList.add('hidden');
      if (btnCamera) btnCamera.classList.add('hidden');
      if (btnScreen) btnScreen.classList.add('hidden');
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

// Global singleton instance
const webrtcManager = new WebRTCManager();
