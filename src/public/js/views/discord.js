/**
 * Admin Panel - Discord View
 */

async function loadDiscordView() {
  // Check if credentials are set
  const identifier = document.getElementById('rootCredentials').value.trim();
  const hasCredential = document.getElementById('rootPassword').value.length > 0 || sessionStorage.getItem('sessionToken');
  if (!identifier || !hasCredential) {
    showCredentialsRequiredView('discord');
    return;
  }

  // Check permissions
  if (!permissions.canAccessView('discord')) {
    permissions.showPermissionDeniedView(document.getElementById('contentPanel'), 'discord');
    return;
  }

  try {
    const status = await apiCall('getDiscordStatus');
    state.discordStatus = status || { isConnected: false, isConfigured: false };
  } catch (error) {
    console.error('[Discord] Failed to load status:', error);
    permissions.showPermissionDeniedView(document.getElementById('contentPanel'), 'discord');
    return;
  }

  const contentPanel = document.getElementById('contentPanel');
  const status = state.discordStatus;

  contentPanel.innerHTML = `
    <div class="content-panel-header" style="position: relative;">
      <h2 class="content-panel-title">🎮 Discord</h2>
      <div class="content-panel-actions">
        <button type="button" class="secondary-button" data-action="refresh" title="Refresh">↻ Refresh</button>
      </div>
      <button type="button" class="status-pill" data-action="toggle-discord" title="${status.isConnected ? 'Click to disconnect' : 'Click to connect'}" style="cursor: pointer; border: 1px solid var(--line-strong); background: rgba(255, 255, 255, 0.05); position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);">
        <span class="status-dot" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${status.isConnected ? '#8df0b5' : '#ff8585'}; box-shadow: 0 0 8px ${status.isConnected ? 'rgba(141, 240, 181, 0.8)' : 'rgba(255, 133, 133, 0.8)'};"></span>
        <span id="discordStatusText" style="color: var(--text);">${status.isConnected ? 'Connected' : 'Disconnected'}</span>
      </button>
    </div>

    <div class="compact-card" style="cursor: default; margin-bottom: 16px; padding: 10px 12px;">
      <div class="compact-card-icon" style="background: rgba(141, 240, 181, 0.1); border-color: rgba(141, 240, 181, 0.3); flex-shrink: 0;">
        🌐
      </div>
      <div class="compact-card-body" style="flex: 1;">
        <button type="button" class="secondary-button" data-action="open-developer-portal" style="font-size: 0.9rem; padding: 6px 10px; width: fit-content;">Open Discord Developer Portal</button>
      </div>
    </div>

    <div class="content-panel-body">
      <!-- Developer Portal Settings -->
      <div style="font-size: 0.8rem; color: var(--text-secondary); margin: 16px 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px;">🌐 Developer Portal</div>
      
      ${renderDiscordEntry(
        'Bot Token',
        status.botToken ? '••••••••' : null,
        'edit-bot-token',
        '🔑',
        'Developer Portal → Your App → Bot → Reset Token → Paste here'
      )}
      ${renderDiscordEntry(
        'Client ID',
        status.clientId,
        'edit-client-id',
        '🆔',
        'Developer Portal → Your App → OAuth2 → Copy Client ID'
      )}
      ${renderDiscordEntry(
        'Client Secret',
        status.clientSecret ? '••••••••' : null,
        'edit-client-secret',
        '🔐',
        'Developer Portal → Your App → OAuth2 → Reset Secret → Copy'
      )}
      ${renderDiscordEntry(
        'Redirect URI',
        status.redirectUri,
        'edit-redirect-uri',
        '🔀',
        'Developer Portal → Your App → OAuth2 → Add Redirect → Copy here'
      )}
      ${renderDiscordEntry(
        'Permissions',
        status.permissionsInteger,
        'edit-permissions',
        '⚙️',
        'Developer Portal → Your App → Bot → Permission integer. Default: 66560 (Send Messages + Read History)'
      )}

      <!-- Discord Server Settings -->
      <div style="font-size: 0.8rem; color: var(--text-secondary); margin: 16px 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px;">💬 Discord Server</div>
      
      ${renderDiscordEntry(
        'Webhook URL',
        status.webhookUrl,
        'edit-webhook-url',
        '🔗',
        'Discord Server → Settings → Integrations → Webhooks → New Webhook → Copy URL'
      )}
      ${renderDiscordEntry(
        'Channel ID',
        status.channelId,
        'edit-channel-id',
        '📺',
        'Discord → Right-click channel → Copy ID (enable Developer Mode in Settings)'
      )}
      ${renderDiscordEntry(
        'Invite URL',
        status.discordInviteUrl,
        'edit-invite-url',
        '📤',
        'Discord Server → Invite Settings → Copy Invite Link'
      )}
    </div>
  `;

  attachDiscordEventListeners();
}

