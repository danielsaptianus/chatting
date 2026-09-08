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

  async getAllGroups() {
    return this.request('/chat/groups/all');
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

  async requestJoinGroup(groupId) {
    return this.request(`/chat/groups/${groupId}/join-request`, {
      method: 'POST',
    });
  },

  async getGroupJoinRequests(groupId) {
    return this.request(`/chat/groups/${groupId}/join-requests`);
  },

  async approveGroupJoinRequest(groupId, requestId) {
    return this.request(`/chat/groups/${groupId}/join-requests/${requestId}/approve`, {
      method: 'POST',
    });
  },

  async rejectGroupJoinRequest(groupId, requestId) {
    return this.request(`/chat/groups/${groupId}/join-requests/${requestId}/reject`, {
      method: 'POST',
    });
  },

  async removeGroupMember(groupId, userId) {
    return this.request(`/chat/groups/${groupId}/members/${userId}`, {
      method: 'DELETE',
    });
  },

  async leaveGroup(groupId, userId) {
    return this.removeGroupMember(groupId, userId);
  },

  async getGroupInviteCode(groupId) {
    return this.request(`/chat/groups/${groupId}/invite-code`);
  },

  async revokeGroupInviteCode(groupId) {
    return this.request(`/chat/groups/${groupId}/revoke-invite`, {
      method: 'POST',
    });
  },

  async previewGroupByInvite(code) {
    return this.request(`/chat/groups/invite/${code}`);
  },

  async requestJoinByInvite(code) {
    return this.request(`/chat/groups/invite/${code}/request`, {
      method: 'POST',
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

  async markDirectMessagesRead(userId) {
    return this.request(`/chat/pc/${userId}/read`, {
      method: 'PATCH',
    });
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

  // ==========================================
  // COMMUNITIES (FR-COM-01 s/d FR-COM-05)
  // ==========================================
  async createCommunity(name, description) {
    return this.request('/communities', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
  },

  async getMyCommunities() {
    return this.request('/communities');
  },

  async getAllCommunities() {
    return this.request('/communities/all');
  },

  async getCommunityDetails(id) {
    return this.request(`/communities/${id}`);
  },

  async joinCommunity(id) {
    return this.request(`/communities/${id}/join`, {
      method: 'POST',
    });
  },

  async linkGroupToCommunity(communityId, groupId) {
    return this.request(`/communities/${communityId}/groups`, {
      method: 'POST',
      body: JSON.stringify({ groupId: Number(groupId) }),
    });
  },

  async getCommunityGroups(communityId) {
    return this.request(`/communities/${communityId}/groups`);
  },

  async removeCommunityMember(communityId, userId) {
    return this.request(`/communities/${communityId}/members/${userId}`, {
      method: 'DELETE',
    });
  },

  // ==========================================
  // CHAT EXPORT (FR-EXP-01 s/d FR-EXP-04)
  // ==========================================
  async exportGroupChat(groupId, format = 'txt', startDate = '', endDate = '') {
    const params = new URLSearchParams({ format });
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);

    const token = this.getToken();
    const res = await fetch(`${API_BASE}/chat/groups/${groupId}/export?${params.toString()}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Gagal mengekspor chat grup');
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    let filename = `group_${groupId}_export.${format}`;
    if (disposition.includes('filename="')) {
      filename = disposition.split('filename="')[1].split('"')[0];
    }
    return { blob, filename };
  },

  async exportPCChat(userId, format = 'txt', startDate = '', endDate = '') {
    const params = new URLSearchParams({ format });
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);

    const token = this.getToken();
    const res = await fetch(`${API_BASE}/chat/pc/${userId}/export?${params.toString()}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Gagal mengekspor chat pribadi');
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    let filename = `pc_${userId}_export.${format}`;
    if (disposition.includes('filename="')) {
      filename = disposition.split('filename="')[1].split('"')[0];
    }
    return { blob, filename };
  },

  // ==========================================
  // VOICE CALLS & CALL HISTORY
  // ==========================================

  async getCallHistory() {
    return this.request('/calls/history');
  },
};
