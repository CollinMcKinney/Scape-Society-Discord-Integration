/**
 * Admin Panel - Navigation & Routing
 */

// =====================
// Navigation
// =====================
function navigateTo(view, params = {}) {
  state.currentView = view;
  state.selectedPacket = null;
  state.selectedUser = null;

  // Update nav items
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });

  // Update breadcrumbs
  updateBreadcrumbs(view, params);

  // Load view
  loadCurrentView();
}

// Attach navigation event listeners
document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      // Navigate to view - permissions will be checked in loadCurrentView
      navigateTo(view);
    });
  });
  
  // Show all nav items - permissions checked on click/load
  permissions.updateNavVisibility();
});

function updateBreadcrumbs(view, params) {
  const breadcrumb = document.getElementById('breadcrumb');
  const viewLabels = {
    auditLogs: 'Audit Logs',
    users: 'Users',
    files: 'Files',
    prefixes: 'Message Suppression',
    commandRoles: 'Permissions',
    system: 'System'
  };

  let html = '<span class="breadcrumb-item" onclick="navigateTo(\'home\')">Home</span>';
  html += '<span class="breadcrumb-separator">›</span>';

  if (view === 'packet-detail' && params.packetId) {
    html += '<span class="breadcrumb-item" onclick="navigateTo(\'packets\')">Packets</span>';
    html += '<span class="breadcrumb-separator">›</span>';
    html += `<span class="breadcrumb-item active">${escapeHtml(params.packetId.slice(0, 12))}...</span>`;
  } else if (view === 'user-detail' && params.userId) {
    html += '<span class="breadcrumb-item" onclick="navigateTo(\'users\')">Users</span>';
    html += '<span class="breadcrumb-separator">›</span>';
    html += `<span class="breadcrumb-item active">${escapeHtml(params.userName || params.userId.slice(0, 12))}</span>`;
  } else {
    html += `<span class="breadcrumb-item active">${viewLabels[view] || view}</span>`;
  }

  breadcrumb.innerHTML = html;
}

// =====================
// View Loaders
// =====================
async function loadCurrentView() {
  const contentPanel = document.getElementById('contentPanel');
  
  // Check if user has permission for current view
  if (!permissions.canAccessView(state.currentView)) {
    permissions.showPermissionDeniedView(contentPanel, state.currentView);
    return;
  }
  
  contentPanel.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <span>Loading...</span>
    </div>
  `;

  try {
    switch (state.currentView) {
      case 'auditLogs':
        await loadPacketsView();
        break;
      case 'packet-detail':
        await loadPacketDetailView();
        break;
      case 'users':
        await loadUsersView();
        break;
      case 'user-detail':
        await loadUserDetailView();
        break;
      case 'files':
        await loadFilesView();
        break;
      case 'prefixes':
        await loadPrefixesView();
        break;
      case 'commandRoles':
        await loadCommandRolesView();
        break;
      case 'system':
        await loadSystemView();
        break;
      default:
        await loadPacketsView();
    }
  } catch (error) {
    // Check if it's a permission error
    if (error.message && error.message.includes('Insufficient role')) {
      permissions.showPermissionDeniedView(contentPanel, state.currentView);
    } else {
      contentPanel.innerHTML = `
        <div class="content-panel-body">
          <div class="empty-state">
            <div class="empty-state-icon">⚠️</div>
            <div class="empty-state-title">Error Loading View</div>
            <div class="empty-state-description">${escapeHtml(error.message)}</div>
          </div>
        </div>
      `;
    }
  }
}