function renderDiscordEntry(label, value, action, icon, instruction) {
  const isSet = value && value !== '';
  
  return `
    <div class="compact-card" data-action="${action}" style="cursor: pointer; margin-bottom: 8px; padding: 10px 12px;">
      <div class="compact-card-icon" style="width: 32px; height: 32px; font-size: 1rem; background: ${isSet ? 'rgba(141, 240, 181, 0.1)' : 'rgba(255, 100, 100, 0.1)'}; border-color: ${isSet ? 'rgba(141, 240, 181, 0.3)' : 'rgba(255, 100, 100, 0.3)'}; flex-shrink: 0;">
        ${icon}
      </div>
      <div class="compact-card-body" style="flex: 1; min-width: 0;">
        <div class="compact-card-title" style="font-size: 0.9rem; margin-bottom: 2px;">
          ${escapeHtml(label)}
        </div>
        <div class="compact-card-meta" style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
          ${isSet 
            ? `<span class="info-pill" style="font-size: 0.75rem; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(value)}</span>`
            : `<span style="color: var(--error); font-size: 0.75rem;">Not set</span>`
          }
        </div>
        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 4px;">${escapeHtml(instruction)}</div>
      </div>
      <button type="button" class="secondary-button" data-action="${action}" title="Edit" style="padding: 4px 8px; font-size: 0.85rem; flex-shrink: 0;">✏️</button>
    </div>
  `;
}

function attachDiscordEventListeners() {
  console.log('[Discord] Attaching event listeners...');
  
  document.querySelector('[data-action="toggle-discord"]')?.addEventListener('click', handleToggleDiscord);
  document.querySelector('[data-action="refresh"]')?.addEventListener('click', loadDiscordView);
  document.querySelector('[data-action="open-developer-portal"]')?.addEventListener('click', () => {
    window.open('https://discord.com/developers/applications', '_blank');
  });

  ['edit-bot-token', 'edit-channel-id', 'edit-webhook-url', 'edit-client-id', 'edit-client-secret', 'edit-redirect-uri', 'edit-permissions', 'edit-invite-url'].forEach(action => {
    const elements = document.querySelectorAll(`[data-action="${action}"]`);
    console.log(`[Discord] Found ${elements.length} elements for ${action}`);
    elements.forEach(el => {
      el.addEventListener('click', (e) => {
        console.log('[Discord] Edit button clicked:', action);
        e.stopPropagation();
        handleEditDiscordField(action);
      });
    });
  });
}

async function handleEditDiscordField(fieldAction) {
  console.log('[Discord Modal] Opening modal for:', fieldAction);
  
  const fieldConfig = {
    'edit-bot-token': { label: 'Bot Token', type: 'password', placeholder: 'Discord bot token', key: 'botToken', help: 'Developer Portal → Your App → Bot → Reset Token' },
    'edit-channel-id': { label: 'Channel ID', type: 'text', placeholder: 'Channel ID', key: 'channelId', help: 'Discord → Right-click channel → Copy ID (enable Developer Mode)' },
    'edit-webhook-url': { label: 'Webhook URL', type: 'url', placeholder: 'https://discord.com/api/webhooks/ID/TOKEN', key: 'webhookUrl', help: 'Discord Server → Settings → Integrations → Webhooks → Copy URL' },
    'edit-client-id': { label: 'Client ID', type: 'text', placeholder: 'OAuth2 Client ID', key: 'clientId', help: 'Developer Portal → Your App → OAuth2 → Client ID' },
    'edit-client-secret': { label: 'Client Secret', type: 'password', placeholder: 'OAuth2 Client Secret', key: 'clientSecret', help: 'Developer Portal → Your App → OAuth2 → Reset Secret' },
    'edit-redirect-uri': { label: 'Redirect URI', type: 'url', placeholder: 'https://yourdomain.com/callback', key: 'redirectUri', help: 'Developer Portal → Your App → OAuth2 → Add Redirect' },
    'edit-permissions': { label: 'Permissions Integer', type: 'text', placeholder: '66560', key: 'permissionsInteger', help: 'Default: 66560 (Send Messages + Read History)' },
    'edit-invite-url': { label: 'Invite URL', type: 'url', placeholder: 'https://discord.gg/invite', key: 'discordInviteUrl', help: 'Discord Server → Invite Settings → Copy Invite Link' }
  };

  const config = fieldConfig[fieldAction];
  if (!config) {
    console.error('[Discord Modal] No config for:', fieldAction);
    return;
  }

  openDiscordSettingModal(fieldAction, config);
}

async function saveDiscordField(key, value) {
  try {
    const config = { [key]: value };
    const result = await apiCall('updateDiscordConfig', [config, false]);
    if (result.success) {
      showToast(`${key} updated`);
      await loadDiscordView();
    } else {
      showToast(`Failed: ${result.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('[Discord] Save failed:', error);
    showToast(`Failed: ${error.message}`);
  }
}

