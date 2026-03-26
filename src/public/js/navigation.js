/**
 * Admin Panel - Navigation & Routing
 */

// =====================
// Navigation
// =====================
function navigateTo(view, params = {}) {
  // Save scroll position for current view before switching
  if (state.currentView) {
    sessionStorage.setItem(`scrollPosition_${state.currentView}`, window.scrollY.toString());
  }

  state.currentView = view;
  state.selectedPacket = null;
  state.selectedUser = null;

  // Update nav items
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });

  // Update breadcrumbs
  updateBreadcrumbs(view, params);

  // Save current view for page refresh
  sessionStorage.setItem('currentView', view);

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

  // Save scroll position on window scroll (debounced) - works for ALL views
  let scrollTimeout;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      if (state.currentView) {
        sessionStorage.setItem(`scrollPosition_${state.currentView}`, window.scrollY.toString());
      }
    }, 100);
  }, { passive: true });
});

function updateBreadcrumbs(view, params) {
  const breadcrumb = document.getElementById('breadcrumb');
  const viewLabels = {
    auditLogs: 'Audit Logs',
    users: 'Users',
    files: 'Files',
    prefixes: 'Message Suppression',
    commandRoles: 'Permissions',
    discord: 'Discord',
    limits: 'Limits',
    system: 'System'
  };

  let html = '<span class="breadcrumb-item" data-action="navigate" data-view="home">Home</span>';
  html += '<span class="breadcrumb-separator">›</span>';

  if (view === 'packet-detail' && params.packetId) {
    html += '<span class="breadcrumb-item" data-action="navigate" data-view="packets">Packets</span>';
    html += '<span class="breadcrumb-separator">›</span>';
    html += `<span class="breadcrumb-item active">${escapeHtml(params.packetId.slice(0, 12))}...</span>`;
  } else if (view === 'user-detail' && params.userId) {
    html += '<span class="breadcrumb-item" data-action="navigate" data-view="users">Users</span>';
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
        await window.loadPacketsView();
        break;
      case 'packet-detail':
        await window.loadPacketDetailView();
        break;
      case 'users':
        await window.loadUsersView();
        break;
      case 'user-detail':
        await window.loadUserDetailView();
        break;
      case 'files':
        await window.loadFilesView();
        break;
      case 'prefixes':
        await window.loadPrefixesView();
        break;
      case 'commandRoles':
        await window.loadCommandRolesView();
        break;
      case 'discord':
        await window.loadDiscordView();
        break;
      case 'limits':
        await window.loadLimitsView();
        break;
      case 'system':
        await window.loadSystemView();
        break;
      default:
        await window.loadPacketsView();
    }

    // Restore scroll position for this view after rendering
    const savedScroll = sessionStorage.getItem(`scrollPosition_${state.currentView}`);
    if (savedScroll !== null && savedScroll !== '0') {
      setTimeout(() => {
        window.scrollTo(0, parseInt(savedScroll, 10));
      }, 100);
    }
  } catch (error) {
    // Check if it's an authentication/permission error
    if (error.message && (error.message.includes('Actor not authenticated') || error.message.includes('Insufficient role'))) {
      permissions.showPermissionDeniedView(contentPanel, state.currentView);
      return;
    }
    // For other errors, show error view
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
