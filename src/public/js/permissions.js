/**
 * Admin Panel - Permission System
 */

// Role hierarchy (higher number = more permissions)
const ROLES = {
  BLOCKED: 0,
  GUEST: 1,
  MEMBER: 2,
  MODERATOR: 3,
  ADMIN: 4,
  OWNER: 5,
  ROOT: 6
};

// Permission requirements for each view
const VIEW_PERMISSIONS = {
  auditLogs: ROLES.GUEST,  // All authenticated users (uses packets view)
  packets: ROLES.GUEST,    // All authenticated users
  users: ROLES.MODERATOR,  // MODERATOR+
  files: ROLES.GUEST,      // All authenticated users
  prefixes: ROLES.GUEST,   // All authenticated users
  commandRoles: ROLES.GUEST, // All authenticated users (view only)
  discord: ROLES.MODERATOR,  // MODERATOR+ (view status)
  limits: ROLES.MODERATOR,  // MODERATOR+ (view config)
  system: ROLES.ROOT       // ROOT only
};

// Permission requirements for actions
const ACTION_PERMISSIONS = {
  // Packets
  addPacket: ROLES.ADMIN,
  editPacket: ROLES.MODERATOR,
  deletePacket: ROLES.MODERATOR,

  // Users
  createUser: ROLES.ADMIN,
  editUser: ROLES.ADMIN,
  deleteUser: ROLES.ROOT,
  changeRole: ROLES.MODERATOR,
  resetPassword: ROLES.ROOT,

  // Files
  uploadFile: ROLES.ADMIN,
  deleteFile: ROLES.ADMIN,
  createCategory: ROLES.ADMIN,
  setFavicon: ROLES.ADMIN,
  setAllowedMimeTypes: ROLES.ROOT,

  // Prefixes
  addPrefix: ROLES.ADMIN,
  deletePrefix: ROLES.ADMIN,

  // Command Roles
  editCommandRole: ROLES.ROOT,

  // System
  saveState: ROLES.ROOT,
  loadState: ROLES.ROOT,
  editEnvVar: ROLES.ROOT,

  // Discord
  updateDiscordConfig: ROLES.ROOT,
  startDiscord: ROLES.ROOT,
  stopDiscord: ROLES.ROOT,

  // Limits
  updateLimits: ROLES.ROOT
};

/**
 * Get current user's role from session
 */
async function getCurrentUserRole() {
  const sessionToken = sessionStorage.getItem('sessionToken');
  if (!sessionToken) return ROLES.BLOCKED;

  try {
    // We need to get user info - for now we'll cache it in state
    return state.currentUserRole ?? ROLES.GUEST;
  } catch (error) {
    return ROLES.GUEST;
  }
}

/**
 * Check if current user has required role
 */
function hasPermission(requiredRole) {
  const currentRole = state.currentUserRole ?? ROLES.GUEST;
  return currentRole >= requiredRole;
}

/**
 * Check if user can access a view
 */
function canAccessView(viewName) {
  const requiredRole = VIEW_PERMISSIONS[viewName] || ROLES.GUEST;
  return hasPermission(requiredRole);
}

/**
 * Check if user can perform an action
 */
function canPerformAction(actionName) {
  const requiredRole = ACTION_PERMISSIONS[actionName] || ROLES.GUEST;
  return hasPermission(requiredRole);
}

/**
 * Load current user's role and update UI accordingly
 */
async function loadUserPermissions() {
  const sessionToken = sessionStorage.getItem('sessionToken');
  const storedRole = sessionStorage.getItem('currentUserRole');

  if (!sessionToken) {
    state.currentUserRole = ROLES.BLOCKED; // Not logged in = blocked
    updateNavVisibility();
    return;
  }

  // Use stored role if available - this is critical for page refresh!
  if (storedRole) {
    state.currentUserRole = parseInt(storedRole);
    console.log('[Permissions] Using stored role:', state.currentUserRole);
    updateNavVisibility();
    return;
  }

  // No stored role, try to determine it by fetching users
  try {
    const users = await apiCall('listUsers');
    if (users && Array.isArray(users)) {
      // Find ROOT user to get actual role
      const rootUser = users.find(u => u.osrs_name === 'ROOT');
      if (rootUser) {
        state.currentUserRole = rootUser.role || ROLES.ROOT;
        console.log('[Permissions] Found ROOT user, role:', state.currentUserRole);
        // Store for future use
        sessionStorage.setItem('currentUserRole', state.currentUserRole.toString());
      } else {
        // Not ROOT, but have MODERATOR+ access
        state.currentUserRole = ROLES.MODERATOR;
        console.log('[Permissions] Determined role: MODERATOR+');
        sessionStorage.setItem('currentUserRole', state.currentUserRole.toString());
      }
    }
  } catch (error) {
    // listUsers failed, we're below MODERATOR
    state.currentUserRole = ROLES.MEMBER;
    console.log('[Permissions] Determined role: MEMBER');
    sessionStorage.setItem('currentUserRole', state.currentUserRole.toString());
  }
  
  updateNavVisibility();
}

/**
 * Update navigation visibility based on permissions
 * Note: We now show all nav items, but check permissions on click/load
 */
function updateNavVisibility() {
  // Show all nav items - permissions are checked on click and view load
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.style.display = 'flex';
  });
}

/**
 * Show permission denied view
 */
function showPermissionDeniedView(contentPanel, viewName) {
  contentPanel.innerHTML = `
    <div class="content-panel-header">
      <h2 class="content-panel-title">🔒 Access Denied</h2>
    </div>
    <div class="content-panel-body">
      <div class="empty-state">
        <div class="empty-state-icon">🔒</div>
        <div class="empty-state-title">Access Denied</div>
        <div class="empty-state-description">You don't have permission to access this section.</div>
      </div>
    </div>
  `;
}

/**
 * Filter action buttons based on permissions
 * @param {HTMLElement} card - The card element containing action buttons
 */
function filterActionButtons(card) {
  const buttons = card.querySelectorAll('[data-action]');
  buttons.forEach(button => {
    const action = button.dataset.action;
    const requiredRole = ACTION_PERMISSIONS[action];
    
    if (requiredRole !== undefined && !hasPermission(requiredRole)) {
      button.style.display = 'none';
    }
  });
}

// Export for use in other modules
window.permissions = {
  ROLES,
  VIEW_PERMISSIONS,
  ACTION_PERMISSIONS,
  hasPermission,
  canAccessView,
  canPerformAction,
  loadUserPermissions,
  updateNavVisibility,
  showPermissionDeniedView,
  filterActionButtons
};
