/**
 * Admin Panel - Modal Loader
 * Loads all modal HTML files from modals directory
 */

// List of all modal files to load
const MODAL_FILES = [
  'credentials.html',
  'packet.html',
  'set-role.html',
  'add-prefix.html',
  'edit-command-role.html',
  'upload-file.html',
  'preview-file.html',
  'add-category.html',
  'edit-env-var.html',
  'view-json.html'
];

// Load all modals on page load and return promise
window.loadModals = async function() {
  try {
    const container = document.getElementById('modalsContainer');
    if (!container) return;

    // Load all modal files
    const modalPromises = MODAL_FILES.map(async (file) => {
      const response = await fetch(`/modals/${file}`);
      if (response.ok) {
        return await response.text();
      }
      return '';
    });

    const modals = await Promise.all(modalPromises);
    container.innerHTML = modals.join('\n');
    console.log('[Modals] Loaded', MODAL_FILES.length, 'modal files');
  } catch (error) {
    console.error('Failed to load modals:', error);
  }
};

// Auto-load modals on page load
document.addEventListener('DOMContentLoaded', () => {
  window.loadModals();
});

// Modal close functions
function closeViewJsonModal() {
  document.getElementById('viewJsonModal').classList.remove('active');
}

function copyViewJson() {
  const content = document.getElementById('viewJsonContent').textContent;
  navigator.clipboard.writeText(content).then(() => {
    showToast('JSON copied to clipboard');
  }).catch(err => {
    showToast('Failed to copy JSON');
  });
}
