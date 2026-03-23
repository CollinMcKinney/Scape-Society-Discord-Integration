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
        <button type="button" class="primary-button" onclick="openAddPrefixModal()" title="Add a new suppressed string">+ Add</button>
        <button type="button" class="secondary-button" onclick="loadCurrentView()" title="Reload this view from the cache">↻ Refresh</button>
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
        <button type="button" class="secondary-button" onclick="loadCurrentView()" title="Reload this view from the cache">↻ Refresh</button>
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
// System View
// =====================
async function loadSystemView() {
  // Check permissions first
  if (!permissions.canAccessView('system')) {
    permissions.showPermissionDeniedView(document.getElementById('contentPanel'), 'system');
    return;
  }

  // Load environment variables
  const envVars = await apiCall('getEnvVars').catch(() => ({}));
  state.envVars = envVars || {};
  
  // Get current session TTL
  const sessionTTL = state.envVars.SESSION_TTL_HOURS || '24';
  
  // Check if backup exists
  try {
    const response = await fetch('/admin/env-backup-status', {
      headers: {
        'X-Session-Token': sessionStorage.getItem('sessionToken') || ''
      }
    });
    if (response.ok) {
      const data = await response.json();
      state.envVars.__HAS_BACKUP = data.hasBackup;
    }
  } catch (error) {
    console.error('Failed to check backup status:', error);
  }
  
  const hasBackup = state.envVars.__HAS_BACKUP || false;

  const contentPanel = document.getElementById('contentPanel');
  contentPanel.innerHTML = `
    <div class="content-panel-header">
      <h2 class="content-panel-title">🔧 System</h2>
    </div>
    <div class="content-panel-body">
      <div class="compact-card" style="display: block;">
        <div class="compact-card-body">
          <div class="field">
            <label>💾 Cache Backup</label>
            <div style="color: var(--muted); font-size: 0.85rem; margin-bottom: 12px;">Save or restore the cache contents to/from the on-disk backup file.</div>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="primary-button" onclick="saveState()" title="Save all cache data to disk" style="flex: 1;">💾 Save State</button>
              <button type="button" class="secondary-button" onclick="loadState()" title="Load cache data from disk backup" style="flex: 1;">📂 Load State</button>
            </div>
          </div>
        </div>
      </div>

      <div class="compact-card" style="display: block; margin-top: 16px;">
        <div class="compact-card-body">
          <div class="field">
            <label>⏱️ Session Expiration</label>
            <div style="color: var(--muted); font-size: 0.85rem; margin-bottom: 8px;">Configure how long user sessions remain valid. After expiration, users must log in again.</div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input type="number" id="sessionTTLInput" value="${escapeHtml(sessionTTL)}" min="1" max="720" style="width: 100px; padding: 8px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.1); background: rgba(7, 15, 11, 0.86); color: var(--text); font: inherit; font-size: 0.9rem;">
              <span style="color: var(--text);">hours</span>
              <button type="button" class="primary-button" onclick="saveSessionTTL()" title="Save session TTL">Save</button>
            </div>
            <div class="field-help">Current: ${escapeHtml(sessionTTL)} hours. Changes take effect immediately for new logins.</div>
          </div>
        </div>
      </div>

      <div class="compact-card" style="display: block; margin-top: 16px;">
        <div class="compact-card-body">
          <div class="field">
            <label>📝 Environment Variables</label>
            <div style="color: var(--muted); font-size: 0.85rem; margin-bottom: 8px;">View and edit server environment variables. Changes take effect immediately.</div>
            ${hasBackup ? `
              <div style="padding: 8px; background: rgba(141, 240, 181, 0.1); border-radius: 8px; color: var(--accent); font-size: 0.85rem; margin-bottom: 8px;">
                ✅ Backup available (.env.backup)
                <button type="button" class="secondary-button" onclick="restoreEnvBackup()" style="margin-left: 8px; font-size: 0.75rem; padding: 4px 8px;">↩️ Restore Backup</button>
              </div>
            ` : ''}
            ${Object.entries(state.envVars).filter(([key]) => key !== 'SESSION_TTL_HOURS' && key !== '__HAS_BACKUP').length === 0 ? `
              <div class="empty-state">
                <div class="empty-state-icon">📝</div>
                <div class="empty-state-title">No Environment Variables</div>
                <div class="empty-state-description">No .env file found. Variables will appear here once set.</div>
              </div>
            ` : Object.entries(state.envVars).filter(([key]) => key !== 'SESSION_TTL_HOURS' && key !== '__HAS_BACKUP').map(([key, value]) => `
              <div class="compact-card" style="margin-bottom: 8px;">
                <div class="compact-card-icon" style="background: rgba(141, 240, 181, 0.1); border: 1px solid rgba(141, 240, 181, 0.2);">
                  🔑
                </div>
                <div class="compact-card-body" style="flex: 1;">
                  <div class="compact-card-title" style="font-family: monospace; color: var(--accent);">${escapeHtml(key)}</div>
                  <div class="compact-card-meta" style="font-family: monospace; color: var(--muted); font-size: 0.85rem; word-break: break-all; margin-top: 4px;">
                    ${escapeHtml(value)}
                  </div>
                </div>
                <div class="compact-card-actions">
                  <button type="button" class="secondary-button" onclick="openEditEnvVarModal('${escapeHtml(key)}')" style="font-size: 0.75rem; padding: 6px 10px;">✏️ Edit</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

function restoreEnvBackup() {
  if (!confirm('Restore .env from backup? This will overwrite current values.')) {
    return;
  }
  
  // Call backend to restore backup
  fetch('/admin/restore-env-backup', {
    method: 'POST',
    headers: {
      'X-Session-Token': sessionStorage.getItem('sessionToken') || ''
    }
  }).then(response => {
    if (response.ok) {
      showToast('Environment restored from backup. Some changes may require restart.');
      loadSystemView();
    } else {
      return response.json().then(data => {
        throw new Error(data.error || 'Failed to restore backup');
      });
    }
  }).catch(error => {
    showToast(`Error: ${error.message}`);
  });
}

function saveSessionTTL() {
  const ttl = document.getElementById('sessionTTLInput').value;
  
  if (!ttl || parseInt(ttl) < 1 || parseInt(ttl) > 720) {
    showToast('Session TTL must be between 1 and 720 hours');
    return;
  }
  
  apiCall('setEnvVariable', ['SESSION_TTL_HOURS', ttl]).then(() => {
    showToast(`Session TTL set to ${ttl} hours. New sessions will use this value.`);
    loadSystemView();
  }).catch(error => {
    showToast(`Error: ${error.message}`);
  });
}

function openEditEnvVarModal(key) {
  document.getElementById('editEnvVarKey').value = key;
  document.getElementById('editEnvVarValue').value = state.envVars[key] || '';
  document.getElementById('editEnvVarModal').classList.add('active');
}

function closeEditEnvVarModal() {
  document.getElementById('editEnvVarModal').classList.remove('active');
}

async function saveEnvVar() {
  const key = document.getElementById('editEnvVarKey').value;
  const value = document.getElementById('editEnvVarValue').value;

  try {
    await apiCall('setEnvVariable', [key, value]);
    showToast('Environment variable updated');
    closeEditEnvVarModal();
    loadCurrentView();
  } catch (error) {
    showToast(`Error: ${error.message}`);
  }
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
window.openEditEnvVarModal = openEditEnvVarModal;
window.closeEditEnvVarModal = closeEditEnvVarModal;
window.saveEnvVar = saveEnvVar;
window.saveState = saveState;
window.loadState = loadState;
window.openChangePasswordModal = openChangePasswordModal;
window.closeChangePasswordModal = closeChangePasswordModal;
window.savePasswordChange = savePasswordChange;
