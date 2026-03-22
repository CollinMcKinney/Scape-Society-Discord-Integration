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
            <label>🔧 Environment Variables</label>
            <div style="color: var(--muted); font-size: 0.85rem; margin-bottom: 8px;">View and edit server environment variables. Changes take effect immediately.</div>
            ${Object.entries(state.envVars).length === 0 ? `
              <div style="padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; color: var(--muted); font-size: 0.85rem;">
                No .env file found. Variables will appear here once set.
              </div>
            ` : Object.entries(state.envVars).map(([key, value]) => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line);">
                <div style="font-family: monospace; color: var(--accent); font-size: 0.85rem;">${escapeHtml(key)}</div>
                <button type="button" class="secondary-button" onclick="openEditEnvVarModal('${escapeHtml(key)}')" style="font-size: 0.75rem; padding: 4px 8px;">✏️ Edit</button>
              </div>
              <div style="font-family: monospace; color: var(--muted); font-size: 0.75rem; padding: 4px 0 8px; word-break: break-all;">
                ${escapeHtml(value)}
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
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
