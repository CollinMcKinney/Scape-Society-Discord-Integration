/**
 * ROOT Login Auto-Submit Script
 * Automatically logs in if sessionToken is in URL
 */

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const sessionToken = urlParams.get('sessionToken');
  
  if (sessionToken) {
    const form = document.getElementById('rootLoginForm');
    const submitBtn = form?.querySelector('button[type="submit"]');
    const errorDiv = document.getElementById('error');
    
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Logging in...';
    }
    
    // Call the login API directly
    fetch('/dashboard/root', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        // Store credentials and redirect
        sessionStorage.setItem('sessionToken', data.sessionToken);
        sessionStorage.setItem('currentUserRole', '6');
        sessionStorage.setItem('currentUsername', data.username || 'ROOT');
        window.location.href = data.redirect || '/admin/';
      } else {
        // Show error
        if (errorDiv) {
          errorDiv.textContent = data.error || 'Login failed';
          errorDiv.style.display = 'block';
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Login as ROOT';
        }
      }
    })
    .catch(err => {
      console.error('Auto-login failed:', err);
      if (errorDiv) {
        errorDiv.textContent = 'Network error';
        errorDiv.style.display = 'block';
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Login as ROOT';
      }
    });
  }
});
