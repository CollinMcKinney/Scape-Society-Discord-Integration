/**
 * Admin Panel - Main Entry Point
 */

// =====================
// State Management
// =====================
const state = {
  currentView: 'packets',
  breadcrumbs: [{ label: 'Home', view: 'home' }],
  credentials: { userId: '', sessionToken: '' },
  packets: [],
  users: [],
  prefixes: [],
  commandRoles: {},
  selectedPacket: null,
  selectedUser: null,
  packetsSearchQuery: '',
  usersSearchQuery: '',
  filesSearchQuery: '',
  packetsSearchTimeout: null,
  usersSearchTimeout: null,
  filesSearchTimeout: null,
  files: {},
  filesCurrentTab: 'all',
  filesCategories: [],
  envVars: {}
};

// =====================
// Initialize
// =====================
document.addEventListener('DOMContentLoaded', async () => {
  // Attach login button listener
  const loginBtn = document.getElementById('loginButton');
  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      const sessionToken = sessionStorage.getItem('sessionToken');
      if (sessionToken) {
        // Already logged in, logout
        logout();
      } else {
        // Not logged in, open login modal
        openCredentialsModal();
      }
    });
  }

  // Wait for modals to load first
  if (window.loadModals) {
    await window.loadModals();
  }
  
  // Load user permissions
  await permissions.loadUserPermissions();
  
  // Update nav visibility now that modals are loaded
  permissions.updateNavVisibility();
  
  // Now update session summary (modals are loaded)
  updateSessionSummary();

  // Load saved favicon from server
  loadFavicon();

  // Restore last viewed tab on page refresh
  const savedView = sessionStorage.getItem('currentView');
  if (savedView && ['packets', 'users', 'files', 'prefixes', 'commandRoles', 'discord', 'system'].includes(savedView)) {
    state.currentView = savedView;
    // Update nav items to reflect restored view
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === savedView);
    });
  }

  loadCurrentView();

  // =====================
  // Event Delegation for Content Panel
  // =====================
  const contentPanel = document.getElementById('contentPanel');
  if (contentPanel) {
    contentPanel.addEventListener('click', handleContentPanelClick);
  }

  // =====================
  // Global Event Delegation (replaces inline onclick/oninput handlers)
  // =====================
  document.addEventListener('click', handleGlobalClick);
  document.addEventListener('input', handleGlobalInput);
});

/**
 * Handle click events for dynamically generated content
 */
