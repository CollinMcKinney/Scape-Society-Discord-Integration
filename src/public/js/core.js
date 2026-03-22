/**
 * Admin Panel - Core Utilities
 */

// =====================
// Helper Functions
// =====================
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getRoleName(roleValue) {
  const roleNames = {
    0: 'BLOCKED',
    1: 'GUEST',
    2: 'MEMBER',
    3: 'MODERATOR',
    4: 'ADMIN',
    5: 'OWNER',
    6: 'ROOT'
  };
  return roleNames[roleValue] || 'MEMBER';
}

function getRoleColor(role) {
  const colors = {
    'ROOT': '#ff8585',
    'OWNER': '#c8ff7f',
    'ADMIN': '#8df0b5',
    'MODERATOR': '#9ab8a7',
    'MEMBER': '#eef7f1',
    'BLOCKED': '#666666',
    'GUEST': '#888888'
  };
  if (role === null || role === undefined) return '#9ab8a7';
  const roleKey = typeof role === 'number' ? getRoleName(role) : String(role).toUpperCase();
  return colors[roleKey] || '#9ab8a7';
}

function showToast(message) {
  const existing = document.querySelector('.toast-notification');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastSlideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

function copyToClipboard(text, message) {
  navigator.clipboard.writeText(text).then(() => {
    showToast(message || `Copied: ${text.slice(0, 20)}...`);
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}
