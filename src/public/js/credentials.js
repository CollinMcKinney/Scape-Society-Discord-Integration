/**
 * Admin Panel - Credentials Management
 */

// =====================
// Credentials
// =====================
function updateSessionSummary() {
  const credentialsInput = document.getElementById('rootCredentials');
  const sessionToken = sessionStorage.getItem('sessionToken');
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
    return;
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
}

function openCredentialsModal() {
  document.getElementById('credentialsModal').classList.add('active');
}

async function closeCredentialsModal() {
  document.getElementById('credentialsModal').classList.remove('active');
  
  // Authenticate with the entered credentials
  let identifier = document.getElementById('rootCredentials')?.value.trim();
  let credential = document.getElementById('rootPassword')?.value.trim();
  
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
    try {
      await apiCall('authenticate', [identifier, credential]);
      console.log('[closeCredentialsModal] Auth complete');
      
      // Reload user permissions after successful login
      await permissions.loadUserPermissions();
      permissions.updateNavVisibility();
      updateSessionSummary();
    } catch (err) {
      console.error('[closeCredentialsModal] Auth error:', err);
    }
  }
  
  // Load view AFTER authentication completes
  loadCurrentView();
}

function clearCredentials() {
  document.getElementById('rootCredentials').value = '';
  document.getElementById('rootPassword').value = '';
  sessionStorage.removeItem('sessionToken');
  updateSessionSummary();
}
