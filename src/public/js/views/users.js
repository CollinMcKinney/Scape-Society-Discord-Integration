/**
 * Admin Panel - Users View
 */

async function loadUsersView() {
  // Check if credentials are set
  const identifier = document.getElementById('rootCredentials').value.trim();
  const hasCredential = document.getElementById('rootPassword').value.length > 0 || sessionStorage.getItem('sessionToken');
  if (!identifier || !hasCredential) {
    showCredentialsRequiredView('users');
    return;
  }

  // Check permissions
  if (!permissions.canAccessView('users')) {
    permissions.showPermissionDeniedView(document.getElementById('contentPanel'), 'users');
    return;
  }

  try {
    const users = await apiCall('listUsers');
    state.users = users || [];
  } catch (error) {
    // Permission denied or other error
    permissions.showPermissionDeniedView(document.getElementById('contentPanel'), 'users');
    return;
  }

  state.usersCurrentTab = state.usersCurrentTab || 'all';

  // Build role counts
  const roleNames = {
    0: 'BLOCKED',
    1: 'GUEST',
    2: 'MEMBER',
    3: 'MODERATOR',
    4: 'ADMIN',
    5: 'OWNER',
    6: 'ROOT'
  };
  const roleEmojis = {
    'BLOCKED': '🚫',
    'GUEST': '👤',
    'MEMBER': '⭐',
    'MODERATOR': '🛡️',
    'ADMIN': '⚙️',
    'OWNER': '👑',
    'ROOT': '🔱'
  };
  
  const roleCounts = {};
  for (let i = 0; i <= 5; i++) {
    roleCounts[i] = 0;
  }
  
  for (const user of state.users) {
    const role = user.role != null ? user.role : 2;
    if (role >= 0 && role <= 5) {
      roleCounts[role]++;
    }
  }

  const contentPanel = document.getElementById('contentPanel');
  
  // Filter users by selected role tab
  let filteredUsers = state.usersCurrentTab === 'all'
    ? state.users
    : state.users.filter(u => (u.role != null ? u.role : 2) === parseInt(state.usersCurrentTab));

  // Filter by search query
  if (state.usersSearchQuery) {
    const query = state.usersSearchQuery.toLowerCase();
    filteredUsers = filteredUsers.filter(u => {
      const osrs = (u.osrs_name || '').toLowerCase();
      const disc = (u.disc_name || '').toLowerCase();
      const forum = (u.forum_name || '').toLowerCase();
      const id = (u.id || '').toLowerCase();
      return osrs.includes(query) || disc.includes(query) || forum.includes(query) || id.includes(query);
    });
  }

  // Define tab order: All, Member, Guest, Blocked, Moderator, Admin, Owner
  const tabOrder = [
    { key: 'all', name: 'All', emoji: '👥', count: state.users.length },
    { key: '2', name: 'MEMBER', emoji: '⭐', count: roleCounts[2] },
    { key: '1', name: 'GUEST', emoji: '👤', count: roleCounts[1] },
    { key: '0', name: 'BLOCKED', emoji: '🚫', count: roleCounts[0] },
    { key: '3', name: 'MODERATOR', emoji: '🛡️', count: roleCounts[3] },
    { key: '4', name: 'ADMIN', emoji: '⚙️', count: roleCounts[4] },
    { key: '5', name: 'OWNER', emoji: '👑', count: roleCounts[5] }
  ];

  contentPanel.innerHTML = `
    <div class="content-panel-header">
      <h2 class="content-panel-title">
        👤 Users
        <span class="compact-badge compact-badge-status">${state.users.length} total</span>
      </h2>
      <div class="content-panel-actions">
        <button type="button" class="primary-button" onclick="openCreateUserModal()" title="Create a new user">+ Add User</button>
        <button type="button" class="secondary-button" onclick="loadCurrentView()" title="Reload this view from the cache">↻ Refresh</button>
      </div>
    </div>
    <div class="content-panel-body">
      <!-- Sub-tabs for user roles -->
      <div style="display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid var(--line); padding-bottom: 8px; flex-wrap: wrap;">
        ${tabOrder.map(tab => `
          <button
            type="button"
            class="secondary-button"
            onclick="setUsersTab('${tab.key}')"
            style="background: ${state.usersCurrentTab === tab.key ? 'rgba(141, 240, 181, 0.2)' : 'transparent'}; border-color: ${state.usersCurrentTab === tab.key ? 'var(--accent)' : 'rgba(255, 255, 255, 0.1)'}">
            ${tab.emoji} ${tab.name} (${tab.count})
          </button>
        `).join('')}
      </div>

      <!-- Search bar -->
      <div style="margin-bottom: 16px;">
        <input type="text" id="usersSearchInput" placeholder="Search users..."
          oninput="handleUsersSearch(this);"
          autocomplete="off" name="usersSearch"
          value="${escapeHtml(state.usersSearchQuery || '')}"
          style="width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.1); background: rgba(7, 15, 11, 0.86); color: var(--text); font: inherit; font-size: 0.9rem;">
      </div>

      <!-- Results container -->
      <div id="usersResults">
        ${filteredUsers.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">👤</div>
            <div class="empty-state-title">No Users</div>
            <div class="empty-state-description">${state.usersCurrentTab === 'all' ? 'No users found in the cache. Click "Add User" to create one.' : `No users with this role yet.`}</div>
          </div>
        ` : filteredUsers.map(user => renderUserCard(user)).join('')}
      </div>
    </div>
  `;
}

function handleUsersSearch(inputElement) {
  state.usersSearchQuery = inputElement.value;
  
  // Filter users by selected role tab
  let filteredUsers = state.usersCurrentTab === 'all'
    ? state.users
    : state.users.filter(u => (u.role != null ? u.role : 2) === parseInt(state.usersCurrentTab));
  
  // Filter by search query
  if (state.usersSearchQuery) {
    const query = state.usersSearchQuery.toLowerCase();
    filteredUsers = filteredUsers.filter(u => {
      const osrs = (u.osrs_name || '').toLowerCase();
      const disc = (u.disc_name || '').toLowerCase();
      const forum = (u.forum_name || '').toLowerCase();
      const id = (u.id || '').toLowerCase();
      return osrs.includes(query) || disc.includes(query) || forum.includes(query) || id.includes(query);
    });
  }

  // Only update the results container, not the entire view
  const resultsContainer = document.getElementById('usersResults');
  if (resultsContainer) {
    if (filteredUsers.length === 0) {
      resultsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">👤</div>
          <div class="empty-state-title">No Users</div>
          <div class="empty-state-description">${state.usersCurrentTab === 'all' ? 'No users found matching your search.' : 'No users with this role yet.'}</div>
        </div>
      `;
    } else {
      resultsContainer.innerHTML = filteredUsers.map(user => renderUserCard(user)).join('');
    }
  }
}