async function handleGlobalClick(e) {
  const target = e.target;
  
  // MIME type toggle
  const toggleButton = target.closest('[data-action="toggle-mime-type"]');
  if (toggleButton) {
    // Prevent double-clicking while request is in progress
    if (toggleButton.dataset.loading === 'true') return;
    
    const type = toggleButton.dataset.type;
    console.log('[MIME Toggle] Clicked:', type);
    
    // Read current state from the style attribute (green/accent = enabled, red = disabled)
    const buttonHtml = toggleButton.outerHTML;
    const isEnabled = buttonHtml.includes('var(--accent)');
    console.log('[MIME Toggle] Current state:', isEnabled ? 'ENABLED' : 'DISABLED');
    
    // Set loading state
    toggleButton.dataset.loading = 'true';
    toggleButton.style.opacity = '0.6';
    
    try {
      await toggleMimeType(type, !isEnabled);
      console.log('[MIME Toggle] Success');
    } catch (error) {
      console.error('[MIME Toggle] Error:', error);
    } finally {
      // Clear loading state
      toggleButton.dataset.loading = 'false';
      toggleButton.style.opacity = '';
    }
    return;
  }
  
  // MIME type remove
  if (target.matches('[data-action="remove-mime-type"]')) {
    e.stopPropagation();
    const type = target.dataset.type;
    removeMimeType(type);
    return;
  }
  
  // Open add MIME type modal
  if (target.matches('[data-action="open-add-mime-type"]')) {
    openAddMimeTypeModal();
    return;
  }
  
  // Tab/category changes
  if (target.matches('[data-action="set-files-tab"]')) {
    setFilesTab(target.dataset.tab);
    return;
  }
  
  if (target.matches('[data-action="set-packets-category"]')) {
    setPacketsCategory(target.dataset.category);
    return;
  }
  
  if (target.matches('[data-action="set-packets-subcategory"]')) {
    setPacketsSubcategory(target.dataset.subcategory);
    return;
  }
  
  if (target.matches('[data-action="set-users-tab"]')) {
    setUsersTab(target.dataset.tab);
    return;
  }
  
  // Navigation breadcrumbs
  if (target.matches('[data-action="navigate"]')) {
    const view = target.dataset.view;
    if (view) {
      navigateTo(view);
    }
    return;
  }
  
  // Action buttons
  if (target.matches('[data-action="open-upload-modal"]')) {
    openUploadFileModal();
    return;
  }
  
  if (target.matches('[data-action="open-add-category"]')) {
    openAddCategoryModal();
    return;
  }
  
  if (target.matches('[data-action="open-add-packet"]')) {
    openAddPacketModal();
    return;
  }
  
  if (target.matches('[data-action="open-add-prefix"]')) {
    openAddPrefixModal();
    return;
  }
  
  if (target.matches('[data-action="open-create-user"]')) {
    openCreateUserModal();
    return;
  }
  
  if (target.matches('[data-action="save-state"]')) {
    saveState();
    return;
  }

  if (target.matches('[data-action="load-state"]')) {
    loadState();
    return;
  }

  if (target.matches('[data-action="refresh"]')) {
    loadCurrentView();
    return;
  }
}

/**
 * Handle input events for search boxes
 */
function handleGlobalInput(e) {
  const target = e.target;
  
  if (target.matches('[data-action="search-files"]')) {
    handleFilesSearch(target);
    return;
  }
  
  if (target.matches('[data-action="search-packets"]')) {
    handlePacketsSearch(target);
    return;
  }
  
  if (target.matches('[data-action="search-users"]')) {
    handleUsersSearch(target);
    return;
  }
}

