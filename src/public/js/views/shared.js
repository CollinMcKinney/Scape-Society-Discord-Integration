/**
 * Admin Panel - Prefixes, Command Roles, and System Views
 */

// =====================
// Message Suppression View
// =====================
async function loadPrefixesView() {
  const prefixes = await apiCall('getSuppressedPrefixes');
  state.prefixes = prefixes || [];

  const contentPanel = document.getElementById('contentPanel');
  contentPanel.innerHTML = `
    <div class="content-panel-header">
      <h2 class="content-panel-title">🚫 Message Suppression</h2>
      <div class="content-panel-actions">
        <button type="button" class="primary-button" data-action="open-add-prefix" title="Add a new suppressed string">+ Add</button>
        <button type="button" class="secondary-button" data-action="refresh" title="Reload this view from the cache">↻ Refresh</button>
      </div>
    </div>
    <div class="content-panel-body">
      ${state.prefixes.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state-icon">🚫</div>
          <div class="empty-state-title">No Suppressed Strings</div>
          <div class="empty-state-description">No strings are currently suppressed. Messages containing any of the configured strings will not be bridged.</div>
        </div>
      ` : state.prefixes.map((prefix, index) => `
        <div class="compact-card">
          <div class="compact-card-icon" style="background: rgba(153, 255, 194, 0.1);">🚫</div>
          <div class="compact-card-body">
            <div class="compact-card-title">${escapeHtml(prefix)}</div>
            <div class="compact-card-meta">
              <span class="compact-badge compact-badge-status">Suppressed</span>
              <span class="tooltip" data-tip="Messages containing this string will not be bridged">
                <span class="info-pill">ℹ️ Contains check</span>
              </span>
            </div>
          </div>
          <div class="compact-card-actions">
            <button type="button" class="danger-button" data-action="delete-prefix" data-prefix="${escapeHtml(prefix)}" title="Delete this suppressed string">🗑️</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function openAddPrefixModal() {
  document.getElementById('addPrefixValue').value = '';
  document.getElementById('addPrefixModal').classList.add('active');
}

function closeAddPrefixModal() {
  document.getElementById('addPrefixModal').classList.remove('active');
}

async function addPrefix() {
  const value = document.getElementById('addPrefixValue').value.trim();
  
  if (!value) {
    showToast('Please enter a string to suppress');
    return;
  }
  
  try {
    const newPrefixes = [...state.prefixes, value];
    await apiCall('setSuppressedPrefixes', [newPrefixes]);
    showToast('Suppressed string added');
    closeAddPrefixModal();
    loadCurrentView();
  } catch (error) {
    showToast(`Error: ${error.message}`);
  }
}

async function deletePrefix(prefix) {
  try {
    const newPrefixes = state.prefixes.filter(p => p !== prefix);
    await apiCall('setSuppressedPrefixes', [newPrefixes]);
    showToast('Suppressed string deleted');
    loadCurrentView();
  } catch (error) {
    showToast(`Error: ${error.message}`);
  }
}

// =====================
// Command Roles View
// =====================
async function loadCommandRolesView() {
  const roles = await apiCall('getCommandRoleRequirements');
  state.commandRoles = roles || {};

  const contentPanel = document.getElementById('contentPanel');
  contentPanel.innerHTML = `
    <div class="content-panel-header">
      <h2 class="content-panel-title">⚙️ Permissions</h2>
      <div class="content-panel-actions">
        <button type="button" class="secondary-button" data-action="refresh" title="Reload this view from the cache">↻ Refresh</button>
      </div>
    </div>
    <div class="content-panel-body">
      ${Object.entries(state.commandRoles).map(([cmd, roleData]) => {
        const roleName = roleData.roleName || 'OPEN';
        const roleValue = roleData.roleValue;
        const roleColor = getRoleColor(roleValue);
        return `
          <div class="compact-card">
            <div class="compact-card-icon" style="background: rgba(141, 240, 181, 0.1);">⚙️</div>
            <div class="compact-card-body">
              <div class="compact-card-title">${escapeHtml(cmd)}</div>
              <div class="compact-card-meta">
                <span class="compact-badge compact-badge-role" style="background: ${roleColor}30; color: ${roleColor};">${escapeHtml(roleName)}</span>
                ${roleData.overridden ? '<span class="compact-badge compact-badge-status">Overridden</span>' : '<span class="compact-badge compact-badge-status">Default</span>'}
                <span class="tooltip" data-tip="Minimum role required to execute this command">
                  <span class="info-pill">ℹ️ Role requirement</span>
                </span>
              </div>
            </div>
            <div class="compact-card-actions">
              <button type="button" class="secondary-button" data-action="edit-command-role" data-command="${escapeHtml(cmd)}" data-role="${roleValue}" title="Change role requirement">✏️ Edit</button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function openEditCommandRoleModal(command, role) {
  document.getElementById('editCommandRoleCommand').value = command;
  document.getElementById('editCommandRoleSelect').value = role != null ? role.toString() : 'null';
  document.getElementById('editCommandRoleModal').classList.add('active');
}

function closeEditCommandRoleModal() {
  document.getElementById('editCommandRoleModal').classList.remove('active');
}

async function saveCommandRoleChange() {
  const command = document.getElementById('editCommandRoleCommand').value;
  const roleValue = document.getElementById('editCommandRoleSelect').value;
  const role = roleValue === 'null' ? null : parseInt(roleValue);

  try {
    await apiCall('setCommandRoleRequirement', [command, role]);
    showToast('Command role requirement updated');
    closeEditCommandRoleModal();
    loadCurrentView();
  } catch (error) {
    showToast(`Error: ${error.message}`);
  }
}

// =====================
// System View (Cache Backup/Restore)
// =====================
async function loadSystemView() {
  // Check permissions first
  if (!permissions.canAccessView('system')) {
    permissions.showPermissionDeniedView(document.getElementById('contentPanel'), 'system');
    return;
  }

  const contentPanel = document.getElementById('contentPanel');
  contentPanel.innerHTML = `
    <div class="content-panel-header">
      <h2 class="content-panel-title">💾 Cache</h2>
    </div>
    <div class="content-panel-body">
      <div class="compact-card" style="display: block;">
        <div class="compact-card-body">
          <div class="field">
            <label>💾 Cache Backup</label>
            <div style="color: var(--muted); font-size: 0.85rem; margin-bottom: 12px;">Save or restore the cache contents to/from the on-disk backup file.</div>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="primary-button" data-action="save-state" title="Save all cache data to disk" style="flex: 1;">💾 Save State</button>
              <button type="button" class="secondary-button" data-action="load-state" title="Load cache data from disk backup" style="flex: 1;">📂 Load State</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function saveState() {
  try {
    await apiCall('saveState');
    showToast('State saved successfully');
  } catch (error) {
    showToast(`Error: ${error.message}`);
  }
}

async function loadState() {
  if (!confirm('Are you sure you want to load state from backup? This will overwrite current cache contents.')) {
    return;
  }

  try {
    await apiCall('loadState');
    showToast('State loaded successfully');
    loadCurrentView();
  } catch (error) {
    showToast(`Error: ${error.message}`);
  }
}

// =====================
// Change Password
// =====================
function openChangePasswordModal() {
  document.getElementById('changePasswordUsername').value = '';
  document.getElementById('changePasswordCurrent').value = '';
  document.getElementById('changePasswordNew').value = '';
  document.getElementById('changePasswordConfirm').value = '';
  document.getElementById('changePasswordModal').classList.add('active');
}

function closeChangePasswordModal() {
  document.getElementById('changePasswordModal').classList.remove('active');
}

async function savePasswordChange() {
  const username = document.getElementById('changePasswordUsername').value.trim();
  const currentPassword = document.getElementById('changePasswordCurrent').value;
  const newPassword = document.getElementById('changePasswordNew').value;
  const confirmPassword = document.getElementById('changePasswordConfirm').value;

  if (!username || !currentPassword || !newPassword || !confirmPassword) {
    showToast('Please fill in all fields');
    return;
  }

  if (newPassword !== confirmPassword) {
    showToast('New passwords do not match');
    return;
  }

  try {
    // First verify current password by authenticating
    const authResult = await apiCall('authenticate', [username, currentPassword]);

    if (!authResult) {
      showToast('Current password is incorrect');
      return;
    }

    // Change the password - backend will look up user by username
    await apiCall('changePassword', [username, newPassword]);
    showToast('Password changed successfully');
    closeChangePasswordModal();
  } catch (error) {
    showToast(`Error: ${error.message}`);
  }
}

// Make functions globally accessible
window.openAddPrefixModal = openAddPrefixModal;
window.closeAddPrefixModal = closeAddPrefixModal;
window.addPrefix = addPrefix;
window.deletePrefix = deletePrefix;
window.openEditCommandRoleModal = openEditCommandRoleModal;
window.closeEditCommandRoleModal = closeEditCommandRoleModal;
window.saveCommandRoleChange = saveCommandRoleChange;
window.saveState = saveState;
window.loadState = loadState;
window.openChangePasswordModal = openChangePasswordModal;
window.closeChangePasswordModal = closeChangePasswordModal;
window.savePasswordChange = savePasswordChange;