function setUsersTab(tab) {
  state.usersCurrentTab = tab;
  loadUsersView();
}

function renderUserCard(user) {
  const roleValue = user.role;
  const roleName = typeof roleValue === 'number' ? getRoleName(roleValue) : String(roleValue || 'Unknown');
  const roleColor = getRoleColor(roleValue);
  const displayName = user.osrs_name || user.disc_name || 'User';

  const canChangeRole = permissions.canPerformAction('changeRole');
  const canDeleteUser = permissions.canPerformAction('deleteUser');
  const isRoot = permissions.canPerformAction('resetPassword');

  return `
    <div class="compact-card" data-user-id="${escapeHtml(user.id)}" data-user-name="${escapeHtml(displayName)}">
      <div class="compact-card-icon" style="background: ${roleColor}20; border-color: ${roleColor}40;" title="User ID: ${escapeHtml(user.id)}">👤</div>
      <div class="compact-card-body">
        <div class="compact-card-title">${escapeHtml(user.osrs_name || user.disc_name || user.forum_name || 'Unnamed')}</div>
        <div class="compact-card-meta">
          <span class="compact-badge compact-badge-role" style="background: ${roleColor}30; color: ${roleColor};">${escapeHtml(roleName)}</span>
          <span class="info-pill">🆔 ${escapeHtml(user.id.slice(-8))}</span>
          ${user.osrs_name ? `<span class="info-pill">🎮 ${escapeHtml(user.osrs_name)}</span>` : ''}
          ${user.disc_name ? `<span class="info-pill">💬 ${escapeHtml(user.disc_name)}</span>` : ''}
          ${user.forum_name ? `<span class="info-pill">📝 ${escapeHtml(user.forum_name)}</span>` : ''}
        </div>
      </div>
      <div class="compact-card-actions">
        ${canChangeRole ? `<button type="button" class="secondary-button" data-action="set-role" title="Change user's role">🎭</button>` : ''}
        ${isRoot ? `<button type="button" class="secondary-button" data-action="reset-password" title="Reset user's password">🔑</button>` : ''}
        <button type="button" class="secondary-button" data-action="view-json-user" title="View raw JSON">📄</button>
        <button type="button" class="secondary-button" data-action="copy-id" title="Copy user ID to clipboard">📋</button>
        ${roleName !== 'ROOT' && canDeleteUser ? `<button type="button" class="danger-button" data-action="delete-user" title="Delete user">🗑️</button>` : ''}
      </div>
    </div>
  `;
}

function viewUser(userId, userName) {
  const user = state.users.find(u => u.id === userId);
  state.selectedUser = user;
  navigateTo('user-detail', { userId, userName });
}

