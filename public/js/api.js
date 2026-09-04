/**
 * ChatSphere - API Service Client
 */

const API_BASE = '/api/v1';

const api = {
  // Token management
  getToken() {
    return localStorage.getItem('chat_token');
  },

  setToken(token) {
    localStorage.setItem('chat_token', token);
  },

  getUser() {
    try {
      return JSON.parse(localStorage.getItem('chat_user') || 'null');
    } catch {
      return null;
    }
  },

  setUser(user) {
    localStorage.setItem('chat_user', JSON.stringify(user));
  },

  clearAuth() {
    localStorage.removeItem('chat_token');
    localStorage.removeItem('chat_user');
  },

  // Centralized Request Handler
  async request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const token = this.getToken();

    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const res = await fetch(url, {
        ...options,
        headers,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Automatically handle unauthorized session expiration
        if (res.status === 401 && !endpoint.includes('/auth/login')) {
          this.clearAuth();
          window.location.reload();
        }
        const errorMsg = data?.message || (Array.isArray(data?.message) ? data.message.join(', ') : 'Terjadi kesalahan sistem');
        throw new Error(errorMsg);
      }

      // Unwrap standard response decorator if payload is nested in `data`
      return data?.data !== undefined ? data.data : data;
    } catch (err) {
      console.error(`[API Error] ${endpoint}:`, err);
      throw err;
    }
  },

  // ==========================================
  // AUTH
  // ==========================================
  async login(email, password) {
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (data.access_token) {
      this.setToken(data.access_token);
      this.setUser(data.user);
    }
    return data;
  },

  async requestResetPassword(email) {
    return this.request('/auth/reset-password-request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async resetPassword(token, newPassword) {
    return this.request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    });
  },

  async logout() {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } finally {
      this.clearAuth();
    }
  },

  // ==========================================
  // USERS & ADMIN
  // ==========================================
  async getMe() {
    return this.request('/users/me');
  },

  async getUsers(includeDeleted = false) {
    return this.request(`/users?includeDeleted=${includeDeleted}`);
  },

  async getUserById(id) {
    return this.request(`/users/${id}`);
  },

  async createUserByAdmin(userData) {
    return this.request('/users', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  },

  async updateUser(id, updateData) {
    return this.request(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updateData),
    });
  },

  async softDeleteUser(id) {
    return this.request(`/users/${id}`, {
      method: 'DELETE',
    });
  },

  // ==========================================
  // CHAT (GROUPS & PC)
  // ==========================================
  async createGroup(name, description) {
    return this.request('/chat/groups', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
  },

  async getMyGroups() {
    return this.request('/chat/groups');
  },

  async addGroupMember(groupId, userId) {
    return this.request(`/chat/groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId: Number(userId) }),
    });
  },

  async joinGroup(groupId) {
    return this.request(`/chat/groups/${groupId}/join`, {
      method: 'POST',
    });
  },

  async removeGroupMember(groupId, userId) {
    return this.request(`/chat/groups/${groupId}/members/${userId}`, {
      method: 'DELETE',
    });
  },

  async sendGroupMessage(groupId, content) {
    return this.request(`/chat/groups/${groupId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  },

  async getGroupMessages(groupId) {
    return this.request(`/chat/groups/${groupId}/messages`);
  },

  async sendDirectMessage(receiverId, content) {
    return this.request('/chat/pc/messages', {
      method: 'POST',
      body: JSON.stringify({ receiverId: Number(receiverId), content }),
    });
  },

  async getDirectMessages(userId) {
    return this.request(`/chat/pc/${userId}/messages`);
  },

  async getConversations() {
    return this.request('/chat/pc/conversations');
  },

  // ==========================================
  // NOTIFICATIONS
  // ==========================================
  async getNotifications() {
    return this.request('/notifications');
  },

  async markNotificationRead(id) {
    return this.request(`/notifications/${id}/read`, {
      method: 'PATCH',
    });
  },
};
