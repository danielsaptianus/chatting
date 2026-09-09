/**
 * ChatSphere - Main Application Controller
 */

// Global State
const state = {
  currentUser: null,
  activeTab: 'groups', // 'groups' | 'pc' | 'communities'
  activeChat: null,    // { type: 'group' | 'pc', id: number, data: any }
  activeCommunity: null,
  communityTabFilter: 'my', // 'my' | 'all'
  groups: [],
  conversations: [],
  communities: [],
  notifications: [],
  usersCache: [],
};

// ==========================================================================
// Toast Notification Utility
// ==========================================================================
function showToast(title, message, type = 'info', icon = '💬') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-body">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
  `;

  container.appendChild(toast);

  // Auto remove after 5 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Quick fill helper for demo login
function fillLogin(email, password) {
  document.getElementById('login-email').value = email;
  document.getElementById('login-password').value = password;
}

// ==========================================================================
// Initialization & Auth Flow
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await checkAuthStatus();
});

async function checkAuthStatus() {
  const token = api.getToken();
  if (!token) {
    showAuthScreen();
    return;
  }

  try {
    const user = await api.getMe();
    state.currentUser = user;
    api.setUser(user);
    showAppScreen();
    initApp();
  } catch (err) {
    api.clearAuth();
    showAuthScreen();
  }
}

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
  socketClient.disconnect();
}

function showAppScreen() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
}

function initApp() {
  renderCurrentUser();
  socketClient.connect();
  loadConversations();
  loadNotifications();
}

// ==========================================================================
// Event Listeners Setup
// ==========================================================================
function setupEventListeners() {
  // Auth Form Handlers
  const formLogin = document.getElementById('form-login');
  formLogin.addEventListener('submit', handleLogin);

  const formReqReset = document.getElementById('form-request-reset');
  formReqReset.addEventListener('submit', handleRequestReset);

  const formConfirmReset = document.getElementById('form-confirm-reset');
  formConfirmReset.addEventListener('submit', handleConfirmReset);

  // Form Switchers
  document.getElementById('btn-to-reset').addEventListener('click', () => {
    formLogin.classList.add('hidden');
    formReqReset.classList.remove('hidden');
  });

  document.getElementById('btn-back-to-login').addEventListener('click', () => {
    formReqReset.classList.add('hidden');
    formLogin.classList.remove('hidden');
  });

  document.getElementById('btn-back-to-login-2').addEventListener('click', () => {
    formConfirmReset.classList.add('hidden');
    formLogin.classList.remove('hidden');
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await api.logout();
    state.currentUser = null;
    showAuthScreen();
    showToast('Logout', 'Anda telah berhasil keluar.', 'info', '👋');
  });

  // Sidebar Tabs (Group vs PC vs Communities)
  document.getElementById('tab-groups').addEventListener('click', () => switchTab('groups'));
  document.getElementById('tab-pc').addEventListener('click', () => switchTab('pc'));
  document.getElementById('tab-communities').addEventListener('click', () => switchTab('communities'));

  // Search input filter
  document.getElementById('input-search-chat').addEventListener('input', (e) => {
    filterConversations(e.target.value.toLowerCase());
  });

  // Create Group / New Chat / New Community button
  document.getElementById('btn-new-chat').addEventListener('click', () => {
    if (state.activeTab === 'groups') {
      openModal('modal-create-group');
    } else if (state.activeTab === 'communities') {
      openModal('modal-create-community');
    } else {
      openUserSelectModalForPC();
    }
  });

  // Join by Invite Link button (WhatsApp style)
  const btnJoinByLink = document.getElementById('btn-join-by-link');
  if (btnJoinByLink) {
    btnJoinByLink.addEventListener('click', () => openJoinByLinkModal());
  }

  // Check URL hash for direct invite links (#invite=xyz)
  checkUrlInviteLink();

  // Create Group Form
  document.getElementById('form-create-group').addEventListener('submit', handleCreateGroup);

  // Community & Export Forms
  document.getElementById('form-create-community').addEventListener('submit', handleCreateCommunitySubmit);
  document.getElementById('form-link-group').addEventListener('submit', handleLinkGroupSubmit);
  document.getElementById('form-export-chat').addEventListener('submit', handleExportSubmit);

  // Add Member Form
  document.getElementById('form-add-member').addEventListener('submit', handleAddMember);

  // Send Message Form
  document.getElementById('form-send-message').addEventListener('submit', handleSendMessage);

  // Notifications Bell Toggle
  const bellBtn = document.getElementById('btn-notification-bell');
  const notifDropdown = document.getElementById('notification-dropdown');
  bellBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = notifDropdown.classList.contains('hidden');
    if (isHidden) {
      loadNotifications();
    }
    notifDropdown.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!notifDropdown.contains(e.target) && e.target !== bellBtn) {
      notifDropdown.classList.add('hidden');
    }
  });

  document.getElementById('btn-mark-all-read').addEventListener('click', handleMarkAllNotificationsRead);

  // My Profile Modal (FR-BIO-01, FR-BIO-02, FR-BIO-03)
  const profilePill = document.getElementById('user-profile-pill');
  if (profilePill) {
    profilePill.addEventListener('click', () => openMyProfileModal());
  }
  const btnOpenProfile = document.getElementById('btn-open-my-profile');
  if (btnOpenProfile) {
    btnOpenProfile.addEventListener('click', (e) => {
      e.stopPropagation();
      openMyProfileModal();
    });
  }
  const formMyProfile = document.getElementById('form-my-profile');
  if (formMyProfile) {
    formMyProfile.addEventListener('submit', handleSaveMyProfile);
  }
  const inputAvatarFile = document.getElementById('input-avatar-file');
  if (inputAvatarFile) {
    inputAvatarFile.addEventListener('change', handleAvatarFileChange);
  }
  const bioInput = document.getElementById('my-profile-bio');
  if (bioInput) {
    bioInput.addEventListener('input', (e) => {
      const counter = document.getElementById('bio-char-count');
      if (counter) counter.textContent = `${e.target.value.length}/150`;
    });
  }

  // Admin Management Modal
  const btnAdmin = document.getElementById('btn-open-admin');
  btnAdmin.addEventListener('click', () => {
    openModal('modal-admin-users');
    loadAdminUsersList();
  });

  document.getElementById('check-include-deleted').addEventListener('change', () => {
    loadAdminUsersList();
  });

  document.getElementById('btn-admin-register-user').addEventListener('click', () => {
    openRegisterUserModal();
  });

  document.getElementById('form-register-user').addEventListener('submit', handleAdminRegisterUser);
  document.getElementById('form-edit-user').addEventListener('submit', handleEditUser);

  // Mobile Sidebar Toggle
  document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
    document.getElementById('app-sidebar').classList.toggle('open');
  });

  // Socket.io Real-time Events
  setupSocketListeners();
}

// ==========================================================================
// Real-time WebSocket Listeners
// ==========================================================================
function setupSocketListeners() {
  socketClient.on('status_change', (isOnline) => {
    const badge = document.getElementById('ws-badge');
    const text = badge.querySelector('.status-text');
    badge.className = `ws-status ${isOnline ? 'ws-online' : 'ws-offline'}`;
    text.textContent = isOnline ? 'Online' : 'Offline';
  });

  // Notification Event
  socketClient.on('notification', (notif) => {
    // Add to notification list
    state.notifications.unshift(notif);
    renderNotifications();

    // Map notification icon
    let icon = '🔔';
    if (notif.type === 'USER_REGISTERED') icon = '👤';
    if (notif.type === 'ADDED_TO_GROUP') icon = '🎉';
    if (notif.type === 'REMOVED_FROM_GROUP') icon = '⚠️';
    if (notif.type === 'USER_JOINED_GROUP') icon = '👥';
    if (notif.type === 'JOIN_REQUEST_RECEIVED') icon = '📩';
    if (notif.type === 'JOIN_REQUEST_APPROVED') icon = '✅';
    if (notif.type === 'JOIN_REQUEST_REJECTED') icon = '❌';

    showToast(notif.title, notif.message, 'notification', icon);

    // Refresh groups/members if relevant
    if (
      notif.type === 'ADDED_TO_GROUP' ||
      notif.type === 'REMOVED_FROM_GROUP' ||
      notif.type === 'JOIN_REQUEST_APPROVED'
    ) {
      loadConversations();
    }
    if (
      notif.type === 'JOIN_REQUEST_RECEIVED' &&
      state.activeChat?.type === 'group' &&
      state.activeChat.id === notif.metadata?.groupId
    ) {
      loadGroupJoinRequests(notif.metadata.groupId);
    }
  });

  // Group Message Event
  socketClient.on('group_message', (message) => {
    if (state.activeChat?.type === 'group' && state.activeChat.id === message.group_id) {
      appendMessageBubble(message, message.sender_id === state.currentUser?.id);
    } else {
      // Toast notification for incoming group message
      if (message.sender_id !== state.currentUser?.id) {
        const senderName = message.sender?.biodata 
          ? `${message.sender.biodata.first_name} ${message.sender.biodata.last_name}`
          : message.sender?.email;
        showToast('Pesan Grup Baru', `${senderName}: ${message.content}`, 'info', '💬');
      }
    }
  });

  // Personal Chat (PC) Message Event
  socketClient.on('pc_message', (message) => {
    const isCurrentActive =
      state.activeChat?.type === 'pc' &&
      (state.activeChat.id === message.sender_id || state.activeChat.id === message.receiver_id);

    if (isCurrentActive) {
      appendMessageBubble(message, message.sender_id === state.currentUser?.id);
      if (message.sender_id !== state.currentUser?.id) {
        api.markDirectMessagesRead(message.sender_id).catch(() => {});
      }
    } else {
      if (message.sender_id !== state.currentUser?.id) {
        const senderName = message.sender?.biodata
          ? `${message.sender.biodata.first_name} ${message.sender.biodata.last_name}`
          : message.sender?.email;
        showToast('Pesan Pribadi (PC)', `${senderName}: ${message.content}`, 'info', '✉️');
        loadConversations();
      }
    }
  });

  // Real-time Read Receipt Event (Ceklis Biru ala WhatsApp)
  socketClient.on('messages_read', (data) => {
    if (state.activeChat?.type === 'pc' && state.activeChat.id === data.readerId) {
      document.querySelectorAll('.message-bubble.outgoing .bubble-status').forEach((el) => {
        el.className = 'bubble-status status-read';
        el.title = 'Telah dibaca';
        el.textContent = '✓✓';
      });
    }
  });

  // ==========================================
  // WebRTC Voice Call Events (FR-CALL-01 s/d FR-CALL-05)
  // ==========================================
  socketClient.on('call:incoming', (data) => {
    webrtcManager.handleIncomingCall(data);
  });

  socketClient.on('call:accepted', () => {
    webrtcManager.updateCallStatusUI('Menghubungkan suara...');
  });

  socketClient.on('call:rejected', (data) => {
    showToast('Panggilan Ditolak', data?.reason || 'Pihak penerima menolak panggilan.', 'info', '📞');
    webrtcManager.endCall(false);
  });

  socketClient.on('call:ended', () => {
    showToast('Panggilan Selesai', 'Panggilan suara telah berakhir.', 'info', '📞');
    webrtcManager.endCall(false);
  });

  // BR-CALL-01: 30 seconds ring timeout handler
  socketClient.on('call:timeout', (data) => {
    showToast('Waktu Panggilan Habis (30s)', data?.message || 'Panggilan tidak dijawab dalam 30 detik.', 'warning', '⏱️');
    webrtcManager.endCall(false);
  });

  socketClient.on('call:signal', (data) => {
    webrtcManager.handleSignal(data.senderId, data.signal);
  });

  socketClient.on('group_call:user_joined', (data) => {
    showToast('Panggilan Grup', `${data.userName} bergabung ke panggilan.`, 'info', '👥');
    webrtcManager.updateParticipantCountUI(data.participantsCount);
  });

  socketClient.on('group_call:user_left', (data) => {
    webrtcManager.updateParticipantCountUI(data.participantsCount);
  });

  socketClient.on('group_call:signal', (data) => {
    webrtcManager.handleGroupSignal(data.senderSocketId, data.signal);
  });

  socketClient.on('group_call:error', (data) => {
    showToast('Panggilan Grup Penuh', data.message, 'error', '👥');
  });
}

// ==========================================================================
// Authentication Handlers
// ==========================================================================
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const alertEl = document.getElementById('auth-alert');
  const spinner = document.getElementById('login-spinner');

  alertEl.className = 'alert-box hidden';
  spinner.classList.remove('hidden');

  try {
    const data = await api.login(email, password);
    state.currentUser = data.user;
    showAppScreen();
    initApp();
    showToast('Berhasil Masuk', `Selamat datang kembali, ${data.user.biodata?.first_name || data.user.email}!`, 'success', '👋');
  } catch (err) {
    alertEl.textContent = err.message;
    alertEl.className = 'alert-box alert-error';
  } finally {
    spinner.classList.add('hidden');
  }
}

async function handleRequestReset(e) {
  e.preventDefault();
  const email = document.getElementById('reset-email').value.trim();
  const alertEl = document.getElementById('auth-alert');

  try {
    const res = await api.requestResetPassword(email);
    if (res.reset_token) {
      // Auto-fill token into confirm form for seamless testing
      document.getElementById('reset-token').value = res.reset_token;
      document.getElementById('form-request-reset').classList.add('hidden');
      document.getElementById('form-confirm-reset').classList.remove('hidden');
      showToast('Token Digenerate', 'Gunakan token untuk mengatur password baru.', 'success', '🔑');
    } else {
      showToast('Permintaan Terkirim', res.message, 'info', '📧');
    }
  } catch (err) {
    alertEl.textContent = err.message;
    alertEl.className = 'alert-box alert-error';
  }
}

async function handleConfirmReset(e) {
  e.preventDefault();
  const token = document.getElementById('reset-token').value.trim();
  const newPassword = document.getElementById('new-password').value;

  try {
    await api.resetPassword(token, newPassword);
    showToast('Sukses', 'Password Anda berhasil diperbarui. Silakan login.', 'success', '✅');
    document.getElementById('form-confirm-reset').classList.add('hidden');
    document.getElementById('form-login').classList.remove('hidden');
  } catch (err) {
    showToast('Gagal', err.message, 'error', '❌');
  }
}

function renderCurrentUser() {
  const user = state.currentUser;
  if (!user) return;

  const firstName = user.biodata?.first_name || 'User';
  const lastName = user.biodata?.last_name || '';
  const role = user.biodata?.role || 'USER';

  const avatarEl = document.getElementById('current-user-avatar');
  if (user.biodata?.avatar_url) {
    avatarEl.innerHTML = `<img src="${user.biodata.avatar_url}" alt="Avatar" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
    avatarEl.style.padding = '0';
  } else {
    avatarEl.textContent = firstName.charAt(0).toUpperCase();
    avatarEl.style.padding = '';
  }

  document.getElementById('current-user-name').textContent = `${firstName} ${lastName}`.trim();
  document.getElementById('current-user-role').textContent = role;

  // Show Admin Panel Button if SUPER_ADMIN or ADMIN (FR-ROLE-01 - FR-ROLE-05)
  const adminBtn = document.getElementById('btn-open-admin');
  const isPrivileged = role === 'SUPER_ADMIN' || role === 'ADMIN';
  if (isPrivileged) {
    adminBtn.classList.remove('hidden');
    adminBtn.title = role === 'SUPER_ADMIN' ? 'Manajemen Pengguna (Super Admin)' : 'Manajemen Pengguna (Admin Grup)';
  } else {
    adminBtn.classList.add('hidden');
  }
}