async function loadUserDetailView() {
  if (!state.selectedUser) {
    navigateTo('users');
    return;
  }

  const user = state.selectedUser;
  const roleValue = user.role;
  const roleName = typeof roleValue === 'number' ? getRoleName(roleValue) : String(roleValue || 'Unknown');
  const roleColor = getRoleColor(roleValue);

  const contentPanel = document.getElementById('contentPanel');
  contentPanel.innerHTML = `
    <div class="content-panel-header">
      <h2 class="content-panel-title">👤 User Details</h2>
      <div class="content-panel-actions">
        <button type="button" class="secondary-button" data-action="back-to-users" title="Go back to users list">← Back</button>
        <button type="button" class="primary-button" data-action="set-role-detail" data-user-id="${escapeHtml(user.id)}" data-role="${roleValue}" title="Change this user's role">🎭 Set Role</button>
      </div>
    </div>
    <div class="content-panel-body">
      <div class="compact-card" style="display: block;">
        <div class="compact-card-body">
          <div class="compact-card-meta" style="margin-bottom: 12px;">
            <span class="compact-badge compact-badge-role" style="background: ${roleColor}30; color: ${roleColor};">${escapeHtml(roleName)}</span>
            <span class="compact-badge compact-badge-status">ID: ${escapeHtml(user.id.slice(-8))}</span>
          </div>
          ${user.osrs_name ? `
            <div class="field">
              <label><span class="tooltip" data-tip="Old School RuneScape character name"><span class="tooltip-icon">?</span></span> OSRS Name</label>
              <div style="color: var(--text); font-size: 0.95rem;">${escapeHtml(user.osrs_name)}</div>
            </div>
          ` : ''}
          ${user.disc_name ? `
            <div class="field">
              <label><span class="tooltip" data-tip="Discord username"><span class="tooltip-icon">?</span></span> Discord Name</label>
              <div style="color: var(--text); font-size: 0.95rem;">${escapeHtml(user.disc_name)}</div>
            </div>
          ` : ''}
          ${user.forum_name ? `
            <div class="field">
              <label><span class="tooltip" data-tip="Forum username"><span class="tooltip-icon">?</span></span> Forum Name</label>
              <div style="color: var(--text); font-size: 0.95rem;">${escapeHtml(user.forum_name)}</div>
            </div>
          ` : ''}
          ${user.created_at ? `
            <div class="field">
              <label>Created At</label>
              <div style="color: var(--text); font-size: 0.95rem;">${escapeHtml(new Date(user.created_at).toLocaleString())}</div>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

function openCreateUserModal() {
  const osrs_name = prompt('OSRS name:');
  if (!osrs_name) return;
  const disc_name = prompt('Discord name:');
  const forum_name = prompt('Forum name:');
  const password = prompt('Password:');

  if (osrs_name && disc_name && forum_name && password) {
    apiCall('createUser', [osrs_name, disc_name, forum_name, password]).then(() => {
      showToast('User created');
      loadCurrentView();
    }).catch(error => {
      showToast(`Error: ${error.message}`);
    });
  }
}

function openSetRoleModal(userId, currentRole) {
  document.getElementById('setRoleUserId').value = userId;
  document.getElementById('setRoleSelect').value = currentRole;
  document.getElementById('setRoleModal').classList.add('active');
}

function closeSetRoleModal() {
  document.getElementById('setRoleModal').classList.remove('active');
}

async function saveRoleChange() {
  const userId = document.getElementById('setRoleUserId').value;
  const newRole = parseInt(document.getElementById('setRoleSelect').value);

  try {
    await apiCall('setRole', [userId, newRole]);
    showToast('User role updated');
    closeSetRoleModal();
    loadCurrentView();
  } catch (error) {
    showToast(`Error: ${error.message}`);
  }
}

async function deleteUser(userId) {
  if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
    return;
  }

  try {
    await apiCall('deleteUser', [userId]);
    showToast('User deleted');
    loadCurrentView();
  } catch (error) {
    showToast(`Error: ${error.message}`);
  }
}

function openResetPasswordModal(userId, userName) {
  document.getElementById('resetPasswordUserId').value = userId;
  document.getElementById('resetPasswordUsername').textContent = userName;
  document.getElementById('resetPasswordNew').value = '';
  document.getElementById('resetPasswordConfirm').value = '';
  document.getElementById('resetPasswordModal').classList.add('active');
}

function closeResetPasswordModal() {
  document.getElementById('resetPasswordModal').classList.remove('active');
}

async function saveResetPassword() {
  const userId = document.getElementById('resetPasswordUserId').value;
  const newPassword = document.getElementById('resetPasswordNew').value;
  const confirmPassword = document.getElementById('resetPasswordConfirm').value;

  if (!newPassword || !confirmPassword) {
    showToast('Please fill in all fields');
    return;
  }

  if (newPassword !== confirmPassword) {
    showToast('New passwords do not match');
    return;
  }

  try {
    await apiCall('resetPassword', [userId, newPassword]);
    showToast('Password reset successfully');
    closeResetPasswordModal();
    loadCurrentView();
  } catch (error) {
    showToast(`Error: ${error.message}`);
  }
}

// Make functions globally accessible
window.openCreateUserModal = openCreateUserModal;
window.setUsersTab = setUsersTab;
window.openSetRoleModal = openSetRoleModal;
window.closeSetRoleModal = closeSetRoleModal;
window.saveRoleChange = saveRoleChange;
window.loadUserDetailView = loadUserDetailView;
window.handleUsersSearch = handleUsersSearch;
window.openResetPasswordModal = openResetPasswordModal;
window.closeResetPasswordModal = closeResetPasswordModal;
window.saveResetPassword = saveResetPassword;
