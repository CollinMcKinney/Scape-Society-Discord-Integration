/**
 * Admin Panel - Limits View
 */

async function loadLimitsView() {
  const identifier = document.getElementById('rootCredentials').value.trim();
  const hasCredential = document.getElementById('rootPassword').value.length > 0 || sessionStorage.getItem('sessionToken');
  if (!identifier || !hasCredential) {
    showCredentialsRequiredView('limits');
    return;
  }

  if (!permissions.canAccessView('limits')) {
    permissions.showPermissionDeniedView(document.getElementById('contentPanel'), 'limits');
    return;
  }

  try {
    const limits = await apiCall('getAllLimits');
    state.limits = limits || [];
  } catch (error) {
    console.error('[Limits] Failed to load config:', error);
    permissions.showPermissionDeniedView(document.getElementById('contentPanel'), 'limits');
    return;
  }

  const contentPanel = document.getElementById('contentPanel');

  contentPanel.innerHTML = `
    <div class="content-panel-header">
      <h2 class="content-panel-title">⚙️ Limits</h2>
      <div class="content-panel-actions">
        <button type="button" class="secondary-button" data-action="refresh">↻</button>
      </div>
    </div>

    <div class="content-panel-body">
      <div class="help-box" style="margin-bottom: 20px; padding: 16px; background: rgba(255, 193, 7, 0.1); border: 1px solid rgba(255, 193, 7, 0.3); border-radius: 8px;">
        <strong style="color: var(--accent);">⚠️ Changes take effect within 1 window period</strong>
        <p style="margin: 8px 0 0 0; color: var(--text-secondary); font-size: 0.9rem;">
          Rate limit changes apply to new requests. Session TTL affects new sessions only.
        </p>
      </div>

      <div class="env-vars-grid" style="display: grid; gap: 12px;">
        ${state.limits.map(v => renderLimitCard(v)).join('')}
      </div>
    </div>
  `;

  attachLimitsEventListeners();
}

function renderLimitCard(limitVar) {
  return `
    <div class="compact-card" data-action="edit-limit-var" data-key="${escapeHtml(limitVar.key)}" style="cursor: pointer;">
      <div class="compact-card-icon" style="background: rgba(141, 240, 181, 0.1); border-color: rgba(141, 240, 181, 0.3);">⚙️</div>
      <div class="compact-card-body" style="flex: 1;">
        <div class="compact-card-title">${escapeHtml(limitVar.label)}</div>
        <div class="compact-card-meta">
          <span class="info-pill">${escapeHtml(limitVar.key)}</span>
          <span class="info-pill">${escapeHtml(limitVar.value)}</span>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 4px;">${escapeHtml(limitVar.help)}</div>
      </div>
      <button type="button" class="secondary-button">✏️</button>
    </div>
  `;
}

function attachLimitsEventListeners() {
  console.log('[Limits] Attaching event listeners...');
  document.querySelector('[data-action="refresh"]')?.addEventListener('click', loadLimitsView);

  document.querySelectorAll('[data-action="edit-limit-var"]').forEach(card => {
    console.log('[Limits] Found edit button:', card.dataset.key);
    card.addEventListener('click', () => {
      console.log('[Limits] Edit button clicked:', card.dataset.key);
      const key = card.dataset.key;
      const limitVar = state.limits.find(v => v.key === key);
      if (limitVar) {
        console.log('[Limits] Opening modal for:', limitVar);
        openLimitVarModal(limitVar);
      } else {
        console.error('[Limits] Limit var not found for key:', key);
      }
    });
  });
}

function openLimitVarModal(limitVar) {
  console.log('[Limits] Opening modal...');
  const modal = document.getElementById('editEnvVarModal');
  const keyInput = document.getElementById('editEnvVarKey');
  const labelEl = document.getElementById('editEnvVarLabel');
  const valueInput = document.getElementById('editEnvVarValue');
  const helpEl = document.getElementById('editEnvVarHelp');

  console.log('[Limits] Modal elements:', { modal, keyInput, labelEl, valueInput, helpEl });

  if (!modal || !keyInput || !labelEl || !valueInput || !helpEl) {
    console.error('[Limits] Modal elements not found!');
    return;
  }

  keyInput.value = limitVar.key;
  labelEl.textContent = limitVar.label;
  valueInput.type = limitVar.type;
  valueInput.value = limitVar.value;
  helpEl.textContent = limitVar.help;

  console.log('[Limits] Setting modal display to flex and adding active class');
  modal.style.display = 'flex';
  modal.classList.add('active');
  valueInput.focus();
  console.log('[Limits] Modal classList:', modal.classList);
}

function closeLimitVarModal() {
  const modal = document.getElementById('editEnvVarModal');
  if (modal) modal.style.display = 'none';
}

async function saveLimitVarFromModal() {
  const keyInput = document.getElementById('editEnvVarKey');
  const valueInput = document.getElementById('editEnvVarValue');

  if (!keyInput || !valueInput) return;

  const key = keyInput.value;
  const value = valueInput.value.trim();

  if (!value) {
    showToast('Value is required');
    return;
  }

  try {
    await apiCall('updateLimits', [{ [key]: value }]);
    showToast(`${key} updated`);
    closeLimitVarModal();
    loadLimitsView();
  } catch (error) {
    showToast(`Error: ${error.message}`);
  }
}

function attachLimitModalEventListeners() {
  const closeBtn = document.getElementById('editEnvVarCloseBtn');
  const cancelBtn = document.getElementById('editEnvVarCancelBtn');
  const saveBtn = document.getElementById('editEnvVarSaveBtn');
  const modal = document.getElementById('editEnvVarModal');
  const valueInput = document.getElementById('editEnvVarValue');

  if (!closeBtn || !cancelBtn || !saveBtn || !modal || !valueInput) {
    console.log('[Limits] Modal elements not found, will retry...');
    return;
  }

  closeBtn.addEventListener('click', closeLimitVarModal);
  cancelBtn.addEventListener('click', closeLimitVarModal);
  saveBtn.addEventListener('click', saveLimitVarFromModal);

  modal.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeLimitVarModal();
  });

  valueInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveLimitVarFromModal();
  });

  console.log('[Limits] Modal event listeners attached');
}

// Try to attach listeners after a short delay (modals load dynamically)
setTimeout(attachLimitModalEventListeners, 100);