// ==========================================================================
// Conversations (Sidebar) Management
// ==========================================================================
function switchTab(tab) {
  state.activeTab = tab;
  document.getElementById('tab-groups').classList.toggle('active', tab === 'groups');
  document.getElementById('tab-pc').classList.toggle('active', tab === 'pc');
  document.getElementById('tab-communities').classList.toggle('active', tab === 'communities');

  const btnNewChatLabel = document.getElementById('btn-new-chat-label');
  if (tab === 'groups') {
    btnNewChatLabel.textContent = '+ Buat Grup';
  } else if (tab === 'pc') {
    btnNewChatLabel.textContent = '+ Pesan PC';
  } else if (tab === 'communities') {
    btnNewChatLabel.textContent = '+ Komunitas';
  }

  const btnJoinByLink = document.getElementById('btn-join-by-link');
  if (btnJoinByLink) {
    btnJoinByLink.style.display = tab === 'groups' ? 'inline-flex' : 'none';
  }

  loadConversations();
}

async function loadConversations() {
  const container = document.getElementById('conversation-list');
  container.innerHTML = '<div class="loading-spinner-wrapper"><span class="spinner"></span></div>';

  try {
    if (state.activeTab === 'groups') {
      const groups = await api.getMyGroups();
      state.groups = groups || [];
      renderGroupList(state.groups);
    } else if (state.activeTab === 'pc') {
      const convos = await api.getConversations();
      state.conversations = convos || [];
      renderPCList(state.conversations);
    } else if (state.activeTab === 'communities') {
      let communities = [];
      if (state.communityTabFilter === 'all') {
        communities = await api.getAllCommunities();
      } else {
        communities = await api.getMyCommunities();
      }
      state.communities = communities || [];
      renderCommunityList(state.communities);
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

function renderGroupList(groups) {
  const container = document.getElementById('conversation-list');
  if (!groups || groups.length === 0) {
    container.innerHTML = '<div class="empty-state">Belum bergabung dengan grup manapun. Buat grup baru!</div>';
    return;
  }

  container.innerHTML = groups.map((g) => {
    const isActive = state.activeChat?.type === 'group' && state.activeChat.id === g.id;
    const initial = (g.name || 'G').charAt(0).toUpperCase();
    const memberCount = g.members?.length || 0;

    return `
      <div class="conv-item ${isActive ? 'active' : ''}" onclick="selectGroupChat(${g.id})">
        <div class="conv-avatar group">${initial}</div>
        <div class="conv-meta">
          <div class="conv-top">
            <span class="conv-name">${escapeHtml(g.name)}</span>
          </div>
          <div class="conv-snippet">${memberCount} Anggota ${g.description ? `• ${escapeHtml(g.description)}` : ''}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderPCList(contacts) {
  const container = document.getElementById('conversation-list');
  if (!contacts || contacts.length === 0) {
    container.innerHTML = '<div class="empty-state">Belum ada percakapan pribadi. Klik "+ Pesan PC" untuk memulai.</div>';
    return;
  }

  container.innerHTML = contacts.map((u) => {
    const isActive = state.activeChat?.type === 'pc' && state.activeChat.id === u.id;
    const name = u.biodata ? `${u.biodata.first_name} ${u.biodata.last_name}` : u.email;
    const initial = name.charAt(0).toUpperCase();
    const roleBadge = u.biodata?.role ? `[${u.biodata.role}]` : '';
    const avatarHtml = u.biodata?.avatar_url
      ? `<img src="${u.biodata.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
      : initial;

    return `
      <div class="conv-item ${isActive ? 'active' : ''}" onclick="selectPCChat(${u.id})">
        <div class="conv-avatar user" style="${u.biodata?.avatar_url ? 'padding:0;overflow:hidden;' : ''}">${avatarHtml}</div>
        <div class="conv-meta">
          <div class="conv-top">
            <span class="conv-name">${escapeHtml(name)}</span>
            <span class="conv-time">${roleBadge}</span>
          </div>
          <div class="conv-snippet">${escapeHtml(u.email)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function setCommunityFilter(filter) {
  state.communityTabFilter = filter;
  loadConversations();
}

function renderCommunityList(communities) {
  const container = document.getElementById('conversation-list');
  const filterPills = `
    <div class="community-filter-toggle">
      <button class="filter-pill ${state.communityTabFilter === 'my' ? 'active' : ''}" onclick="setCommunityFilter('my')">Komunitas Saya</button>
      <button class="filter-pill ${state.communityTabFilter === 'all' ? 'active' : ''}" onclick="setCommunityFilter('all')">Jelajahi Semua</button>
    </div>
  `;

  if (!communities || communities.length === 0) {
    container.innerHTML = filterPills + `
      <div class="empty-state" style="padding:24px 16px;">
        <div style="font-size:2rem; margin-bottom:8px;">👥</div>
        <p>${state.communityTabFilter === 'all' ? 'Belum ada komunitas yang terdaftar di platform.' : 'Belum ada komunitas yang Anda ikuti.<br>Klik "<strong>+ Komunitas</strong>" atau beralih ke tab "<strong>Jelajahi Semua</strong>"!'}</p>
      </div>
    `;
    return;
  }

  const cardsHtml = communities.map((comm) => {
    const memberCount = comm.members?.length || 0;
    const isMember = comm.members?.some((m) => m.user_id === state.currentUser?.id);
    const isOwnerOrAdmin = comm.members?.some(
      (m) => m.user_id === state.currentUser?.id && (m.role === 'COMMUNITY_OWNER' || m.role === 'COMMUNITY_ADMIN')
    );
    const isCommActive = state.activeCommunity?.id === comm.id && !state.activeChat;

    const subgroupsHtml = (comm.groups || []).map((cg) => {
      const g = cg.group;
      const isAnnounce = cg.is_announcement || g.is_announcement;
      const isSubgroupActive = state.activeChat?.type === 'group' && state.activeChat.id === g.id;
      return `
        <div class="subgroup-item ${isSubgroupActive ? 'active' : ''}" onclick="event.stopPropagation(); selectSubgroupChat(${g.id}, ${comm.id})">
          <span class="subgroup-name">
            ${isAnnounce ? '📢' : '💬'} ${escapeHtml(g.name)}
            ${isAnnounce ? '<span class="badge-announcement">Pengumuman</span>' : ''}
          </span>
          <span style="font-size:0.75rem; color:var(--text-muted);">${g._count?.members || 0} anggota</span>
        </div>
      `;
    }).join('');

    return `
      <div class="community-item ${isCommActive ? 'active' : ''}">
        <div class="community-header-item" style="cursor:pointer;" onclick="selectCommunityHub(${comm.id})">
          <div class="community-avatar">${(comm.name || 'C').charAt(0).toUpperCase()}</div>
          <div class="community-info">
            <div class="community-name">${escapeHtml(comm.name)}</div>
            <div class="community-meta">
              ${memberCount} Anggota • ${(comm.groups || []).length} Sub-grup
              ${!isMember ? '<span style="color:var(--primary); font-weight:600; margin-left:4px;">(Jelajah)</span>' : ''}
            </div>
          </div>
          ${isOwnerOrAdmin 
            ? `<button class="btn btn-outline btn-sm" style="padding:4px 8px; font-size:0.75rem;" onclick="event.stopPropagation(); openLinkGroupModal(${comm.id})" title="Tautkan Grup ke Komunitas">🔗 Tautkan</button>` 
            : (!isMember ? `<button class="btn btn-primary btn-sm" style="padding:4px 8px; font-size:0.75rem;" onclick="event.stopPropagation(); handleJoinCommunity(${comm.id})" title="Gabung Komunitas">➕ Gabung</button>` : '')
          }
        </div>
        <div class="community-subgroups-list">
          ${subgroupsHtml || '<div style="padding:8px 12px; font-size:0.75rem; color:var(--text-muted);">Belum ada sub-grup tertaut.</div>'}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = filterPills + cardsHtml;
}

async function selectSubgroupChat(groupId, communityId = null) {
  let group = state.groups.find((g) => g.id === groupId);
  if (!group) {
    const allGroups = await api.getMyGroups();
    state.groups = allGroups || [];
    group = state.groups.find((g) => g.id === groupId);
  }
  if (group) {
    selectGroupChat(groupId, communityId);
  } else {
    if (confirm('Anda belum terdaftar di sub-grup ini. Kirim permintaan bergabung?')) {
      handleRequestJoinSubgroup(groupId, communityId);
    }
  }
}

// ==========================================================================
// Community Hub Management (FR-COM-01 s/d FR-COM-05)
// ==========================================================================
async function selectCommunityHub(communityId) {
  try {
    // Hide empty state and active chat window, show community hub window
    document.getElementById('chat-empty-state').classList.add('hidden');
    document.getElementById('chat-active-window').classList.add('hidden');
    const hub = document.getElementById('community-active-window');
    hub.classList.remove('hidden');

    state.activeChat = null;
    state.activeCommunity = { id: communityId };

    // Ensure activeTab is communities and UI tab button is active
    if (state.activeTab !== 'communities') {
      state.activeTab = 'communities';
      document.getElementById('tab-groups')?.classList.remove('active');
      document.getElementById('tab-pc')?.classList.remove('active');
      document.getElementById('tab-communities')?.classList.add('active');
      const btnNewChatLabel = document.getElementById('btn-new-chat-label');
      if (btnNewChatLabel) btnNewChatLabel.textContent = '+ Komunitas';
      const btnJoinByLink = document.getElementById('btn-join-by-link');
      if (btnJoinByLink) btnJoinByLink.style.display = 'none';
    }

    // Always re-render community sidebar so it never shows group list
    if (state.communities && state.communities.length > 0) {
      renderCommunityList(state.communities);
    } else {
      loadConversations();
    }

    // Fetch full community details
    const comm = await api.getCommunityDetails(communityId);
    state.activeCommunity = comm;

    // Render Hub Header
    const avatarEl = document.getElementById('community-hub-avatar');
    const nameEl = document.getElementById('community-hub-name');
    const descEl = document.getElementById('community-hub-desc');
    const statsEl = document.getElementById('community-hub-stats');
    const actionsEl = document.getElementById('community-hub-actions');

    if (avatarEl) avatarEl.textContent = (comm.name || 'C').charAt(0).toUpperCase();
    if (nameEl) nameEl.textContent = comm.name;
    if (descEl) descEl.textContent = comm.description || 'Komunitas obrolan untuk berdiskusi dan berbagi informasi.';

    const creatorName = comm.creator?.biodata
      ? `${comm.creator.biodata.first_name} ${comm.creator.biodata.last_name}`
      : (comm.creator?.email || 'Admin');

    if (statsEl) {
      statsEl.innerHTML = `
        <span>👥 ${comm.members?.length || 0} Anggota</span> • 
        <span>📂 ${(comm.groups || []).length} Sub-grup</span> • 
        <span>Dibuat oleh: <strong>${escapeHtml(creatorName)}</strong></span>
      `;
    }

    if (actionsEl) {
      if (!comm.isMember) {
        actionsEl.innerHTML = `
          <button class="btn btn-primary" onclick="handleJoinCommunity(${comm.id})">
            <span>➕ Gabung Komunitas</span>
          </button>
        `;
      } else {
        let adminBtns = '';
        if (comm.isAdmin) {
          adminBtns = `
            <button class="btn btn-outline btn-sm" onclick="openLinkGroupModal(${comm.id})" title="Tautkan grup yang Anda kelola">
              <span>🔗 Tautkan Grup</span>
            </button>
            <button class="btn btn-outline btn-sm" onclick="openCommunityMembersModal(${comm.id})" title="Kelola anggota komunitas">
              <span>👥 Kelola Anggota</span>
            </button>
          `;
        }
        actionsEl.innerHTML = `
          <span class="badge-role badge-member" style="padding:6px 12px; font-size:0.8rem;">✓ Anggota Komunitas</span>
          ${adminBtns}
        `;
      }
    }

    // Render Announcement Card (FR-COM-02)
    const annGroupObj = (comm.groups || []).find((cg) => cg.is_announcement || cg.group?.is_announcement);
    const annNameEl = document.getElementById('announcement-group-name');
    const annDescEl = document.getElementById('announcement-group-desc');
    const btnOpenAnn = document.getElementById('btn-open-announcement');

    if (annGroupObj) {
      if (annNameEl) annNameEl.textContent = annGroupObj.group?.name || 'Saluran Pengumuman';
      if (annDescEl) annDescEl.textContent = annGroupObj.group?.description || 'Ruang obrolan resmi. Hanya pengurus komunitas yang dapat mengirim pengumuman.';
      if (btnOpenAnn) {
        btnOpenAnn.onclick = () => selectGroupChat(annGroupObj.group_id, comm.id);
      }
    }

    // Render Sub-groups Grid (FR-COM-04)
    const subgroupsContainer = document.getElementById('community-subgroups-grid');
    const countBadge = document.getElementById('community-subgroups-count');
    const regularGroups = (comm.groups || []).filter((cg) => !cg.is_announcement && !cg.group?.is_announcement);

    if (countBadge) {
      countBadge.textContent = `${regularGroups.length} Sub-grup`;
    }

    if (subgroupsContainer) {
      if (regularGroups.length === 0) {
        subgroupsContainer.innerHTML = `
          <div class="empty-state" style="grid-column: 1 / -1; padding: 28px 16px;">
            <div style="font-size:2.2rem; margin-bottom:10px;">📂</div>
            <h4 style="margin:0 0 6px 0;">Belum ada sub-grup obrolan</h4>
            <p style="margin:0; font-size:0.85rem; color:var(--text-secondary);">
              Komunitas ini belum memiliki sub-grup obrolan tambahan.
            </p>
            ${comm.isAdmin ? `<button class="btn btn-outline btn-sm" style="margin-top:14px;" onclick="openLinkGroupModal(${comm.id})">🔗 Tautkan Grup Sekarang</button>` : ''}
          </div>
        `;
      } else {
        subgroupsContainer.innerHTML = regularGroups.map((cg) => {
          const g = cg.group;
          const isMemberOfSubgroup = g.members && g.members.length > 0;
          return `
            <div class="subgroup-card">
              <div class="subgroup-card-top">
                <div class="subgroup-card-header">
                  <h4 class="subgroup-card-title">💬 ${escapeHtml(g.name)}</h4>
                  ${isMemberOfSubgroup ? '<span class="badge-role badge-member" style="font-size:0.68rem; padding:2px 6px;">✓ Terdaftar</span>' : ''}
                </div>
                <p class="subgroup-card-desc">${escapeHtml(g.description || 'Sub-grup diskusi obrolan.')}</p>
              </div>
              <div class="subgroup-card-footer">
                <span style="font-size:0.75rem; color:var(--text-muted);">👥 ${g._count?.members || 0} Anggota</span>
                ${isMemberOfSubgroup 
                  ? `<button class="btn btn-primary btn-sm" onclick="selectGroupChat(${g.id}, ${comm.id})">💬 Masuk Obrolan</button>` 
                  : `<button class="btn btn-outline btn-sm" onclick="handleRequestJoinSubgroup(${g.id}, ${comm.id})">📩 Minta Gabung</button>`
                }
              </div>
            </div>
          `;
        }).join('');
      }
    }
  } catch (err) {
    showToast('Gagal Memuat Komunitas', err.message, 'error', '❌');
  }
}

async function handleJoinCommunity(communityId) {
  try {
    const res = await api.joinCommunity(communityId);
    showToast('Bergabung Komunitas', res.message || 'Berhasil bergabung ke komunitas!', 'success', '🎉');
    await loadConversations();
    selectCommunityHub(communityId);
  } catch (err) {
    showToast('Gagal Bergabung', err.message, 'error', '❌');
  }
}

async function handleRequestJoinSubgroup(groupId, communityId) {
  try {
    const res = await api.joinGroup(groupId);
    showToast('Permintaan Bergabung', res.message || 'Permintaan bergabung ke sub-grup telah dikirim.', 'info', '📩');
    await loadConversations();
    if (communityId) selectCommunityHub(communityId);
  } catch (err) {
    showToast('Gagal Bergabung', err.message, 'error', '❌');
  }
}

async function openCommunityMembersModal(communityId) {
  try {
    const comm = await api.getCommunityDetails(communityId);
    openModal('modal-community-members');
    const listContainer = document.getElementById('community-members-list');
    const titleEl = document.getElementById('community-members-modal-title');
    if (titleEl) titleEl.textContent = `👥 Anggota Komunitas: ${escapeHtml(comm.name)}`;

    const currentUserId = state.currentUser?.id;

    listContainer.innerHTML = (comm.members || []).map((m) => {
      const u = m.user;
      const name = u?.biodata ? `${u.biodata.first_name} ${u.biodata.last_name}` : (u?.email || 'Pengguna');
      const isSelf = m.user_id === currentUserId;
      const isMemberOwner = m.role === 'COMMUNITY_OWNER';
      const canRemove = (comm.isAdmin && !isMemberOwner && !isSelf);

      let roleLabel = 'Anggota';
      let roleClass = 'badge-member';
      if (m.role === 'COMMUNITY_OWNER') {
        roleLabel = 'Owner';
        roleClass = 'badge-owner';
      } else if (m.role === 'COMMUNITY_ADMIN') {
        roleLabel = 'Admin';
        roleClass = 'badge-admin';
      }

      return `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:rgba(255,255,255,0.03); border-radius:var(--radius-sm); border:1px solid var(--border-color);">
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="conv-avatar user" style="width:34px; height:34px; font-size:0.9rem;">${(name.charAt(0) || 'U').toUpperCase()}</div>
            <div>
              <div style="font-size:0.85rem; font-weight:600; color:var(--text-primary);">${escapeHtml(name)} ${isSelf ? '<span style="font-size:0.75rem; color:var(--text-muted);">(Anda)</span>' : ''}</div>
              <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(u?.email || '')}</div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="badge-role ${roleClass}">${roleLabel}</span>
            ${canRemove ? `
              <button class="btn btn-outline btn-sm" style="color:#f87171; border-color:rgba(239,68,68,0.4); padding:3px 8px; font-size:0.72rem;" onclick="handleRemoveCommunityMember(${comm.id}, ${m.user_id}, '${escapeHtml(name)}')">
                Keluarkan
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    showToast('Gagal Memuat Anggota', err.message, 'error', '❌');
  }
}

async function handleRemoveCommunityMember(communityId, targetUserId, userName) {
  if (!confirm(`Keluarkan ${userName} dari komunitas dan seluruh sub-grupnya (FR-COM-05)?`)) return;
  try {
    const res = await api.removeCommunityMember(communityId, targetUserId);
    showToast('Anggota Dikeluarkan', res.message || 'Anggota berhasil dikeluarkan dari komunitas dan seluruh sub-grupnya.', 'info', '👋');
    openCommunityMembersModal(communityId);
    selectCommunityHub(communityId);
    loadConversations();
  } catch (err) {
    showToast('Gagal Mengeluarkan', err.message, 'error', '❌');
  }
}

function filterConversations(query) {
  if (state.activeTab === 'groups') {
    const filtered = state.groups.filter((g) => g.name.toLowerCase().includes(query));
    renderGroupList(filtered);
  } else if (state.activeTab === 'pc') {
    const filtered = state.conversations.filter((u) => {
      const name = u.biodata ? `${u.biodata.first_name} ${u.biodata.last_name}` : u.email;
      return name.toLowerCase().includes(query) || u.email.toLowerCase().includes(query);
    });
    renderPCList(filtered);
  } else if (state.activeTab === 'communities') {
    const filtered = state.communities.filter((c) => c.name.toLowerCase().includes(query));
    renderCommunityList(filtered);
  }
}

// ==========================================================================
// Active Chat Window Management
// ==========================================================================
async function selectGroupChat(groupId, communityId = null) {
  let group = state.groups.find((g) => g.id === groupId);
  if (!group) {
    const allGroups = await api.getMyGroups();
    state.groups = allGroups || [];
    group = state.groups.find((g) => g.id === groupId);
  }
  if (!group) {
    try {
      group = await api.getGroupDetails(groupId);
    } catch (e) {
      showToast('Gagal Membuka Grup', 'Anda tidak memiliki akses ke sub-grup ini.', 'error', '❌');
      return;
    }
  }

  state.activeChat = { type: 'group', id: groupId, data: group };

  // Hide community hub window if open
  document.getElementById('community-active-window')?.classList.add('hidden');

  // Handle Community Back Button & Badge
  const btnBackCommunity = document.getElementById('btn-back-to-community');
  const communityBadge = document.getElementById('active-chat-community-badge');
  const linkedCommunityId = communityId || state.activeCommunity?.id;

  if (linkedCommunityId) {
    if (btnBackCommunity) {
      btnBackCommunity.classList.remove('hidden');
      btnBackCommunity.onclick = () => selectCommunityHub(linkedCommunityId);
    }
    if (communityBadge) communityBadge.classList.remove('hidden');
  } else {
    if (btnBackCommunity) btnBackCommunity.classList.add('hidden');
    if (communityBadge) communityBadge.classList.add('hidden');
  }

  // Update sidebar active class: preserve community view if opened from community context
  if (linkedCommunityId || state.activeTab === 'communities') {
    renderCommunityList(state.communities);
  } else {
    renderGroupList(state.groups);
  }

  // Close mobile sidebar if open
  document.getElementById('app-sidebar').classList.remove('open');

  // Join WebSocket group room
  socketClient.joinGroupRoom(groupId);

  // Setup Chat Header
  document.getElementById('chat-empty-state').classList.add('hidden');
  document.getElementById('chat-active-window').classList.remove('hidden');

  const groupAvatarEl = document.getElementById('active-chat-avatar');
  groupAvatarEl.textContent = (group.name || 'G').charAt(0).toUpperCase();
  groupAvatarEl.className = 'chat-avatar';
  groupAvatarEl.onclick = null;
  groupAvatarEl.title = '';
  
  const groupTitleEl = document.getElementById('active-chat-title');
  groupTitleEl.textContent = group.name;
  groupTitleEl.onclick = null;
  groupTitleEl.title = '';
  document.getElementById('active-chat-subtitle').textContent = `${group.members?.length || 0} Anggota`;

  const currentMember = (group.members || []).find((m) => m.user_id === state.currentUser?.id);
  const isStaff =
    (currentMember && (currentMember.role === 'OWNER' || currentMember.role === 'ADMIN')) ||
    state.currentUser?.biodata?.role === 'ADMIN';

  // Check announcement restrictions (FR-COM-02)
  const isAnnouncement = group.is_announcement || group.only_admins_can_post;
  const isReadOnlyForMe = isAnnouncement && !isStaff;
  const banner = document.getElementById('announcement-readonly-banner');
  const inputMessage = document.getElementById('input-message');
  const btnSend = document.getElementById('btn-send');

  if (isReadOnlyForMe) {
    if (banner) banner.classList.remove('hidden');
    if (inputMessage) {
      inputMessage.disabled = true;
      inputMessage.placeholder = 'Hanya pengurus/admin yang dapat mengirim pesan di grup pengumuman ini.';
    }
    if (btnSend) btnSend.disabled = true;
  } else {
    if (banner) banner.classList.add('hidden');
    if (inputMessage) {
      inputMessage.disabled = false;
      inputMessage.placeholder = 'Ketik pesan Anda di sini... (Tekan Enter untuk kirim)';
    }
    if (btnSend) btnSend.disabled = false;
  }

  // Header action buttons (Panggilan, Ekspor, Tambah, Tautan, Detail)
  const actionsContainer = document.getElementById('chat-header-actions');
  actionsContainer.innerHTML = `
    <button class="btn btn-outline btn-sm" onclick="webrtcManager.startGroupCall(${groupId}, '${escapeHtml(group.name)}')" title="Mulai Panggilan Suara Grup">📞 Panggilan</button>
    <button class="btn btn-outline btn-sm" onclick="openExportModal('group', ${groupId})" title="Unduh Arsip Chat">📥 Ekspor</button>
    ${isStaff ? `<button class="btn btn-outline btn-sm" onclick="openAddMemberModal(${groupId})">➕ Tambah</button>` : ''}
    ${isStaff ? `<button class="btn btn-outline btn-sm" onclick="openGroupInviteModal(${groupId})">🔗 Tautan</button>` : ''}
    <button class="btn btn-outline btn-sm" onclick="toggleInfoDrawer()">ℹ️ Detail</button>
  `;

  // Render info drawer
  renderGroupInfoDrawer(group);

  // Fetch and display messages
  await loadChatMessages();
}

async function selectPCChat(userId) {
  let contact = state.conversations.find((u) => u.id === userId);
  if (!contact) {
    // If not in conversations, fetch from cache or API
    contact = state.usersCache.find((u) => u.id === userId);
    if (!contact) {
      contact = await api.getUserById(userId);
    }
  }

  state.activeChat = { type: 'pc', id: userId, data: contact };

  // Hide community hub window
  document.getElementById('community-active-window')?.classList.add('hidden');
  document.getElementById('btn-back-to-community')?.classList.add('hidden');
  document.getElementById('active-chat-community-badge')?.classList.add('hidden');

  // Reset announcement banner and restore input
  const banner = document.getElementById('announcement-readonly-banner');
  const inputMessage = document.getElementById('input-message');
  const btnSend = document.getElementById('btn-send');
  if (banner) banner.classList.add('hidden');
  if (inputMessage) {
    inputMessage.disabled = false;
    inputMessage.placeholder = 'Ketik pesan Anda di sini... (Tekan Enter untuk kirim)';
  }
  if (btnSend) btnSend.disabled = false;

  // Update sidebar
  renderPCList(state.conversations);
  document.getElementById('app-sidebar').classList.remove('open');

  // Setup Chat Header
  document.getElementById('chat-empty-state').classList.add('hidden');
  document.getElementById('chat-active-window').classList.remove('hidden');

  const name = contact.biodata ? `${contact.biodata.first_name} ${contact.biodata.last_name}` : contact.email;
  const avatarEl = document.getElementById('active-chat-avatar');
  if (contact.biodata?.avatar_url) {
    avatarEl.innerHTML = `<img src="${contact.biodata.avatar_url}" alt="${escapeHtml(name)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
  } else {
    avatarEl.textContent = name.charAt(0).toUpperCase();
  }
  avatarEl.className = 'chat-avatar user';
  avatarEl.style.cursor = 'pointer';
  avatarEl.title = 'Klik untuk melihat profil publik';
  avatarEl.onclick = () => showPublicProfile(userId);

  const titleEl = document.getElementById('active-chat-title');
  titleEl.textContent = name;
  titleEl.style.cursor = 'pointer';
  titleEl.title = 'Klik untuk melihat profil publik';
  titleEl.onclick = () => showPublicProfile(userId);

  document.getElementById('active-chat-subtitle').textContent = contact.email;

  document.getElementById('chat-header-actions').innerHTML = `
    <button class="btn btn-outline btn-sm" onclick="webrtcManager.startDirectCall(${userId}, '${escapeHtml(name)}')" title="Panggilan Suara Pribadi">📞 Panggilan</button>
    <button class="btn btn-outline btn-sm" onclick="openExportModal('pc', ${userId})" title="Unduh Arsip Chat">📥 Ekspor</button>
    <button class="btn btn-outline btn-sm" onclick="showPublicProfile(${userId})" title="Profil Publik">ℹ️ Profil</button>
  `;

  renderUserInfoDrawer(contact);
  await loadChatMessages();
  api.markDirectMessagesRead(userId).catch(() => {});
}

async function loadChatMessages() {
  const container = document.getElementById('chat-messages');
  container.innerHTML = '<div class="loading-spinner-wrapper"><span class="spinner"></span></div>';

  try {
    let messages = [];
    if (state.activeChat.type === 'group') {
      messages = await api.getGroupMessages(state.activeChat.id);
    } else {
      messages = await api.getDirectMessages(state.activeChat.id);
    }

    container.innerHTML = '';
    if (!messages || messages.length === 0) {
      container.innerHTML = '<div class="empty-state">Belum ada pesan. Jadilah yang pertama mengirim pesan!</div>';
      return;
    }

    messages.forEach((msg) => {
      appendMessageBubble(msg, msg.sender_id === state.currentUser?.id);
    });

    scrollToBottom();
  } catch (err) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

function appendMessageBubble(message, isOutgoing) {
  const container = document.getElementById('chat-messages');
  // Remove empty state if present
  const emptyEl = container.querySelector('.empty-state');
  if (emptyEl) emptyEl.remove();

  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${isOutgoing ? 'outgoing' : 'incoming'}`;

  const timeStr = message.created_at
    ? new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  let senderHeader = '';
  if (!isOutgoing) {
    const senderName = message.sender?.biodata
      ? `${message.sender.biodata.first_name} ${message.sender.biodata.last_name}`
      : message.sender?.email || 'Pengguna';
    senderHeader = `<div class="bubble-sender" style="cursor: pointer; text-decoration: underline;" onclick="showPublicProfile(${message.sender_id})" title="Lihat Profil">${escapeHtml(senderName)}</div>`;
  }

  let statusCheckmark = '';
  if (isOutgoing) {
    if (state.activeChat?.type === 'pc') {
      if (message.is_read) {
        statusCheckmark = '<span class="bubble-status status-read" title="Telah dibaca">✓✓</span>';
      } else if (message.is_sent_only) {
        statusCheckmark = '<span class="bubble-status status-sent" title="Terkirim ke server">✓</span>';
      } else {
        statusCheckmark = '<span class="bubble-status status-delivered" title="Tersampaikan">✓✓</span>';
      }
    } else {
      statusCheckmark = '<span class="bubble-status status-delivered" title="Terkirim ke grup">✓✓</span>';
    }
  }

  bubble.innerHTML = `
    ${senderHeader}
    <div class="bubble-content">
      ${escapeHtml(message.content)}
      <div class="bubble-meta">
        <span class="bubble-time">${timeStr}</span>
        ${statusCheckmark}
      </div>
    </div>
  `;

  container.appendChild(bubble);
  scrollToBottom();
}

function scrollToBottom() {
  const container = document.getElementById('chat-messages');
  container.scrollTop = container.scrollHeight;
}

async function handleSendMessage(e) {
  e.preventDefault();
  if (!state.activeChat) return;

  const input = document.getElementById('input-message');
  const content = input.value.trim();
  if (!content) return;

  input.value = '';

  try {
    if (state.activeChat.type === 'group') {
      await api.sendGroupMessage(state.activeChat.id, content);
    } else {
      await api.sendDirectMessage(state.activeChat.id, content);
    }
  } catch (err) {
    showToast('Gagal Mengirim', err.message, 'error', '❌');
  }
}

// ==========================================================================
// Info Drawer & Member Management
// ==========================================================================
function toggleInfoDrawer(forceOpen = null) {
  const drawer = document.getElementById('info-drawer');
  if (!drawer) return;
  if (forceOpen === true) {
    drawer.classList.remove('hidden');
  } else if (forceOpen === false) {
    drawer.classList.add('hidden');
  } else {
    drawer.classList.toggle('hidden');
  }
}

function renderGroupInfoDrawer(group) {
  const container = document.getElementById('info-drawer-content');
  if (!container) return;
  document.getElementById('info-drawer-title').textContent = 'Detail Grup';

  const currentMember = (group.members || []).find((m) => m.user_id === state.currentUser?.id);
  const myRole = currentMember?.role;
  const isSystemAdmin = state.currentUser?.biodata?.role === 'ADMIN';
  const isGroupStaff = isSystemAdmin || myRole === 'OWNER' || myRole === 'ADMIN';

  // Creator information
  const creatorMember = (group.members || []).find((m) => m.user_id === group.created_by_id);
  let creatorName = 'Pembuat Grup';
  if (creatorMember) {
    creatorName = creatorMember.user?.biodata
      ? `${creatorMember.user.biodata.first_name} ${creatorMember.user.biodata.last_name}`
      : creatorMember.user?.email || 'Pembuat Grup';
  } else if (group.created_by) {
    creatorName = group.created_by.biodata
      ? `${group.created_by.biodata.first_name} ${group.created_by.biodata.last_name}`
      : group.created_by.email || 'Pembuat Grup';
  }

  const memberListHtml = (group.members || []).map((m) => {
    const name = m.user?.biodata ? `${m.user.biodata.first_name} ${m.user.biodata.last_name}` : (m.user?.email || 'Pengguna');
    const isMe = m.user_id === state.currentUser?.id;
    const canRemove = !isMe && (isSystemAdmin || myRole === 'OWNER' || (myRole === 'ADMIN' && m.role === 'MEMBER'));

    let roleBadge = '<span class="badge-role-member">Anggota</span>';
    if (m.role === 'OWNER') {
      roleBadge = '<span class="badge-role-owner">👑 Owner</span>';
    } else if (m.role === 'ADMIN') {
      roleBadge = '<span class="badge-role-admin">⭐ Admin</span>';
    }

    return `
      <div class="drawer-member-item">
        <div class="drawer-member-info">
          <div class="drawer-member-avatar">
            ${name.charAt(0).toUpperCase()}
          </div>
          <div class="drawer-member-names">
            <div class="drawer-member-name">
              ${escapeHtml(name)} ${isMe ? '<span style="font-size:0.7rem; color:var(--primary); font-weight:normal;">(Anda)</span>' : ''}
            </div>
            <div class="drawer-member-email">${escapeHtml(m.user?.email || '')}</div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
          ${roleBadge}
          ${canRemove ? `<button class="btn btn-danger btn-sm" style="padding:3px 8px; font-size:0.75rem;" onclick="handleRemoveMember(${group.id}, ${m.user_id})" title="Keluarkan anggota">Keluarkan</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  let joinRequestsSectionHtml = '';
  if (isGroupStaff) {
    joinRequestsSectionHtml = `
      <div class="drawer-section">
        <div class="drawer-section-title">
          <span>Permintaan Bergabung</span>
          <span id="group-requests-badge" class="badge-status" style="font-size:0.7rem; background:rgba(99,102,241,0.15); color:var(--primary); border:1px solid rgba(99,102,241,0.3);">Memeriksa...</span>
        </div>
        <div id="group-requests-list" style="display:flex; flex-direction:column; gap:6px;">
          <p style="font-size:0.8rem; color:var(--text-muted);">Memeriksa permintaan...</p>
        </div>
      </div>
    `;
  }

  let staffActionsHtml = '';
  if (isGroupStaff) {
    staffActionsHtml = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
        <button class="btn btn-outline btn-sm" style="justify-content:center; padding:8px;" onclick="openAddMemberModal(${group.id})">➕ Tambah</button>
        <button class="btn btn-outline btn-sm" style="justify-content:center; padding:8px;" onclick="openGroupInviteModal(${group.id})">🔗 Tautan</button>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="drawer-hero">
      <div class="drawer-avatar">${(group.name || 'G').charAt(0).toUpperCase()}</div>
      <div class="drawer-title">${escapeHtml(group.name)}</div>
      <div class="drawer-subtitle">Dibuat oleh ${escapeHtml(creatorName)} • ${group.members?.length || 0} Anggota</div>
    </div>

    ${staffActionsHtml}

    <div class="drawer-section">
      <div class="drawer-section-title">Deskripsi</div>
      <div class="drawer-desc-box">
        ${escapeHtml(group.description || 'Tidak ada deskripsi untuk grup ini.')}
      </div>
    </div>

    ${joinRequestsSectionHtml}

    <div class="drawer-section">
      <div class="drawer-section-title">
        <span>Daftar Anggota</span>
        <span style="font-size:0.75rem; color:var(--text-muted); font-weight:normal;">${group.members?.length || 0} orang</span>
      </div>
      <div class="drawer-member-list">
        ${memberListHtml}
      </div>
    </div>

    <div style="margin-top:8px; padding-top:14px; border-top:1px solid var(--border-glass);">
      <button class="btn btn-outline btn-sm" style="color:var(--danger); border-color:rgba(239, 68, 68, 0.4); width:100%; justify-content:center; padding:9px;" onclick="handleLeaveGroup(${group.id})">🚪 Keluar dari Grup</button>
    </div>
  `;

  if (isGroupStaff) {
    loadGroupJoinRequests(group.id);
  }
}

async function loadGroupJoinRequests(groupId) {
  const listEl = document.getElementById('group-requests-list');
  const badgeEl = document.getElementById('group-requests-badge');
  if (!listEl) return;

  try {
    const requests = await api.getGroupJoinRequests(groupId);
    if (!requests || requests.length === 0) {
      if (badgeEl) {
        badgeEl.textContent = '0 Menunggu';
        badgeEl.style.background = 'rgba(255,255,255,0.05)';
        badgeEl.style.color = 'var(--text-muted)';
        badgeEl.style.border = '1px solid var(--border-glass)';
      }
      listEl.innerHTML = '<p style="font-size:0.8rem; color:var(--text-muted); padding:4px 0;">Tidak ada permintaan tertunda.</p>';
      return;
    }

    if (badgeEl) {
      badgeEl.textContent = `${requests.length} Menunggu`;
      badgeEl.style.background = 'rgba(234, 179, 8, 0.15)';
      badgeEl.style.color = '#eab308';
      badgeEl.style.border = '1px solid rgba(234, 179, 8, 0.3)';
    }

    listEl.innerHTML = requests.map((r) => {
      const name = r.user?.biodata ? `${r.user.biodata.first_name} ${r.user.biodata.last_name}` : (r.user?.email || 'Pengguna');
      return `
        <div class="drawer-request-item">
          <div style="min-width:0; flex:1;">
            <div style="font-size:0.85rem; font-weight:600; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(name)}</div>
            <div style="font-size:0.72rem; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(r.user?.email || '')}</div>
          </div>
          <div style="display:flex; gap:6px; flex-shrink:0;">
            <button class="btn btn-primary btn-sm" style="padding:4px 8px; font-size:0.75rem;" onclick="handleApproveJoinRequest(${groupId}, ${r.id})">Terima</button>
            <button class="btn btn-danger btn-sm" style="padding:4px 8px; font-size:0.75rem;" onclick="handleRejectJoinRequest(${groupId}, ${r.id})">Tolak</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    listEl.innerHTML = `<p style="font-size:0.8rem; color:var(--danger);">${escapeHtml(err.message)}</p>`;
  }
}

async function handleApproveJoinRequest(groupId, requestId) {
  try {
    await api.approveGroupJoinRequest(groupId, requestId);
    showToast('Permintaan Disetujui', 'Pengguna telah bergabung ke grup!', 'success', '🎉');
    await loadConversations();
    const updatedGroup = state.groups.find((g) => g.id === groupId);
    if (updatedGroup) {
      state.activeChat.data = updatedGroup;
      renderGroupInfoDrawer(updatedGroup);
    } else {
      loadGroupJoinRequests(groupId);
    }
  } catch (err) {
    showToast('Gagal Menyetujui', err.message, 'error', '❌');
  }
}

async function handleRejectJoinRequest(groupId, requestId) {
  try {
    await api.rejectGroupJoinRequest(groupId, requestId);
    showToast('Permintaan Ditolak', 'Permintaan bergabung telah ditolak.', 'info', 'ℹ️');
    loadGroupJoinRequests(groupId);
  } catch (err) {
    showToast('Gagal Menolak', err.message, 'error', '❌');
  }
}

async function handleLeaveGroup(groupId) {
  if (!confirm('Apakah Anda yakin ingin keluar dari grup ini?')) return;
  try {
    await api.leaveGroup(groupId, state.currentUser.id);
    showToast('Keluar Grup', 'Anda telah keluar dari grup.', 'info', '👋');
    toggleInfoDrawer(false);
    if (state.activeChat?.type === 'group' && state.activeChat?.id === groupId) {
      state.activeChat = null;
      document.getElementById('chat-active-window')?.classList.add('hidden');
      document.getElementById('chat-empty-state')?.classList.remove('hidden');
    }
    await loadConversations();
  } catch (err) {
    showToast('Gagal Keluar Grup', err.message, 'error', '❌');
  }
}

function renderUserInfoDrawer(user) {
  const container = document.getElementById('info-drawer-content');
  if (!container) return;
  document.getElementById('info-drawer-title').textContent = 'Profil Pengguna';

  const name = user.biodata ? `${user.biodata.first_name} ${user.biodata.last_name}` : user.email;

  container.innerHTML = `
    <div class="drawer-hero">
      <div class="drawer-avatar" style="background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);">
        ${name.charAt(0).toUpperCase()}
      </div>
      <div class="drawer-title">${escapeHtml(name)}</div>
      <div class="drawer-subtitle">${escapeHtml(user.email)}</div>
      <span class="badge-role-admin" style="margin-top:8px; display:inline-block;">ROLE: ${user.biodata?.role || 'USER'}</span>
    </div>
    <div class="drawer-section" style="margin-top:16px;">
      <div class="drawer-section-title">Informasi Kontak</div>
      <div class="drawer-desc-box">
        <p><strong>Email:</strong> ${escapeHtml(user.email)}</p>
        <p style="margin-top:6px;"><strong>Nama:</strong> ${escapeHtml(name)}</p>
      </div>
    </div>
  `;
}

async function handleCreateGroup(e) {
  e.preventDefault();
  const name = document.getElementById('group-name').value.trim();
  const description = document.getElementById('group-desc').value.trim();

  try {
    const newGroup = await api.createGroup(name, description);
    closeModal('modal-create-group');
    document.getElementById('form-create-group').reset();
    showToast('Grup Dibuat', `Grup "${name}" berhasil dibuat!`, 'success', '🎉');
    await loadConversations();
    selectGroupChat(newGroup.id);
  } catch (err) {
    showToast('Gagal Membuat Grup', err.message, 'error', '❌');
  }
}

async function openAddMemberModal(groupId) {
  openModal('modal-add-member');
  const select = document.getElementById('select-user-to-add');
  select.innerHTML = '<option value="">Memuat pengguna...</option>';

  try {
    const users = await api.getUsers();
    state.usersCache = users || [];

    // Filter out users who are already in the group
    const activeGroup = state.groups.find((g) => g.id === groupId);
    const existingMemberIds = (activeGroup?.members || []).map((m) => m.user_id);

    const availableUsers = users.filter((u) => !existingMemberIds.includes(u.id));

    select.innerHTML = '<option value="">-- Pilih Pengguna --</option>' +
      availableUsers.map((u) => {
        const name = u.biodata ? `${u.biodata.first_name} ${u.biodata.last_name}` : u.email;
        return `<option value="${u.id}">${escapeHtml(name)} (${escapeHtml(u.email)})</option>`;
      }).join('');
  } catch (err) {
    select.innerHTML = '<option value="">Gagal memuat pengguna</option>';
  }
}

async function handleAddMember(e) {
  e.preventDefault();
  if (!state.activeChat || state.activeChat.type !== 'group') return;

  const select = document.getElementById('select-user-to-add');
  const userId = select.value;
  if (!userId) return;

  try {
    await api.addGroupMember(state.activeChat.id, userId);
    closeModal('modal-add-member');
    showToast('Sukses', 'Anggota berhasil ditambahkan ke grup.', 'success', '👥');
    await loadConversations();
    selectGroupChat(state.activeChat.id);
  } catch (err) {
    showToast('Gagal Menambah Anggota', err.message, 'error', '❌');
  }
}

async function handleRemoveMember(groupId, userId) {
  if (!confirm('Apakah Anda yakin ingin mengeluarkan anggota ini dari grup?')) return;

  try {
    await api.removeGroupMember(groupId, userId);
    showToast('Anggota Dikeluarkan', 'Anggota telah dikeluarkan dari grup.', 'info', '⚠️');
    await loadConversations();
    selectGroupChat(groupId);
  } catch (err) {
    showToast('Gagal Mengeluarkan Anggota', err.message, 'error', '❌');
  }
}

function openJoinByLinkModal(initialCode = '') {
  openModal('modal-join-by-link');
  const input = document.getElementById('input-invite-code');
  const previewCard = document.getElementById('invite-preview-card');
  if (previewCard) previewCard.classList.add('hidden');
  if (input) {
    input.value = initialCode || '';
    if (initialCode) {
      handleCheckInvite();
    }
  }
}

async function handleCheckInvite(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('input-invite-code');
  let rawValue = (input?.value || '').trim();
  if (!rawValue) return;

  // Extract code if user pasted a link
  let code = rawValue;
  if (rawValue.includes('#invite=')) {
    code = rawValue.split('#invite=')[1].split('&')[0];
  } else if (rawValue.includes('/invite/')) {
    code = rawValue.split('/invite/')[1].split('?')[0].split('#')[0];
  }

  const previewCard = document.getElementById('invite-preview-card');
  const previewAvatar = document.getElementById('invite-preview-avatar');
  const previewName = document.getElementById('invite-preview-name');
  const previewDesc = document.getElementById('invite-preview-desc');
  const previewMeta = document.getElementById('invite-preview-meta');
  const previewAction = document.getElementById('invite-preview-action');

  if (!previewCard) return;

  previewCard.classList.remove('hidden');
  previewName.textContent = 'Memeriksa grup...';
  previewDesc.textContent = '';
  previewMeta.textContent = '';
  previewAction.innerHTML = '<span class="spinner" style="width:20px;height:20px;display:inline-block;"></span>';

  try {
    const group = await api.previewGroupByInvite(code);
    const initial = (group.name || 'G').charAt(0).toUpperCase();
    previewAvatar.textContent = initial;
    previewName.textContent = group.name;
    previewDesc.textContent = group.description || 'Tidak ada deskripsi grup.';
    previewMeta.textContent = `${group.member_count} Anggota`;

    const isMember = (group.member_ids || []).includes(state.currentUser?.id);
    const isPending = (group.pending_request_user_ids || []).includes(state.currentUser?.id);

    if (isMember) {
      previewAction.innerHTML = `
        <span class="badge-status badge-active" style="padding:6px 14px; font-size:0.85rem;">Sudah Bergabung</span>
        <div style="margin-top:8px;">
          <button class="btn btn-secondary btn-sm" onclick="closeModal('modal-join-by-link'); selectGroupChat(${group.id});">Buka Obrolan</button>
        </div>
      `;
    } else if (isPending) {
      previewAction.innerHTML = `
        <span class="badge-status" style="padding:6px 14px; font-size:0.85rem; background:rgba(234,179,8,0.15); color:#eab308; border:1px solid rgba(234,179,8,0.3);">⏳ Permintaan Menunggu Persetujuan</span>
      `;
    } else {
      previewAction.innerHTML = `
        <button class="btn btn-primary" onclick="handleRequestJoinByInvite('${escapeHtml(code)}')">Minta Bergabung</button>
      `;
    }
  } catch (err) {
    previewName.textContent = 'Grup Tidak Ditemukan';
    previewDesc.textContent = err.message || 'Tautan undangan tidak valid atau sudah ditarik oleh admin.';
    previewMeta.textContent = '';
    previewAction.innerHTML = '';
  }
}

async function handleRequestJoinByInvite(code) {
  try {
    const res = await api.requestJoinByInvite(code);
    showToast('Permintaan Terkirim', res.message || 'Permintaan bergabung telah dikirim ke Admin/Owner grup!', 'success', '⏳');
    const previewAction = document.getElementById('invite-preview-action');
    if (previewAction) {
      previewAction.innerHTML = `
        <span class="badge-status" style="padding:6px 14px; font-size:0.85rem; background:rgba(234,179,8,0.15); color:#eab308; border:1px solid rgba(234,179,8,0.3);">⏳ Permintaan Menunggu Persetujuan</span>
      `;
    }
  } catch (err) {
    showToast('Gagal Mengajukan', err.message, 'error', '❌');
  }
}

async function openGroupInviteModal(groupId) {
  try {
    const res = await api.getGroupInviteCode(groupId);
    state.currentInviteGroupId = groupId;
    const inviteLink = `${window.location.origin}/#invite=${res.invite_code}`;
    document.getElementById('input-display-invite-link').value = inviteLink;
    openModal('modal-group-invite');
  } catch (err) {
    showToast('Gagal Mengambil Tautan', err.message, 'error', '❌');
  }
}

async function copyInviteLink() {
  const input = document.getElementById('input-display-invite-link');
  if (!input || !input.value) return;

  try {
    await navigator.clipboard.writeText(input.value);
    showToast('Tautan Disalin', 'Tautan undangan berhasil disalin ke clipboard!', 'success', '📋');
  } catch {
    input.select();
    document.execCommand('copy');
    showToast('Tautan Disalin', 'Tautan undangan berhasil disalin ke clipboard!', 'success', '📋');
  }
}

async function handleRevokeInviteLink() {
  if (!state.currentInviteGroupId) return;
  if (!confirm('Apakah Anda yakin ingin menarik tautan ini? Calon anggota tidak akan bisa menggunakan tautan lama lagi.')) return;

  try {
    const res = await api.revokeGroupInviteCode(state.currentInviteGroupId);
    const newLink = `${window.location.origin}/#invite=${res.invite_code}`;
    document.getElementById('input-display-invite-link').value = newLink;
    showToast('Tautan Diperbarui', res.message || 'Tautan undangan lama telah ditarik dan tautan baru telah dibuat.', 'success', '🔄');
  } catch (err) {
    showToast('Gagal Menarik Tautan', err.message, 'error', '❌');
  }
}

async function handleLeaveGroup(groupId) {
  if (!confirm('Apakah Anda yakin ingin keluar dari grup ini?')) return;

  try {
    await api.leaveGroup(groupId, state.currentUser?.id);
    showToast('Keluar Grup', 'Anda telah keluar dari grup.', 'info', '🚪');
    const drawer = document.getElementById('info-drawer');
    if (drawer) drawer.classList.add('hidden');
    document.getElementById('chat-active-window').classList.add('hidden');
    document.getElementById('chat-empty-state').classList.remove('hidden');
    state.activeChat = null;
    await loadConversations();
  } catch (err) {
    showToast('Gagal Keluar Grup', err.message, 'error', '❌');
  }
}

function checkUrlInviteLink() {
  const hash = window.location.hash;
  if (hash && hash.startsWith('#invite=')) {
    const code = hash.replace('#invite=', '').trim();
    if (code) {
      openJoinByLinkModal(code);
    }
  }
}

async function openUserSelectModalForPC() {
  try {
    const users = await api.getUsers();
    state.usersCache = users || [];

    // Filter out self
    const otherUsers = (users || []).filter((u) => u.id !== state.currentUser?.id);

    let pickerModal = document.getElementById('modal-user-picker');
    if (!pickerModal) {
      pickerModal = document.createElement('div');
      pickerModal.id = 'modal-user-picker';
      pickerModal.className = 'modal-overlay';
      document.body.appendChild(pickerModal);
    }

    const renderList = (filter = '') => {
      const filtered = otherUsers.filter((u) => {
        const name = u.biodata ? `${u.biodata.first_name} ${u.biodata.last_name}` : u.email;
        return name.toLowerCase().includes(filter) || u.email.toLowerCase().includes(filter);
      });

      if (filtered.length === 0) {
        return '<p class="empty-state">Tidak ada pengguna yang cocok.</p>';
      }

      return filtered.map((u) => {
        const name = u.biodata ? `${u.biodata.first_name} ${u.biodata.last_name}` : u.email;
        const role = u.biodata?.role || 'USER';
        return `
          <button class="btn btn-outline btn-block" style="justify-content:space-between; margin-bottom:6px; text-align:left;" onclick="selectPCChat(${u.id}); closeModal('modal-user-picker');">
            <div>
              <strong>${escapeHtml(name)}</strong>
              <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(u.email)}</div>
            </div>
            <span class="user-role-badge">${role}</span>
          </button>
        `;
      }).join('');
    };

    pickerModal.innerHTML = `
      <div class="modal-dialog glass-panel">
        <div class="modal-header">
          <div>
            <h3>Pilih Pengguna untuk Pesan Pribadi (PC)</h3>
            <p class="subtitle-sm">Mulai obrolan 1-on-1 dengan pengguna lain</p>
          </div>
          <button class="btn-icon" onclick="closeModal('modal-user-picker')">✕</button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom:12px;">
            <input type="text" id="pc-user-search" placeholder="Cari nama atau email pengguna..." style="padding:8px 12px; font-size:0.85rem;">
          </div>
          <div id="pc-user-list-container" style="max-height:320px; overflow-y:auto;">
            ${renderList()}
          </div>
        </div>
      </div>
    `;

    pickerModal.classList.remove('hidden');

    const searchInput = document.getElementById('pc-user-search');
    searchInput.focus();
    searchInput.addEventListener('input', (e) => {
      document.getElementById('pc-user-list-container').innerHTML = renderList(e.target.value.toLowerCase().trim());
    });
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

// ==========================================================================
// Notifications Management
// ==========================================================================
async function loadNotifications() {
  try {
    const notifs = await api.getNotifications();
    state.notifications = notifs || [];
    renderNotifications();
  } catch (err) {
    console.error('Failed to load notifications:', err);
  }
}

function renderNotifications() {
  const container = document.getElementById('notification-list');
  const countBadge = document.getElementById('notification-count');

  const unread = state.notifications.filter((n) => !n.is_read);
  if (unread.length > 0) {
    countBadge.textContent = unread.length > 99 ? '99+' : unread.length;
    countBadge.classList.remove('hidden');
  } else {
    countBadge.classList.add('hidden');
  }

  if (state.notifications.length === 0) {
    container.innerHTML = '<div class="empty-state">Belum ada notifikasi</div>';
    return;
  }

  container.innerHTML = state.notifications.map((n) => {
    let icon = '🔔';
    if (n.type === 'USER_REGISTERED') icon = '👤';
    if (n.type === 'ADDED_TO_GROUP') icon = '🎉';
    if (n.type === 'REMOVED_FROM_GROUP') icon = '⚠️';
    if (n.type === 'USER_JOINED_GROUP') icon = '👥';
    if (n.type?.includes('COMMUNITY')) icon = '🌐';
    if (n.type?.includes('CALL')) icon = '📞';

    const timeStr = n.created_at
      ? new Date(n.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';

    const statusBadge = !n.is_read
      ? '<span class="notif-status-badge badge-unread">● Belum Dibaca</span>'
      : '<span class="notif-status-badge badge-read">✓ Telah Dibaca</span>';

    return `
      <div class="notification-item ${!n.is_read ? 'unread' : ''}" onclick="markNotificationRead(${n.id})">
        <div class="notification-icon">${icon}</div>
        <div class="notification-content">
          <div class="notification-title">${escapeHtml(n.title)}</div>
          <div class="notification-message">${escapeHtml(n.message)}</div>
          <div class="notification-meta">
            <span class="notification-time">${timeStr}</span>
            ${statusBadge}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function markNotificationRead(id) {
  try {
    await api.markNotificationRead(id);
    const target = state.notifications.find((n) => n.id === id);
    if (target) target.is_read = true;
    renderNotifications();
  } catch (err) {
    console.error(err);
  }
}

async function handleMarkAllNotificationsRead() {
  const unread = state.notifications.filter((n) => !n.is_read);
  for (const n of unread) {
    await api.markNotificationRead(n.id).catch(() => {});
    n.is_read = true;
  }
  renderNotifications();
  showToast('Notifikasi', 'Semua notifikasi ditandai dibaca.', 'info');
}

// ==========================================================================
// Admin Users Management
// ==========================================================================
// ==========================================================================
// User Profile & Avatar Management (FR-BIO-01, FR-BIO-02, FR-BIO-03, FR-BIO-04)
// ==========================================================================
async function openMyProfileModal() {
  try {
    const user = await api.getMe();
    state.currentUser = user;
    api.setUser(user);
    renderCurrentUser();

    const bio = user.biodata?.bio || '';
    document.getElementById('my-profile-firstname').value = user.biodata?.first_name || '';
    document.getElementById('my-profile-lastname').value = user.biodata?.last_name || '';
    document.getElementById('my-profile-phone').value = user.biodata?.phone || '';
    document.getElementById('my-profile-bio').value = bio;
    document.getElementById('bio-char-count').textContent = `${bio.length}/150`;

    const role = user.biodata?.role || 'USER';
    document.getElementById('my-profile-role-display').textContent = role;

    const groupDisplay = document.getElementById('my-profile-managed-group-display');
    if (user.managed_group) {
      groupDisplay.classList.remove('hidden');
      document.getElementById('my-profile-group-name').textContent = user.managed_group.name;
    } else {
      groupDisplay.classList.add('hidden');
    }

    // Avatar preview
    const imgPreview = document.getElementById('my-profile-avatar-img');
    const fallbackPreview = document.getElementById('my-profile-avatar-fallback');
    const btnDelete = document.getElementById('btn-delete-avatar');

    if (user.biodata?.avatar_url) {
      imgPreview.src = user.biodata.avatar_url;
      imgPreview.classList.remove('hidden');
      fallbackPreview.classList.add('hidden');
      btnDelete.classList.remove('hidden');
    } else {
      imgPreview.src = '';
      imgPreview.classList.add('hidden');
      fallbackPreview.textContent = (user.biodata?.first_name || 'U').charAt(0).toUpperCase();
      fallbackPreview.classList.remove('hidden');
      btnDelete.classList.add('hidden');
    }

    openModal('modal-my-profile');
  } catch (err) {
    showToast('Gagal Memuat Profil', err.message, 'error', '❌');
  }
}

async function handleSaveMyProfile(e) {
  e.preventDefault();
  const firstName = document.getElementById('my-profile-firstname').value.trim();
  const lastName = document.getElementById('my-profile-lastname').value.trim();
  const phone = document.getElementById('my-profile-phone').value.trim();
  const bio = document.getElementById('my-profile-bio').value.trim();

  if (bio.length > 150) {
    showToast('Bio Terlalu Panjang', 'Bio maksimal 150 karakter (FR-BIO-01).', 'error', '⚠️');
    return;
  }

  const btnSave = document.getElementById('btn-save-my-profile');
  const originalText = btnSave.innerHTML;
  btnSave.disabled = true;
  btnSave.innerHTML = 'Menyimpan... ⏳';

  try {
    const updated = await api.updateUser(state.currentUser.id, {
      first_name: firstName,
      last_name: lastName,
      phone,
      bio,
    });

    state.currentUser.biodata = updated.biodata;
    api.setUser(state.currentUser);
    renderCurrentUser();
    closeModal('modal-my-profile');
    showToast('Profil Disimpan', 'Data profil Anda berhasil diperbarui!', 'success', '💾');
  } catch (err) {
    showToast('Gagal Menyimpan Profil', err.message, 'error', '❌');
  } finally {
    btnSave.disabled = false;
    btnSave.innerHTML = originalText;
  }
}

async function handleAvatarFileChange(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  // Validate file size (2MB max, BR-AVATAR-01)
  if (file.size > 2 * 1024 * 1024) {
    showToast('Ukuran File Terlalu Besar', 'Batas maksimal foto profil adalah 2 MB (BR-AVATAR-01).', 'error', '⚠️');
    e.target.value = '';
    return;
  }

  // Validate extension
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
  if (!allowed.includes(file.type)) {
    showToast('Format Tidak Didukung', 'Format yang didukung: .jpg, .jpeg, .png, .webp (BR-AVATAR-01).', 'error', '⚠️');
    e.target.value = '';
    return;
  }

  const formData = new FormData();
  formData.append('avatar', file);

  try {
    const res = await api.uploadAvatar(formData);
    state.currentUser.biodata.avatar_url = res.avatar_url;
    api.setUser(state.currentUser);
    renderCurrentUser();

    const imgPreview = document.getElementById('my-profile-avatar-img');
    const fallbackPreview = document.getElementById('my-profile-avatar-fallback');
    const btnDelete = document.getElementById('btn-delete-avatar');

    imgPreview.src = res.avatar_url;
    imgPreview.classList.remove('hidden');
    fallbackPreview.classList.add('hidden');
    btnDelete.classList.remove('hidden');

    showToast('Foto Profil Diunggah', res.message || 'Foto profil berhasil diperbarui.', 'success', '📷');
  } catch (err) {
    showToast('Gagal Unggah Avatar', err.message, 'error', '❌');
  } finally {
    e.target.value = '';
  }
}

async function handleDeleteAvatar() {
  if (!confirm('Apakah Anda yakin ingin menghapus foto profil dan kembali ke inisial nama standar (FR-BIO-03)?')) return;

  try {
    await api.deleteAvatar();
    state.currentUser.biodata.avatar_url = null;
    api.setUser(state.currentUser);
    renderCurrentUser();

    const imgPreview = document.getElementById('my-profile-avatar-img');
    const fallbackPreview = document.getElementById('my-profile-avatar-fallback');
    const btnDelete = document.getElementById('btn-delete-avatar');

    imgPreview.src = '';
    imgPreview.classList.add('hidden');
    fallbackPreview.textContent = (state.currentUser?.biodata?.first_name || 'U').charAt(0).toUpperCase();
    fallbackPreview.classList.remove('hidden');
    btnDelete.classList.add('hidden');

    showToast('Foto Dihapus', 'Foto profil dihapus dan dikembalikan ke inisial standar.', 'info', '👤');
  } catch (err) {
    showToast('Gagal Menghapus Foto', err.message, 'error', '❌');
  }
}

// Public Profile Card (FR-BIO-04)
async function showPublicProfile(userId) {
  try {
    const profile = await api.getPublicProfile(userId);

    const imgEl = document.getElementById('public-profile-avatar-img');
    const fallbackEl = document.getElementById('public-profile-avatar-fallback');
    if (profile.avatar_url) {
      imgEl.src = profile.avatar_url;
      imgEl.classList.remove('hidden');
      fallbackEl.classList.add('hidden');
    } else {
      imgEl.src = '';
      imgEl.classList.add('hidden');
      fallbackEl.textContent = (profile.first_name || 'U').charAt(0).toUpperCase();
      fallbackEl.classList.remove('hidden');
    }

    const fullName = `${profile.first_name} ${profile.last_name}`.trim() || 'Pengguna';
    document.getElementById('public-profile-name').textContent = fullName;
    document.getElementById('public-profile-role-badge').textContent = profile.role;
    document.getElementById('public-profile-bio').textContent = profile.bio || 'Tidak ada bio.';

    const memberDate = profile.member_since ? new Date(profile.member_since).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }) : '-';
    document.getElementById('public-profile-member-since').textContent = `Bergabung sejak: ${memberDate}`;

    // Actions (Chat / Call)
    const actionsDiv = document.getElementById('public-profile-actions');
    const btnChat = document.getElementById('btn-public-profile-chat');
    const btnCall = document.getElementById('btn-public-profile-call');

    if (userId === state.currentUser?.id) {
      actionsDiv.classList.add('hidden');
    } else {
      actionsDiv.classList.remove('hidden');
      btnChat.onclick = () => {
        closeModal('modal-public-profile');
        selectPCChat(userId);
      };
      btnCall.onclick = () => {
        closeModal('modal-public-profile');
        webrtcManager.startDirectCall(userId, fullName);
      };
    }

    openModal('modal-public-profile');
  } catch (err) {
    showToast('Gagal Memuat Profil Publik', err.message, 'error', '❌');
  }
}

// ==========================================================================
// Admin Users Management (BR-ROLE-01 - BR-ROLE-02, FR-ROLE-01 - FR-ROLE-05)
// ==========================================================================
async function loadAdminUsersList() {
  const tbody = document.getElementById('table-users-body');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Memuat data pengguna...</td></tr>';

  const includeDeleted = document.getElementById('check-include-deleted').checked;
  const myRole = state.currentUser?.biodata?.role || 'USER';

  try {
    const users = await api.getUsers(includeDeleted);
    state.usersCache = users;

    if (!users || users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Tidak ada data pengguna.</td></tr>';
      return;
    }

    tbody.innerHTML = users.map((u) => {
      const name = u.biodata ? `${u.biodata.first_name} ${u.biodata.last_name}` : '-';
      const role = u.biodata?.role || 'USER';
      const isDeleted = !!u.deleted_at;
      const statusBadge = isDeleted
        ? '<span class="badge-status badge-deleted">Deleted</span>'
        : u.biodata?.is_active
        ? '<span class="badge-status badge-active">Aktif</span>'
        : '<span class="badge-status badge-deleted">Nonaktif</span>';

      const avatarHtml = u.biodata?.avatar_url
        ? `<img src="${u.biodata.avatar_url}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:6px;">`
        : `<span class="conv-avatar user" style="width:28px;height:28px;font-size:0.75rem;display:inline-flex;align-items:center;justify-content:center;margin-right:6px;">${(name.charAt(0) || 'U').toUpperCase()}</span>`;

      const groupManagedName = u.managed_group ? escapeHtml(u.managed_group.name) : '-';

      // Permission check for soft-delete
      let canDelete = false;
      if (!isDeleted && u.id !== state.currentUser?.id) {
        if (myRole === 'SUPER_ADMIN') {
          canDelete = true;
        } else if (myRole === 'ADMIN' && role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
          canDelete = true;
        }
      }

      return `
        <tr>
          <td>${u.id}</td>
          <td>
            <div style="display:flex; align-items:center; cursor:pointer;" onclick="showPublicProfile(${u.id})">
              ${avatarHtml}
              <strong>${escapeHtml(name)}</strong>
            </div>
          </td>
          <td>${escapeHtml(u.email)}</td>
          <td><span class="user-role-badge">${role}</span></td>
          <td><small style="color:var(--text-secondary);">${groupManagedName}</small></td>
          <td>${statusBadge}</td>
          <td>
            <button class="btn btn-outline btn-sm" onclick="openEditUserModal(${u.id})">Edit</button>
            ${canDelete ? `<button class="btn btn-danger btn-sm" onclick="handleSoftDeleteUser(${u.id})">Soft Delete</button>` : ''}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">${escapeHtml(err.message)}</td></tr>`;
  }
}

async function openRegisterUserModal() {
  const form = document.getElementById('form-register-user');
  form.reset();

  const myRole = state.currentUser?.biodata?.role || 'USER';
  const roleSelect = document.getElementById('reg-role');
  const adminNotice = document.getElementById('reg-admin-notice');
  const managedGroupWrapper = document.getElementById('group-managed-select-wrapper');
  const userGroupWrapper = document.getElementById('group-user-select-wrapper');

  if (myRole === 'SUPER_ADMIN') {
    // Super Admin can choose USER or ADMIN
    roleSelect.disabled = false;
    roleSelect.innerHTML = `
      <option value="USER">USER (Pengguna Grup)</option>
      <option value="ADMIN">ADMIN (Admin Grup)</option>
    `;
    adminNotice.classList.add('hidden');

    // Populate group dropdowns
    try {
      const allGroups = await api.getAllGroups();
      const optionsHtml = '<option value="">-- Pilih Grup --</option>' +
        (allGroups || []).map((g) => `<option value="${g.id}">${escapeHtml(g.name)} (#${g.id})</option>`).join('');

      document.getElementById('reg-managed-group').innerHTML = optionsHtml;
      document.getElementById('reg-user-group').innerHTML = '<option value="">-- Tanpa Grup Langsung --</option>' +
        (allGroups || []).map((g) => `<option value="${g.id}">${escapeHtml(g.name)} (#${g.id})</option>`).join('');
    } catch {
      // Fallback
    }

    handleRegRoleChange();
  } else if (myRole === 'ADMIN') {
    // Group Admin is locked to USER only (FR-ROLE-03)
    roleSelect.innerHTML = `<option value="USER" selected>USER (Pengguna Grup)</option>`;
    roleSelect.disabled = true;
    adminNotice.classList.remove('hidden');
    managedGroupWrapper.classList.add('hidden');
    userGroupWrapper.classList.add('hidden');
  }

  openModal('modal-register-user');
}

function handleRegRoleChange() {
  const role = document.getElementById('reg-role').value;
  const myRole = state.currentUser?.biodata?.role || 'USER';

  if (myRole === 'SUPER_ADMIN') {
    const managedGroupWrapper = document.getElementById('group-managed-select-wrapper');
    const userGroupWrapper = document.getElementById('group-user-select-wrapper');

    if (role === 'ADMIN') {
      managedGroupWrapper.classList.remove('hidden');
      userGroupWrapper.classList.add('hidden');
    } else {
      managedGroupWrapper.classList.add('hidden');
      userGroupWrapper.classList.remove('hidden');
    }
  }
}

async function handleAdminRegisterUser(e) {
  e.preventDefault();
  const firstName = document.getElementById('reg-firstname').value.trim();
  const lastName = document.getElementById('reg-lastname').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const phone = document.getElementById('reg-phone')?.value.trim() || undefined;
  const bio = document.getElementById('reg-bio')?.value.trim() || undefined;
  const role = document.getElementById('reg-role').value;

  const myRole = state.currentUser?.biodata?.role || 'USER';
  const payload = {
    first_name: firstName,
    last_name: lastName,
    email,
    password,
    role,
    phone,
    bio,
  };

  if (myRole === 'SUPER_ADMIN') {
    if (role === 'ADMIN') {
      const managedGroupId = document.getElementById('reg-managed-group').value;
      if (!managedGroupId) {
        showToast('Validasi Gagal', 'Super Admin wajib menetapkan grup yang dikelola untuk akun Admin (BR-ROLE-01).', 'error', '⚠️');
        return;
      }
      payload.managed_group_id = Number(managedGroupId);
    } else if (role === 'USER') {
      const groupId = document.getElementById('reg-user-group').value;
      if (groupId) {
        payload.group_id = Number(groupId);
      }
    }
  }

  try {
    await api.createUserByAdmin(payload);
    closeModal('modal-register-user');
    document.getElementById('form-register-user').reset();
    showToast('User Didaftarkan', `User "${email}" (${role}) berhasil didaftarkan!`, 'success', '👤');
    loadAdminUsersList();
    loadConversations();
  } catch (err) {
    showToast('Gagal Mendaftarkan', err.message, 'error', '❌');
  }
}

function openEditUserModal(userId) {
  const user = state.usersCache.find((u) => u.id === userId);
  if (!user) return;

  document.getElementById('edit-user-id').value = user.id;
  document.getElementById('edit-firstname').value = user.biodata?.first_name || '';
  document.getElementById('edit-lastname').value = user.biodata?.last_name || '';
  document.getElementById('edit-phone').value = user.biodata?.phone || '';
  document.getElementById('edit-bio').value = user.biodata?.bio || '';
  document.getElementById('edit-role').value = user.biodata?.role || 'USER';
  document.getElementById('edit-active').checked = user.biodata?.is_active !== false;

  const myRole = state.currentUser?.biodata?.role || 'USER';
  const roleWrapper = document.getElementById('edit-role-wrapper');
  if (roleWrapper) {
    roleWrapper.style.display = myRole === 'SUPER_ADMIN' ? 'block' : 'none';
  }

  openModal('modal-edit-user');
}

async function handleEditUser(e) {
  e.preventDefault();
  const id = document.getElementById('edit-user-id').value;
  const firstName = document.getElementById('edit-firstname').value.trim();
  const lastName = document.getElementById('edit-lastname').value.trim();
  const phone = document.getElementById('edit-phone').value.trim();
  const bio = document.getElementById('edit-bio').value.trim();
  const role = document.getElementById('edit-role').value;
  const isActive = document.getElementById('edit-active').checked;

  try {
    await api.updateUser(id, {
      first_name: firstName,
      last_name: lastName,
      phone,
      bio,
      role,
      is_active: isActive,
    });

    closeModal('modal-edit-user');
    showToast('Sukses', 'Data pengguna berhasil diperbarui.', 'success', '✅');
    loadAdminUsersList();
  } catch (err) {
    showToast('Gagal Memperbarui', err.message, 'error', '❌');
  }
}

async function handleSoftDeleteUser(userId) {
  if (!confirm('Apakah Anda yakin ingin melakukan soft-delete pada pengguna ini?')) return;

  try {
    await api.softDeleteUser(userId);
    showToast('Soft Delete Berhasil', `Pengguna ID ${userId} berhasil di-soft delete (FR-ROLE-05).`, 'info', '🗑️');
    loadAdminUsersList();
  } catch (err) {
    showToast('Gagal Menghapus', err.message, 'error', '❌');
  }
}

// ==========================================================================
// Modal Helpers
// ==========================================================================
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('hidden');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('hidden');
}

// ==========================================================================
// Chat Export Handlers (FR-EXP-01 s/d FR-EXP-04)
// ==========================================================================
let currentExportContext = { type: 'group', id: null };

function openExportModal(type, id) {
  currentExportContext = { type, id };
  openModal('modal-export-chat');
  const txtRadio = document.querySelector('input[name="export-format"][value="txt"]');
  const allRadio = document.querySelector('input[name="export-range"][value="all"]');
  if (txtRadio) txtRadio.checked = true;
  if (allRadio) allRadio.checked = true;
  toggleExportDateInputs(false);
  const startInput = document.getElementById('export-start-date');
  const endInput = document.getElementById('export-end-date');
  if (startInput) startInput.value = '';
  if (endInput) endInput.value = '';
}

function toggleExportDateInputs(show) {
  const fields = document.getElementById('export-date-fields');
  if (fields) {
    if (show) fields.classList.remove('hidden');
    else fields.classList.add('hidden');
  }
}

async function handleExportSubmit(e) {
  e.preventDefault();
  if (!currentExportContext.id) return;

  const format = document.querySelector('input[name="export-format"]:checked')?.value || 'txt';
  const rangeType = document.querySelector('input[name="export-range"]:checked')?.value || 'all';
  const startDate = rangeType === 'range' ? document.getElementById('export-start-date').value : '';
  const endDate = rangeType === 'range' ? document.getElementById('export-end-date').value : '';

  const submitBtn = document.getElementById('btn-submit-export');
  const originalText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = 'Mengunduh... ⏳';

  try {
    let result;
    if (currentExportContext.type === 'group') {
      result = await api.exportGroupChat(currentExportContext.id, format, startDate, endDate);
    } else {
      result = await api.exportPCChat(currentExportContext.id, format, startDate, endDate);
    }

    // Trigger browser file download
    const url = window.URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);

    closeModal('modal-export-chat');
    showToast('Ekspor Berhasil', `Berkas ${result.filename} berhasil diunduh.`, 'success', '💾');
  } catch (err) {
    showToast('Gagal Ekspor', err.message, 'error', '❌');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalText;
  }
}

// ==========================================================================
// Community Handlers (FR-COM-01 s/d FR-COM-05)
// ==========================================================================
let activeCommunityIdForLink = null;

async function openLinkGroupModal(communityId) {
  activeCommunityIdForLink = communityId;
  openModal('modal-link-group');
  const select = document.getElementById('select-group-to-link');
  select.innerHTML = '<option value="">Memuat grup yang Anda kelola...</option>';

  try {
    // Filter groups where current user is OWNER or ADMIN
    const myGroups = await api.getMyGroups();
    const managedGroups = (myGroups || []).filter((g) => {
      const mem = (g.members || []).find((m) => m.user_id === state.currentUser?.id);
      return mem && (mem.role === 'OWNER' || mem.role === 'ADMIN');
    });

    if (managedGroups.length === 0) {
      select.innerHTML = '<option value="">Tidak ada grup yang Anda kelola (Owner/Admin)</option>';
      return;
    }

    select.innerHTML = '<option value="">-- Pilih Grup yang Dikelola --</option>' +
      managedGroups.map((g) => `<option value="${g.id}">${escapeHtml(g.name)} (${g.members?.length || 0} anggota)</option>`).join('');
  } catch (err) {
    select.innerHTML = '<option value="">Gagal memuat grup</option>';
  }
}

async function handleLinkGroupSubmit(e) {
  e.preventDefault();
  if (!activeCommunityIdForLink) return;

  const select = document.getElementById('select-group-to-link');
  const groupId = select.value;
  if (!groupId) return;

  try {
    const res = await api.linkGroupToCommunity(activeCommunityIdForLink, groupId);
    closeModal('modal-link-group');
    showToast('Grup Ditautkan', res.message, 'success', '🔗');
    await loadConversations();
    selectCommunityHub(activeCommunityIdForLink);
  } catch (err) {
    showToast('Gagal Menautkan', err.message, 'error', '❌');
  }
}

async function handleCreateCommunitySubmit(e) {
  e.preventDefault();
  const name = document.getElementById('community-name').value.trim();
  const description = document.getElementById('community-desc').value.trim();
  if (!name) return;

  try {
    const newCommunity = await api.createCommunity(name, description);
    closeModal('modal-create-community');
    document.getElementById('form-create-community').reset();
    showToast('Komunitas Dibuat', `Komunitas "${name}" berhasil dibuat dengan sub-grup Pengumuman default!`, 'success', '🎉');
    await loadConversations();
    selectCommunityHub(newCommunity.id);
  } catch (err) {
    showToast('Gagal Membuat Komunitas', err.message, 'error', '❌');
  }
}
