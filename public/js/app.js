/**
 * ChatSphere - Main Application Controller
 */

// Global State
const state = {
  currentUser: null,
  activeTab: 'groups', // 'groups' | 'pc'
  activeChat: null,    // { type: 'group' | 'pc', id: number, data: any }
  groups: [],
  conversations: [],
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

  // Sidebar Tabs (Group vs PC)
  document.getElementById('tab-groups').addEventListener('click', () => switchTab('groups'));
  document.getElementById('tab-pc').addEventListener('click', () => switchTab('pc'));

  // Search input filter
  document.getElementById('input-search-chat').addEventListener('input', (e) => {
    filterConversations(e.target.value.toLowerCase());
  });

  // Create Group / New Chat button
  document.getElementById('btn-new-chat').addEventListener('click', () => {
    if (state.activeTab === 'groups') {
      openModal('modal-create-group');
    } else {
      openUserSelectModalForPC();
    }
  });

  // Create Group Form
  document.getElementById('form-create-group').addEventListener('submit', handleCreateGroup);

  // Add Member Form
  document.getElementById('form-add-member').addEventListener('submit', handleAddMember);

  // Send Message Form
  document.getElementById('form-send-message').addEventListener('submit', handleSendMessage);

  // Notifications Bell Toggle
  const bellBtn = document.getElementById('btn-notification-bell');
  const notifDropdown = document.getElementById('notification-dropdown');
  bellBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    notifDropdown.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!notifDropdown.contains(e.target) && e.target !== bellBtn) {
      notifDropdown.classList.add('hidden');
    }
  });

  document.getElementById('btn-mark-all-read').addEventListener('click', handleMarkAllNotificationsRead);

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
    openModal('modal-register-user');
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

    showToast(notif.title, notif.message, 'notification', icon);

    // Refresh groups/members if relevant
    if (notif.type === 'ADDED_TO_GROUP' || notif.type === 'REMOVED_FROM_GROUP') {
      loadConversations();
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

  document.getElementById('current-user-avatar').textContent = firstName.charAt(0).toUpperCase();
  document.getElementById('current-user-name').textContent = `${firstName} ${lastName}`.trim();
  document.getElementById('current-user-role').textContent = role;

  // Show Admin Panel Button if ADMIN
  const adminBtn = document.getElementById('btn-open-admin');
  if (role === 'ADMIN') {
    adminBtn.classList.remove('hidden');
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

  const btnNewChatLabel = document.getElementById('btn-new-chat-label');
  btnNewChatLabel.textContent = tab === 'groups' ? '+ Grup' : '+ Pesan PC';

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
    } else {
      const convos = await api.getConversations();
      state.conversations = convos || [];
      renderPCList(state.conversations);
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

    return `
      <div class="conv-item ${isActive ? 'active' : ''}" onclick="selectPCChat(${u.id})">
        <div class="conv-avatar user">${initial}</div>
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

function filterConversations(query) {
  if (state.activeTab === 'groups') {
    const filtered = state.groups.filter((g) => g.name.toLowerCase().includes(query));
    renderGroupList(filtered);
  } else {
    const filtered = state.conversations.filter((u) => {
      const name = u.biodata ? `${u.biodata.first_name} ${u.biodata.last_name}` : u.email;
      return name.toLowerCase().includes(query) || u.email.toLowerCase().includes(query);
    });
    renderPCList(filtered);
  }
}

// ==========================================================================
// Active Chat Window Management
// ==========================================================================
async function selectGroupChat(groupId) {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return;

  state.activeChat = { type: 'group', id: groupId, data: group };

  // Update sidebar active class
  renderGroupList(state.groups);

  // Close mobile sidebar if open
  document.getElementById('app-sidebar').classList.remove('open');

  // Join WebSocket group room
  socketClient.joinGroupRoom(groupId);

  // Setup Chat Header
  document.getElementById('chat-empty-state').classList.add('hidden');
  document.getElementById('chat-active-window').classList.remove('hidden');

  document.getElementById('active-chat-avatar').textContent = (group.name || 'G').charAt(0).toUpperCase();
  document.getElementById('active-chat-avatar').className = 'chat-avatar';
  document.getElementById('active-chat-title').textContent = group.name;
  document.getElementById('active-chat-subtitle').textContent = `${group.members?.length || 0} Anggota`;

  // Header action buttons
  const actionsContainer = document.getElementById('chat-header-actions');
  actionsContainer.innerHTML = `
    <button class="btn btn-outline btn-sm" onclick="openAddMemberModal(${groupId})">➕ Tambah Member</button>
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

  // Update sidebar
  renderPCList(state.conversations);
  document.getElementById('app-sidebar').classList.remove('open');

  // Setup Chat Header
  document.getElementById('chat-empty-state').classList.add('hidden');
  document.getElementById('chat-active-window').classList.remove('hidden');

  const name = contact.biodata ? `${contact.biodata.first_name} ${contact.biodata.last_name}` : contact.email;
  document.getElementById('active-chat-avatar').textContent = name.charAt(0).toUpperCase();
  document.getElementById('active-chat-avatar').className = 'chat-avatar user';
  document.getElementById('active-chat-title').textContent = name;
  document.getElementById('active-chat-subtitle').textContent = contact.email;

  document.getElementById('chat-header-actions').innerHTML = `
    <button class="btn btn-outline btn-sm" onclick="toggleInfoDrawer()">ℹ️ Profil</button>
  `;

  renderUserInfoDrawer(contact);
  await loadChatMessages();
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
    senderHeader = `<div class="bubble-sender">${escapeHtml(senderName)}</div>`;
  }

  bubble.innerHTML = `
    ${senderHeader}
    <div class="bubble-content">
      ${escapeHtml(message.content)}
      <div class="bubble-time">${timeStr}</div>
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
function toggleInfoDrawer() {
  const drawer = document.getElementById('info-drawer');
  drawer.classList.toggle('hidden');
}

function renderGroupInfoDrawer(group) {
  const container = document.getElementById('info-drawer-content');
  document.getElementById('info-drawer-title').textContent = 'Detail Grup';

  const memberListHtml = (group.members || []).map((m) => {
    const name = m.user?.biodata ? `${m.user.biodata.first_name} ${m.user.biodata.last_name}` : m.user?.email;
    const isOwnerOrAdmin = m.role === 'OWNER' || m.role === 'ADMIN';
    const canRemove =
      (state.currentUser?.biodata?.role === 'ADMIN' || group.created_by_id === state.currentUser?.id) &&
      m.user_id !== state.currentUser?.id;

    return `
      <div class="notification-item" style="justify-content:space-between; align-items:center;">
        <div>
          <div class="notification-title">${escapeHtml(name)}</div>
          <div class="notification-time">${m.role}</div>
        </div>
        ${canRemove ? `<button class="btn btn-danger btn-sm" onclick="handleRemoveMember(${group.id}, ${m.user_id})">Keluarkan</button>` : ''}
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div style="margin-bottom:16px;">
      <h4 style="font-size:0.9rem; margin-bottom:4px;">Deskripsi:</h4>
      <p style="font-size:0.8rem; color:var(--text-secondary);">${escapeHtml(group.description || 'Tidak ada deskripsi.')}</p>
    </div>
    <h4 style="font-size:0.9rem; margin-bottom:8px;">Daftar Anggota (${group.members?.length || 0}):</h4>
    <div style="display:flex; flex-direction:column; gap:6px;">
      ${memberListHtml}
    </div>
  `;
}

function renderUserInfoDrawer(user) {
  const container = document.getElementById('info-drawer-content');
  document.getElementById('info-drawer-title').textContent = 'Profil Pengguna';

  const name = user.biodata ? `${user.biodata.first_name} ${user.biodata.last_name}` : user.email;

  container.innerHTML = `
    <div style="text-align:center; padding:16px 0;">
      <div class="chat-avatar user" style="width:64px; height:64px; margin:0 auto 12px; font-size:1.5rem;">
        ${name.charAt(0).toUpperCase()}
      </div>
      <h3>${escapeHtml(name)}</h3>
      <p style="font-size:0.85rem; color:var(--text-muted);">${escapeHtml(user.email)}</p>
      <span class="user-role-badge" style="margin-top:6px; display:inline-block;">ROLE: ${user.biodata?.role || 'USER'}</span>
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

async function openUserSelectModalForPC() {
  try {
    const users = await api.getUsers();
    state.usersCache = users;

    // Filter out self
    const otherUsers = users.filter((u) => u.id !== state.currentUser?.id);

    const userNameList = otherUsers.map((u) => {
      const name = u.biodata ? `${u.biodata.first_name} ${u.biodata.last_name}` : u.email;
      return `<button class="btn btn-outline btn-block" style="justify-content:flex-start; margin-bottom:6px;" onclick="selectPCChat(${u.id}); closeModal('modal-user-picker');">${escapeHtml(name)} (${escapeHtml(u.email)})</button>`;
    }).join('');

    let pickerModal = document.getElementById('modal-user-picker');
    if (!pickerModal) {
      pickerModal = document.createElement('div');
      pickerModal.id = 'modal-user-picker';
      pickerModal.className = 'modal-overlay';
      document.body.appendChild(pickerModal);
    }

    pickerModal.innerHTML = `
      <div class="modal-dialog glass-panel">
        <div class="modal-header">
          <h3>Pilih Pengguna untuk Pesan Pribadi</h3>
          <button class="btn-icon" onclick="closeModal('modal-user-picker')">✕</button>
        </div>
        <div class="modal-body" style="max-height:360px; overflow-y:auto;">
          ${userNameList || '<p class="empty-state">Tidak ada pengguna lain terdaftar.</p>'}
        </div>
      </div>
    `;

    pickerModal.classList.remove('hidden');
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

    const timeStr = n.created_at
      ? new Date(n.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';

    return `
      <div class="notification-item ${!n.is_read ? 'unread' : ''}" onclick="markNotificationRead(${n.id})">
        <div class="notification-icon">${icon}</div>
        <div class="notification-content">
          <div class="notification-title">${escapeHtml(n.title)}</div>
          <div class="notification-message">${escapeHtml(n.message)}</div>
          <div class="notification-time">${timeStr}</div>
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
async function loadAdminUsersList() {
  const tbody = document.getElementById('table-users-body');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Memuat data pengguna...</td></tr>';

  const includeDeleted = document.getElementById('check-include-deleted').checked;

  try {
    const users = await api.getUsers(includeDeleted);
    state.usersCache = users;

    if (!users || users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Tidak ada data pengguna.</td></tr>';
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

      return `
        <tr>
          <td>${u.id}</td>
          <td><strong>${escapeHtml(name)}</strong></td>
          <td>${escapeHtml(u.email)}</td>
          <td><span class="user-role-badge">${role}</span></td>
          <td>${statusBadge}</td>
          <td>
            <button class="btn btn-outline btn-sm" onclick="openEditUserModal(${u.id})">Edit</button>
            ${!isDeleted ? `<button class="btn btn-danger btn-sm" onclick="handleSoftDeleteUser(${u.id})">Soft Delete</button>` : ''}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHtml(err.message)}</td></tr>`;
  }
}

async function handleAdminRegisterUser(e) {
  e.preventDefault();
  const firstName = document.getElementById('reg-firstname').value.trim();
  const lastName = document.getElementById('reg-lastname').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const role = document.getElementById('reg-role').value;

  try {
    await api.createUserByAdmin({
      first_name: firstName,
      last_name: lastName,
      email,
      password,
      role,
    });

    closeModal('modal-register-user');
    document.getElementById('form-register-user').reset();
    showToast('User Didaftarkan', `User "${email}" berhasil didaftarkan!`, 'success', '👤');
    loadAdminUsersList();
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
  document.getElementById('edit-role').value = user.biodata?.role || 'USER';
  document.getElementById('edit-active').checked = user.biodata?.is_active !== false;

  openModal('modal-edit-user');
}

async function handleEditUser(e) {
  e.preventDefault();
  const id = document.getElementById('edit-user-id').value;
  const firstName = document.getElementById('edit-firstname').value.trim();
  const lastName = document.getElementById('edit-lastname').value.trim();
  const role = document.getElementById('edit-role').value;
  const isActive = document.getElementById('edit-active').checked;

  try {
    await api.updateUser(id, {
      first_name: firstName,
      last_name: lastName,
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
    showToast('Soft Delete Berhasil', `Pengguna ID ${userId} berhasil di-soft delete.`, 'info', '🗑️');
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