// Modal event handlers
function openDiscordSettingModal(fieldAction, fieldConfig) {
  console.log('[Discord Modal] openDiscordSettingModal called with:', fieldAction, fieldConfig);
  
  const currentValue = state.discordStatus[fieldConfig.key] || '';
  const isMasked = currentValue && currentValue.includes('•');

  const modal = document.getElementById('editDiscordSettingModal');
  const labelEl = document.getElementById('editDiscordSettingLabel');
  const valueInput = document.getElementById('editDiscordSettingValue');
  const helpEl = document.getElementById('editDiscordSettingHelp');
  const keyInput = document.getElementById('editDiscordSettingKey');

  console.log('[Discord Modal] Elements:', { modal, labelEl, valueInput, helpEl, keyInput });

  if (!modal || !labelEl || !valueInput || !helpEl || !keyInput) {
    console.error('[Discord Modal] Modal elements not found!');
    return;
  }

  labelEl.textContent = fieldConfig.label;
  valueInput.placeholder = fieldConfig.placeholder;
  valueInput.type = fieldConfig.type;
  helpEl.textContent = fieldConfig.help;
  keyInput.value = fieldConfig.key;
  valueInput.value = isMasked ? '' : currentValue;

  console.log('[Discord Modal] Showing modal');
  modal.classList.add('active');
  valueInput.focus();
}

function closeDiscordSettingModal() {
  const modal = document.getElementById('editDiscordSettingModal');
  if (modal) {
    modal.classList.remove('active');
  }
}

function saveDiscordSettingFromModal() {
  const modal = document.getElementById('editDiscordSettingModal');
  const keyInput = document.getElementById('editDiscordSettingKey');
  const valueInput = document.getElementById('editDiscordSettingValue');

  if (!modal || !keyInput || !valueInput) return;

  const key = keyInput.value;
  const value = valueInput.value.trim();

  console.log('[Discord Modal] Saving:', key, '=', value);

  // Permissions can be empty (defaults to 66560)
  if (!value && key !== 'permissionsInteger') {
    showToast('Value is required');
    valueInput.focus();
    return;
  }

  // Permissions defaults to 66560 if empty
  const finalValue = value || (key === 'permissionsInteger' ? '66560' : '');
  
  saveDiscordField(key, finalValue);
  closeDiscordSettingModal();
}

// Attach modal listeners after modals are loaded
function attachDiscordSettingModalListeners() {
  console.log('[Discord Modal] Attaching listeners...');
  
  const closeBtn = document.getElementById('editDiscordSettingCloseBtn');
  const cancelBtn = document.getElementById('editDiscordSettingCancelBtn');
  const saveBtn = document.getElementById('editDiscordSettingSaveBtn');
  const modal = document.getElementById('editDiscordSettingModal');
  const valueInput = document.getElementById('editDiscordSettingValue');

  if (!closeBtn || !cancelBtn || !saveBtn || !modal || !valueInput) {
    console.log('[Discord Modal] Modal elements not found, will retry...');
    return;
  }

  closeBtn.addEventListener('click', closeDiscordSettingModal);
  cancelBtn.addEventListener('click', closeDiscordSettingModal);
  saveBtn.addEventListener('click', saveDiscordSettingFromModal);
  
  modal.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDiscordSettingModal();
  });
  
  valueInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveDiscordSettingFromModal();
  });
  
  console.log('[Discord Modal] Listeners attached successfully');
}

// Try to attach listeners after modals are loaded
setTimeout(attachDiscordSettingModalListeners, 100);

async function handleToggleDiscord() {
  const status = state.discordStatus;
  
  if (status.isConnected) {
    // Disconnect
    try {
      await apiCall('stopDiscord');
      showToast('Discord disconnected!');
      await loadDiscordView();
    } catch (error) {
      console.error('[Discord] Disconnect failed:', error);
      showToast(`Failed: ${error.message}`);
    }
  } else {
    // Connect - check if ALL required fields are set
    const requiredFields = ['botToken', 'channelId', 'webhookUrl', 'clientId', 'clientSecret', 'redirectUri', 'discordInviteUrl'];
    const missingFields = requiredFields.filter(field => !state.discordStatus[field]);
    
    if (missingFields.length > 0) {
      showToast(`Set all required fields first: ${missingFields.join(', ')}`);
      return;
    }
    
    // Connect
    try {
      const result = await apiCall('startDiscord');
      if (result.success) {
        showToast('Discord connected!');
        await loadDiscordView();
      } else {
        showToast(`Failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('[Discord] Connect failed:', error);
      showToast(`Failed: ${error.message}`);
    }
  }
}
