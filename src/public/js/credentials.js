/**
 * Admin Panel - Credentials Management
 */

// =====================
// Credentials
// =====================
function updateSessionSummary() {
  const credentialsInput = document.getElementById('rootCredentials');
  const sessionToken = sessionStorage.getItem('sessionToken');
  const storedUsername = sessionStorage.getItem('currentUsername');
  const summary = document.getElementById('sessionSummary');
  const loginButton = document.getElementById('loginButton');
  const statusDot = loginButton ? loginButton.querySelector('.status-dot') : null;

  // Check if logged in (has session token)
  const isLoggedIn = !!sessionToken;

  if (!isLoggedIn) {
    summary.textContent = 'Not logged in';
    if (statusDot) {
      statusDot.style.background = '#ff8585'; // Red
      statusDot.style.boxShadow = '0 0 12px rgba(255, 133, 133, 0.8)';
    }
    if (loginButton) {
      loginButton.title = 'Click to log in';
      loginButton.style.cursor = 'pointer';
    }
    return;
  }

  // Restore username from sessionStorage on page refresh
  if (storedUsername && (!credentialsInput.value || credentialsInput.value === 'Session User')) {
    credentialsInput.value = storedUsername;
  }
  
  // Show the identifier if available
  const identifier = credentialsInput?.value.trim();
  const shortId = identifier && identifier.length > 15
    ? identifier.slice(0, 15) + '...'
    : (identifier || 'User');
    
  summary.textContent = `Logged in as ${shortId}`;
  if (statusDot) {
    statusDot.style.background = 'var(--accent)'; // Green
    statusDot.style.boxShadow = '0 0 12px rgba(141, 240, 181, 0.8)';
  }
  if (loginButton) {
    loginButton.title = 'Click to logout';
    loginButton.style.cursor = 'pointer';
  }
}

function openCredentialsModal() {
  const modal = document.getElementById('credentialsModal');
  const sessionToken = sessionStorage.getItem('sessionToken');
  
  // Show logout button if already logged in
  const logoutBtn = modal.querySelector('.logout-button');
  if (logoutBtn) {
    logoutBtn.style.display = sessionStorage.getItem('sessionToken') ? 'inline-block' : 'none';
  }
  
  modal.classList.add('active');
}

async function closeCredentialsModal() {
  document.getElementById('credentialsModal').classList.remove('active');

  // Get entered credentials - both username AND password required
  const identifier = document.getElementById('rootCredentials')?.value.trim();
  const credential = document.getElementById('rootPassword')?.value.trim();

  if (!identifier || !credential) {
    // Don't attempt login without both fields
    showToast('Please enter both username and password');
    return;
  }

  console.log('[closeCredentialsModal] Authenticating...', { identifier: !!identifier, credential: !!credential });

  try {
    const result = await apiCall('authenticate', [identifier, credential]);
    
    if (!result) {
      // Authentication failed
      showToast('Invalid username or password');
      // Clear the password field
      document.getElementById('rootPassword').value = '';
      return;
    }
    
    console.log('[closeCredentialsModal] Auth complete: SUCCESS');

    // Reload user permissions after successful login
    await permissions.loadUserPermissions();
    permissions.updateNavVisibility();

    // Store username for page refresh
    sessionStorage.setItem('currentUsername', identifier);

    updateSessionSummary();
  } catch (err) {
    console.error('[closeCredentialsModal] Auth error:', err);
    showToast(`Login failed: ${err.message || 'Invalid credentials'}`);
    // Clear the password field
    document.getElementById('rootPassword').value = '';
    return;
  }

  // Load view AFTER authentication completes
  loadCurrentView();
}

function clearCredentials() {
  document.getElementById('rootCredentials').value = '';
  document.getElementById('rootPassword').value = '';
  sessionStorage.removeItem('sessionToken');
  sessionStorage.removeItem('currentUserRole');
  state.currentUserRole = undefined;
  updateSessionSummary();
}

async function logout() {
  clearCredentials();
  // Reload permissions to set role to BLOCKED
  await permissions.loadUserPermissions();
  // Reload current view to refresh UI
  loadCurrentView();
  showToast('Logged out successfully');
}

// Make logout available globally
window.logout = logout;
