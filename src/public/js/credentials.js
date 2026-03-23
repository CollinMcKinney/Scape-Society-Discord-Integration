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
  
  // Authenticate with the entered credentials
  let identifier = document.getElementById('rootCredentials')?.value.trim();
  let credential = document.getElementById('rootPassword')?.value.trim();
  
  // If one field is empty, try using the other as both identifier and credential
  // This allows pasting just the session token in either field
  const wasTokenOnly = (!identifier && credential) || (identifier && !credential);
  
  if (identifier && !credential) {
    credential = identifier;
  } else if (!identifier && credential) {
    identifier = credential;
  }
  
  // If no password entered, try splitting by = (old format: userId=sessionToken)
  if (credential === '' && identifier && identifier.includes('=')) {
    const parts = identifier.split('=');
    if (parts.length === 2) {
      identifier = parts[0].trim();
      credential = parts[1].trim();
      console.log('[closeCredentialsModal] Split credentials:', { identifier: !!identifier, credential: !!credential });
    }
  }
  
  if (identifier && credential) {
    console.log('[closeCredentialsModal] Authenticating...', { identifier: !!identifier, credential: !!credential });
    
    // If logging in with token only, set temporary placeholder
    if (wasTokenOnly) {
      document.getElementById('rootCredentials').value = 'Session User';
    }
    
    try {
      const result = await apiCall('authenticate', [identifier, credential]);
      console.log('[closeCredentialsModal] Auth complete:', result ? 'SUCCESS' : 'FAILED');
      
      // Reload user permissions after successful login
      await permissions.loadUserPermissions();
      permissions.updateNavVisibility();
      
      // If we authenticated with session token only, try to identify the user
      if (result && document.getElementById('rootCredentials').value === 'Session User') {
        try {
          const users = await apiCall('listUsers');
          // Find ROOT user (most likely who's logging in)
          const rootUser = users.find(u => u.osrs_name === 'ROOT');
          if (rootUser) {
            const username = rootUser.osrs_name || 'ROOT';
            document.getElementById('rootCredentials').value = username;
            // Store the actual ROOT role
            state.currentUserRole = rootUser.role || 6;
            sessionStorage.setItem('currentUserRole', (rootUser.role || 6).toString());
            sessionStorage.setItem('currentUsername', username);
          }
        } catch (err) {
          // Keep "Session User" if we can't fetch users
        }
      } else if (result) {
        // Store username for page refresh
        const username = document.getElementById('rootCredentials').value;
        if (username && username !== 'Session User') {
          sessionStorage.setItem('currentUsername', username);
        }
      }
      
      updateSessionSummary();
    } catch (err) {
      console.error('[closeCredentialsModal] Auth error:', err);
      // Reset if auth failed
      if (wasTokenOnly) {
        document.getElementById('rootCredentials').value = '';
      }
    }
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

function logout() {
  clearCredentials();
  // Reload current view to refresh UI
  loadCurrentView();
  showToast('Logged out successfully');
}

// Make logout available globally
window.logout = logout;
