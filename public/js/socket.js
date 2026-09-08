/**
 * ChatSphere - Real-time Socket.io Client Manager
 */

class SocketClient {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.handlers = {};
  }

  connect() {
    const token = api.getToken();
    if (!token) return;

    if (this.socket) {
      this.disconnect();
    }

    const host = window.location.origin;

    // Connect to WebSocket namespace 'ws'
    this.socket = io(`${host}/ws`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      console.log('✅ WebSocket connected successfully! Socket ID:', this.socket.id);
      this.connected = true;
      this.notifyStatus(true);
    });

    this.socket.on('disconnect', (reason) => {
      console.warn('⚠️ WebSocket disconnected:', reason);
      this.connected = false;
      this.notifyStatus(false);
    });

    this.socket.on('connect_error', (error) => {
      console.error('❌ WebSocket Connection error:', error.message);
      this.connected = false;
      this.notifyStatus(false);
    });

    // Bind all registered event handlers to this socket instance
    Object.keys(this.handlers).forEach((event) => {
      this.bindSocketEvent(event);
    });
  }

  bindSocketEvent(event) {
    if (!this.socket) return;
    this.socket.off(event);
    this.socket.on(event, (payload) => {
      console.log(`📡 [WS Event] '${event}':`, payload);
      this.trigger(event, payload);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
      this.notifyStatus(false);
    }
  }

  joinGroupRoom(groupId) {
    if (this.socket && this.connected) {
      this.socket.emit('join_group', { groupId });
    }
  }

  leaveGroupRoom(groupId) {
    if (this.socket && this.connected) {
      this.socket.emit('leave_group', { groupId });
    }
  }

  on(event, callback) {
    if (!this.handlers[event]) {
      this.handlers[event] = [];
      if (this.socket) {
        this.bindSocketEvent(event);
      }
    }
    this.handlers[event].push(callback);
  }

  off(event, callback) {
    if (!this.handlers[event]) return;
    if (!callback) {
      this.handlers[event] = [];
      if (this.socket) this.socket.off(event);
    } else {
      this.handlers[event] = this.handlers[event].filter((cb) => cb !== callback);
    }
  }

  trigger(event, data) {
    if (this.handlers[event]) {
      this.handlers[event].forEach((cb) => {
        try {
          cb(data);
        } catch (e) {
          console.error(`Error in WS event handler '${event}':`, e);
        }
      });
    }
  }

  notifyStatus(isOnline) {
    this.trigger('status_change', isOnline);
  }
}

const socketClient = new SocketClient();