function handleContentPanelClick(e) {
  const button = e.target.closest('button[data-action]');
  if (!button) return;

  const card = button.closest('.compact-card');
  if (!card) return;

  const action = button.dataset.action;
  const packetId = card.dataset.packetId;
  const userId = card.dataset.userId;
  const userName = card.dataset.userName;
  const fileCategory = card.dataset.fileCategory;
  const fileName = card.dataset.fileName;

  switch (action) {
    case 'view-packet':
      const viewPacketObj = state.packets.find(p => p.id === packetId);
      state.selectedPacket = viewPacketObj;
      navigateTo('packet-detail', { packetId });
      break;
    case 'edit-packet':
      const packet = state.packets.find(p => p.id === packetId);
      openEditPacketModal(packetId, packet);
      break;
    case 'delete-packet':
      if (confirm(`Are you sure you want to delete packet ${packetId.slice(0, 8)}...?`)) {
        apiCall('deletePacket', [packetId]).then(() => {
          showToast('Packet deleted');
          loadCurrentView();
        }).catch(error => {
          showToast(`Error: ${error.message}`);
        });
      }
      break;
    case 'view-user':
      const viewUserObj = state.users.find(u => u.id === userId);
      state.selectedUser = viewUserObj;
      navigateTo('user-detail', { userId, userName });
      break;
    case 'set-role':
      if (!permissions.canPerformAction('changeRole')) {
        showToast('You don\'t have permission to change roles');
        break;
      }
      const userForRole = state.users.find(u => u.id === userId);
      openSetRoleModal(userId, userForRole?.role || 2);
      break;
    case 'copy-id':
      copyToClipboard(userId, 'Copied user ID');
      break;
    case 'delete-user':
      if (!permissions.canPerformAction('deleteUser')) {
        showToast('You don\'t have permission to delete users');
        break;
      }
      if (confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
        apiCall('deleteUser', [userId]).then(() => {
          showToast('User deleted');
          loadCurrentView();
        }).catch(error => {
          showToast(`Error: ${error.message}`);
        });
      }
      break;
    case 'reset-password':
      if (!permissions.canPerformAction('resetPassword')) {
        showToast('You don\'t have permission to reset passwords');
        break;
      }
      const userToReset = state.users.find(u => u.id === userId);
      if (userToReset) {
        openResetPasswordModal(userId, userToReset.osrs_name || userToReset.disc_name || userToReset.forum_name || userId);
      }
      break;
    case 'view-json-user':
      const userJson = state.users.find(u => u.id === userId);
      if (userJson) {
        const modal = document.getElementById('viewJsonModal');
        document.getElementById('viewJsonContent').textContent = JSON.stringify(userJson, null, 2);
        modal.classList.add('active');
      }
      break;
    case 'preview-file':
      const file = (state.files[fileCategory] || []).find(f => f.name === fileName);
      if (file) {
        previewFile(file.category, file.name, file.size, file.uploadedAt);
      }
      break;
    case 'copy-file-url':
      const fileUrl = `/files/${fileCategory}/${encodeURIComponent(fileName)}`;
      copyToClipboard(fileUrl, 'Copied file URL');
      break;
    case 'set-as-favicon':
      setAsFavicon(fileCategory, fileName);
      break;
    case 'delete-file':
      if (confirm(`Are you sure you want to delete ${fileName}?`)) {
        apiCall('deleteFile', [fileCategory, fileName]).then(() => {
          showToast('File deleted');
          loadCurrentView();
        }).catch(error => {
          showToast(`Error: ${error.message}`);
        });
      }
      break;
    case 'delete-prefix':
      const prefix = button.dataset.prefix;
      if (confirm(`Delete suppressed string "${prefix}"?`)) {
        const newPrefixes = state.prefixes.filter(p => p !== prefix);
        apiCall('setSuppressedPrefixes', [newPrefixes]).then(() => {
          showToast('Suppressed string deleted');
          loadCurrentView();
        }).catch(error => {
          showToast(`Error: ${error.message}`);
        });
      }
      break;
    case 'edit-command-role':
      const command = button.dataset.command;
      const role = button.dataset.role;
      openEditCommandRoleModal(command, role === 'null' ? null : parseInt(role));
      break;
    case 'back-to-packets':
      navigateTo('packets');
      break;
    case 'edit-packet-detail':
      const packetIdDetail = button.dataset.packetId;
      const packetDetail = state.packets.find(p => p.id === packetIdDetail);
      openEditPacketModal(packetIdDetail, packetDetail);
      break;
    case 'delete-packet-detail':
      if (confirm(`Are you sure you want to delete packet ${button.dataset.packetId.slice(0, 8)}...?`)) {
        apiCall('deletePacket', [button.dataset.packetId]).then(() => {
          showToast('Packet deleted');
          navigateTo('packets');
        }).catch(error => {
          showToast(`Error: ${error.message}`);
        });
      }
      break;
    case 'back-to-users':
      navigateTo('users');
      break;
    case 'set-role-detail':
      const userIdDetail = button.dataset.userId;
      const roleDetail = parseInt(button.dataset.role || '2');
      openSetRoleModal(userIdDetail, roleDetail);
      break;
  }
}

// Helper function to view JSON
function openViewJsonModal(data) {
  const modal = document.getElementById('viewJsonModal');
  document.getElementById('viewJsonContent').textContent = JSON.stringify(data, null, 2);
  modal.classList.add('active');
}

/**
 * Load saved favicon from server
 */
async function loadFavicon() {
  try {
    const response = await fetch('/files/favicon');
    if (response.ok) {
      const data = await response.json();
      const faviconLink = document.querySelector('link[rel="icon"]');
      if (faviconLink && data.category && data.name) {
        faviconLink.href = `/files/${data.category}/${encodeURIComponent(data.name)}`;
      }
    }
  } catch (err) {
    // Silently fail - will use default favicon
  }
}
