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
    loginBtn.addEventListener('click', openCredentialsModal);
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
  
  loadCurrentView();

  // =====================
  // Event Delegation for Content Panel
  // =====================
  const contentPanel = document.getElementById('contentPanel');
  if (contentPanel) {
    contentPanel.addEventListener('click', handleContentPanelClick);
  }
});

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
