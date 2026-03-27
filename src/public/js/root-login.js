/**
 * ROOT Login Page Script
 */

document.addEventListener('DOMContentLoaded', () => {
  // Auto-focus the token field
  const tokenInput = document.getElementById('sessionToken');
  if (tokenInput) {
    tokenInput.focus();
  }

  // Handle form submission
  const form = document.getElementById('rootLoginForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const sessionToken = document.getElementById('sessionToken').value;
    const errorDiv = document.getElementById('error');
    const submitBtn = form.querySelector('button[type="submit"]');

    // Disable button during request
    submitBtn.disabled = true;
    submitBtn.textContent = 'Authenticating...';

    try {
      const response = await fetch('/dashboard/root', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Store token in sessionStorage for frontend use
        sessionStorage.setItem('sessionToken', data.sessionToken);
        sessionStorage.setItem('currentUserRole', '6'); // ROOT role
        sessionStorage.setItem('currentUsername', data.username || 'ROOT');
        // Redirect to admin panel
        window.location.href = data.redirect || '/admin/';
      } else {
        // Show error
        if (errorDiv) {
          errorDiv.textContent = data.error || 'Login failed';
          errorDiv.style.display = 'block';
        }
        submitBtn.disabled = false;
        submitBtn.textContent = 'Login as ROOT';
      }
    } catch (err) {
      if (errorDiv) {
        errorDiv.textContent = 'Network error. Please try again.';
        errorDiv.style.display = 'block';
      }
      submitBtn.disabled = false;
      submitBtn.textContent = 'Login as ROOT';
    }
  });
});
