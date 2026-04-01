/**
 * Admin Panel - Files View
 */

const PREDEFINED_MIME_TYPES = [
  { type: 'image/png', emoji: '🖼️' }, { type: 'image/jpeg', emoji: '🖼️' },
  { type: 'image/gif', emoji: '🖼️' }, { type: 'image/webp', emoji: '🖼️' },
  { type: 'video/mp4', emoji: '🎬' }, { type: 'video/webm', emoji: '🎬' },
  { type: 'audio/mpeg', emoji: '🎵' }, { type: 'audio/wav', emoji: '🎵' }
];
const PREDEFINED_TYPE_LIST = PREDEFINED_MIME_TYPES.map(t => t.type);

async function loadFilesView() {
  const allFiles = await apiCall('listFiles');
  state.files = allFiles || {};
  state.filesCurrentTab = state.filesCurrentTab || 'all';

  const categories = await apiCall('getCategories');
  // TODO: get these from files.ts DEFAULT_CATEGORIES somehow.
  state.filesCategories = categories || ['concord', 'clan_logos', 'clan_icons', 'chat_badges'];

  try {
    const result = await apiCall('getAllowedMimeTypes');
    state.allowedMimeTypes = Array.isArray(result) && result.length > 0 ? result : PREDEFINED_MIME_TYPES.map(t => t.type);
  } catch (e) {
    state.allowedMimeTypes = PREDEFINED_MIME_TYPES.map(t => t.type);
  }

  const sortedCategories = ['concord', ...state.filesCategories.filter(c => c !== 'concord').sort()];
  state.filesCategories = sortedCategories;

  await loadView('files', renderFilesView);
}

async function renderFilesView() {
  // Clear search query when loading the view
  state.filesSearchQuery = '';
  const searchInput = document.getElementById('files-search-input');
  if (searchInput) searchInput.value = '';

  // Build file counts
  const fileCounts = {};
  let totalFiles = 0;
  for (const category of state.filesCategories) {
    fileCounts[category] = (state.files[category] || []).length;
    totalFiles += fileCounts[category];
  }

  // Get allowed MIME types
  try {
    const result = await apiCall('getAllowedMimeTypes');
    state.allowedMimeTypes = Array.isArray(result) && result.length > 0 ? result : PREDEFINED_MIME_TYPES.map(t => t.type);
  } catch (e) {
    state.allowedMimeTypes = PREDEFINED_MIME_TYPES.map(t => t.type);
  }

  // Get custom MIME types (stored separately)
  try {
    const customResult = await apiCall('getCustomMimeTypes');
    state.customMimeTypes = Array.isArray(customResult) ? customResult : [];
    console.log('[Files] Custom MIME types loaded:', state.customMimeTypes);
  } catch (e) {
    console.error('[Files] Failed to load custom MIME types:', e);
    state.customMimeTypes = [];
  }

  const sortedCategories = ['concord', ...state.filesCategories.filter(c => c !== 'concord').sort()];
  state.filesCategories = sortedCategories;

  // Build list: predefined types (toggle only) + custom types (toggle + delete)
  const allMimeTypes = [
    ...PREDEFINED_MIME_TYPES.map(item => ({ ...item, isPredefined: true, isCustom: false })),
    ...state.customMimeTypes.map(type => ({
      type,
      emoji: '📄',
      isPredefined: false,
      isCustom: true
    }))
  ];

  // Update UI
  document.getElementById('files-total-count').textContent = `${totalFiles} total`;
  renderFilesMimeTypes(allMimeTypes);
  renderFilesCategoryTabs(fileCounts);
  renderFilesResults();
  attachFilesSearchListener();
}

function renderFilesMimeTypes(allMimeTypes) {
  const section = document.getElementById('files-mime-types-section');
  const grid = document.getElementById('files-mime-types-grid');
  
  if (!permissions.canPerformAction('setAllowedMimeTypes')) {
    section.style.display = 'none';
    return;
  }
  
  section.style.display = 'block';
  grid.innerHTML = `
    ${allMimeTypes.map(item => {
      const isCustom = item.isCustom;
      const isEnabled = state.allowedMimeTypes.includes(item.type);
      const dotColor = isEnabled ? 'var(--accent)' : '#ff8585';
      const dotShadow = isEnabled ? '0 0 12px rgba(141, 240, 181, 0.8)' : '0 0 12px rgba(255, 133, 133, 0.8)';
      
      // Custom types have delete button, all types are toggleable by clicking anywhere
      // TODO: don't embed stringified HTML in the javascript.
      return `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 10px; border-radius: 6px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.1); color: var(--text); font-size: 0.8rem; cursor: pointer;" 
          data-action="toggle-mime-type" data-type="${item.type}" data-enabled="${isEnabled}">
          <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
            <span style="width: 8px; height: 8px; border-radius: 50%; background: ${dotColor}; box-shadow: ${dotShadow};"></span>
            <span>${item.emoji || '📄'} ${item.type}</span>
          </div>
          ${isCustom ? `<button type="button" class="danger-button" data-action="remove-mime-type" data-type="${item.type}" title="Delete">🗑️</button>` : ''}
        </div>
      `;
    }).join('')}
    <button type="button" data-action="open-add-mime-type"
      style="display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; padding: 6px 10px; border-radius: 6px; background: rgba(141, 240, 181, 0.1); border: 1px dashed var(--accent); color: var(--accent); font-size: 1.2rem;">
      <span style="pointer-events: none;">➕</span><span style="font-size: 0.75rem; pointer-events: none;">Add Type</span>
    </button>
  `;
}

function renderFilesCategoryTabs(fileCounts) {
  const container = document.getElementById('files-category-tabs');
  container.innerHTML = `
    <button type="button" class="secondary-button" data-action="set-files-tab" data-tab="all"
      style="background: ${state.filesCurrentTab === 'all' ? 'rgba(141, 240, 181, 0.2)' : 'transparent'}; border-color: ${state.filesCurrentTab === 'all' ? 'var(--accent)' : 'rgba(255, 255, 255, 0.1)'}">
      📋 All (${Object.values(fileCounts).reduce((a, b) => a + b, 0)})
    </button>
    ${state.filesCategories.map(cat => `
      <button type="button" class="secondary-button" data-action="set-files-tab" data-tab="${cat}"
        style="background: ${state.filesCurrentTab === cat ? 'rgba(141, 240, 181, 0.2)' : 'transparent'}; border-color: ${state.filesCurrentTab === cat ? 'var(--accent)' : 'rgba(255, 255, 255, 0.1)'}">
        ${getCategoryIcon(cat)} ${formatCategoryName(cat)} (${fileCounts[cat]})
      </button>
    `).join('')}
  `;
}

function renderFilesResults() {
  const container = document.getElementById('files-results');
  if (!container) return;

  const currentFiles = (state.files[state.filesCurrentTab] || []).filter(f => {
    if (!state.filesSearchQuery) return true;
    const query = state.filesSearchQuery.toLowerCase();
    return f.name.toLowerCase().includes(query) || f.category.toLowerCase().includes(query);
  });

  if (state.filesCurrentTab === 'all') {
    // Show all files grouped by category
    const entries = Object.entries(state.files).filter(([_, files]) => files.length > 0);
    if (entries.length === 0) {
      // TODO: don't embed stringified HTML in the javascript.
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📁</div><div class="empty-state-title">No Files</div><div class="empty-state-description">No files found. Click "Upload File" to add one.</div></div>`;
      return;
    }
    container.innerHTML = entries.map(([cat, files]) => `
      <h3 style="margin: 16px 0 8px; color: var(--accent);">${getCategoryIcon(cat)} ${formatCategoryName(cat)} (${files.length})</h3>
      ${files.filter(f => !state.filesSearchQuery || f.name.toLowerCase().includes(state.filesSearchQuery.toLowerCase())).map(file => renderFileCard(file)).join('')}
    `).join('');
  } else {
    // Show files for specific category
    if (currentFiles.length === 0) {
      // TODO: don't embed stringified HTML in the javascript.
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📁</div><div class="empty-state-title">No Files</div><div class="empty-state-description">No files found in this category.</div></div>`;
      return;
    }
    container.innerHTML = currentFiles.map(file => renderFileCard(file)).join('');
  }
}

function attachFilesSearchListener() {
  const searchInput = document.getElementById('files-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.filesSearchQuery = e.target.value;
      renderFilesResults();
    });
  }
}

function handleFilesSearch(inputElement) {
  state.filesSearchQuery = inputElement.value;
  
  // Get files for current category with search filtering
  const currentFiles = (state.files[state.filesCurrentTab] || []).filter(f => {
    if (!state.filesSearchQuery) return true;
    const query = state.filesSearchQuery.toLowerCase();
    return f.name.toLowerCase().includes(query) || f.category.toLowerCase().includes(query);
  });

  // Build file counts
  const fileCounts = {};
  let totalFiles = 0;
  for (const category of state.filesCategories) {
    fileCounts[category] = (state.files[category] || []).length;
    totalFiles += fileCounts[category];
  }

  // Only update the results container, not the entire view
  const resultsContainer = document.getElementById('filesResults');
  if (resultsContainer) {
    if (totalFiles === 0 && !state.filesSearchQuery) {
      // TODO: don't embed stringified HTML in the javascript.
      resultsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📁</div>
          <div class="empty-state-title">No Files</div>
          <div class="empty-state-description">No files found in the cache. Click "Upload File" to add one.</div>
        </div>
      `;
    } else if (state.filesCurrentTab === 'all') {
      resultsContainer.innerHTML = Object.entries(state.files).filter(([_, files]) => files.length > 0).map(([cat, files]) => `
        <h3 style="margin: 16px 0 8px; color: var(--accent);">${getCategoryIcon(cat)} ${formatCategoryName(cat)} (${files.length})</h3>
        ${files.filter(f => !state.filesSearchQuery || f.name.toLowerCase().includes(state.filesSearchQuery.toLowerCase())).map(file => renderFileCard(file)).join('')}
      `).join('');
    } else {
      if (currentFiles.length === 0) {
        // TODO: don't embed stringified HTML in the javascript.
        resultsContainer.innerHTML = '<div class="empty-state" style="padding: 20px;"><div class="empty-state-description">No files in this category matching your search.</div></div>';
      } else {
        resultsContainer.innerHTML = `
          <h3 style="margin: 16px 0 8px; color: var(--accent);">${getCategoryIcon(state.filesCurrentTab)} ${formatCategoryName(state.filesCurrentTab)} (${fileCounts[state.filesCurrentTab]})</h3>
          ${currentFiles.map(file => renderFileCard(file)).join('')}
        `;
      }
    }
  }
}

function setFilesTab(tab) {
  state.filesCurrentTab = tab;
  loadFilesView();
}

// TODO: get these from files.ts DEFAULT_CATEGORIES somehow.
function getCategoryIcon(category) {
  const icons = {
    'concord': '🍇',
    'clan_logos': '🏳️',
    'clan_icons': '🛡️',
    'chat_badges': '⭐'
  };
  return icons[category] || '📁';
}

function formatCategoryName(category) {
  return category.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function renderFileCard(file) {
  const fileUrl = `/files/${file.category}/${encodeURIComponent(file.name)}`;
  const sizeKB = (file.size / 1024).toFixed(1);
  const uploadedDate = new Date(file.uploadedAt).toLocaleDateString();

  // Determine if this is a small image that should be upscaled with pixelated rendering
  // TODO: We need to actually check the size of the image, not go by filename/category.
  const isSmallImage = file.name.toLowerCase().includes('48') ||
                       file.name.toLowerCase().includes('icon') ||
                       file.category === 'clan_icons' ||
                       file.category === 'chat_badges';

  // TODO: don't embed stringified HTML in the javascript.
  return `
    <div class="compact-card" data-file-category="${file.category}" data-file-name="${escapeHtml(file.name)}">
      <div class="compact-card-icon" style="background: rgba(141, 240, 181, 0.1); display: flex; align-items: center; justify-content: center; overflow: hidden;">
        <img src="${fileUrl}" alt="${escapeHtml(file.name)}" style="width: 100%; height: 100%; object-fit: cover; image-rendering: ${isSmallImage ? 'pixelated' : 'auto'};">
      </div>
      <div class="compact-card-body">
        <div class="compact-card-title">${escapeHtml(file.name)}</div>
        <div class="compact-card-meta">
          <span class="compact-badge compact-badge-type">${escapeHtml(file.category.replace('_', ' '))}</span>
          <span class="info-pill">📊 ${sizeKB} KB</span>
          <span class="info-pill">📅 ${uploadedDate}</span>
        </div>
      </div>
      <div class="compact-card-actions">
        <button type="button" class="secondary-button" data-action="preview-file" title="Preview file">👁️</button>
        <button type="button" class="secondary-button" data-action="copy-file-url" title="Copy file URL">🔗</button>
        <button type="button" class="secondary-button" data-action="set-as-favicon" title="Set as site favicon">🌐</button>
        <button type="button" class="danger-button" data-action="delete-file" title="Delete file">🗑️</button>
      </div>
    </div>
  `;
}

function previewFile(category, name, size, uploadedAt) {
  const fileUrl = `/files/${category}/${encodeURIComponent(name)}`;
  const sizeKB = (size / 1024).toFixed(1);
  const uploadedDate = new Date(uploadedAt).toLocaleString();

  const imgElement = document.getElementById('previewFileImg');
  imgElement.src = fileUrl;

  // Reset any previous styles
  imgElement.style.maxWidth = '';
  imgElement.style.maxHeight = '';
  imgElement.style.imageRendering = '';
  imgElement.style.width = '';
  imgElement.style.height = '';

  // Load image to get actual dimensions, then scale appropriately
  const tempImg = new Image();
  tempImg.onload = function() {
    const naturalWidth = tempImg.naturalWidth;
    const naturalHeight = tempImg.naturalHeight;

    // Target bounds: 600x300 rectangle
    const maxWidth = 600;
    const maxHeight = 300;

    // Calculate scale factor to fit within bounds
    const scaleX = maxWidth / naturalWidth;
    const scaleY = maxHeight / naturalHeight;
    const scale = Math.min(scaleX, scaleY, 1); // Don't scale up beyond bounds, but allow upscaling

    // For very small images, upscale to at least 100px
    const minDisplaySize = 100;
    let displayWidth = naturalWidth * scale;
    let displayHeight = naturalHeight * scale;

    if (displayWidth < minDisplaySize || displayHeight < minDisplaySize) {
      const upscaleFactor = Math.max(minDisplaySize / displayWidth, minDisplaySize / displayHeight);
      displayWidth = Math.min(displayWidth * upscaleFactor, maxWidth);
      displayHeight = Math.min(displayHeight * upscaleFactor, maxHeight);
    }

    imgElement.style.width = `${displayWidth}px`;
    imgElement.style.height = `${displayHeight}px`;

    // Use pixelated rendering for pixel art (small images)
    if (naturalWidth <= 128 || naturalHeight <= 128) {
      imgElement.style.imageRendering = 'pixelated';
    }
  };
  tempImg.src = fileUrl;

  document.getElementById('previewFileInfo').textContent = `${name} • ${sizeKB} KB • Uploaded: ${uploadedDate}`;
  document.getElementById('previewFileModal').classList.add('active');
}

function closePreviewFileModal() {
  document.getElementById('previewFileModal').classList.remove('active');
}

async function uploadFile() {
  const category = document.getElementById('uploadFileCategory').value;
  const fileInput = document.getElementById('uploadFileFile');
  const customName = document.getElementById('uploadFileName').value.trim();

  if (!fileInput.files || fileInput.files.length === 0) {
    showToast('Please select a file');
    return;
  }

  const file = fileInput.files[0];
  const fileName = customName || file.name;

  // Read file as base64
  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const dataUrl = e.target.result;
      // Extract MIME type from data URL (e.g., "data:image/png;base64,")
      const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : file.type || 'application/octet-stream';
      const base64Data = dataUrl.split(',')[1]; // Remove data:...;base64, prefix

      await apiCall('uploadFile', [category, fileName, base64Data, mimeType]);
      showToast('File uploaded successfully');
      closeUploadFileModal();
      loadCurrentView();
    } catch (error) {
      showToast(`Error: ${error.message}`);
    }
  };
  reader.onerror = () => {
    showToast('Failed to read file');
  };
  reader.readAsDataURL(file);
}

function openUploadFileModal() {
  document.getElementById('uploadFileFile').value = '';
  document.getElementById('uploadFileName').value = '';

  // Populate categories dynamically
  // TODO: get these from files.ts DEFAULT_CATEGORIES somehow.
  const categories = state.filesCategories || ['concord', 'clan_logos', 'clan_icons', 'chat_badges'];
  const categorySelect = document.getElementById('uploadFileCategory');
  categorySelect.innerHTML = categories.map(cat =>
    `<option value="${cat}">${formatCategoryName(cat)}</option>`
  ).join('');

  document.getElementById('uploadFileModal').classList.add('active');
}

function closeUploadFileModal() {
  document.getElementById('uploadFileModal').classList.remove('active');
}

function setAsFavicon(category, fileName) {
  const sessionToken = sessionStorage.getItem('sessionToken');

  fetch('/dashboard/files/favicon', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Token': sessionToken || ''
    },
    body: JSON.stringify({ category, name: fileName })
  }).then(response => {
    if (response.ok) {
      // Update the favicon link
      const faviconLink = document.querySelector('link[rel="icon"]');
      if (faviconLink) {
        faviconLink.href = `/files/${category}/${encodeURIComponent(fileName)}?t=${Date.now()}`;
      }
      showToast(`Favicon set to ${fileName}`);
    } else {
      return response.json().then(data => {
        throw new Error(data.error || 'Failed to set favicon');
      });
    }
  }).catch(err => {
    showToast(`Error: ${err.message}`);
  });
}

async function deleteFile(category, fileName) {
  if (!confirm(`Are you sure you want to delete ${fileName}?`)) {
    return;
  }

  try {
    await apiCall('deleteFile', [category, fileName]);
    showToast('File deleted');
    loadCurrentView();
  } catch (error) {
    showToast(`Error: ${error.message}`);
  }
}

// Make functions globally accessible
window.loadFilesView = loadFilesView;
window.openUploadFileModal = openUploadFileModal;
window.closeUploadFileModal = closeUploadFileModal;
window.uploadFile = uploadFile;
window.setFilesTab = setFilesTab;
window.handleFilesSearch = handleFilesSearch;
window.getCategoryIcon = getCategoryIcon;
window.formatCategoryName = formatCategoryName;
window.renderFileCard = renderFileCard;
window.previewFile = previewFile;
window.closePreviewFileModal = closePreviewFileModal;
window.setAsFavicon = setAsFavicon;
window.deleteFile = deleteFile;
window.openAddCategoryModal = openAddCategoryModal;
window.closeAddCategoryModal = closeAddCategoryModal;
window.addCategory = addCategory;
window.toggleMimeType = toggleMimeType;
window.removeMimeType = removeMimeType;
window.openAddMimeTypeModal = openAddMimeTypeModal;
window.closeAddMimeTypeModal = closeAddMimeTypeModal;
window.saveAddMimeType = saveAddMimeType;

function openAddMimeTypeModal() {
  document.getElementById('addMimeTypeValue').value = '';
  document.getElementById('addMimeTypeModal').classList.add('active');
}

function closeAddMimeTypeModal() {
  document.getElementById('addMimeTypeModal').classList.remove('active');
}

async function saveAddMimeType() {
  const input = document.getElementById('addMimeTypeValue');
  const mimeType = input.value.trim();

  if (!mimeType) {
    showToast('Please enter a MIME type');
    return;
  }

  // Basic MIME type validation
  if (!/^[a-z]+\/[a-z0-9.+_-]+$/i.test(mimeType)) {
    showToast('Invalid MIME type format (e.g., image/png)');
    return;
  }

  try {
    // Add to custom types (persists even when toggled off)
    await apiCall('addCustomMimeType', [mimeType]);

    // Get current allowed types (server includes predefined + custom)
    const currentTypes = await apiCall('getAllowedMimeTypes') || [];

    // Add the new MIME type if not already present
    const newTypes = currentTypes.includes(mimeType) ? currentTypes : [...currentTypes, mimeType];

    await apiCall('setAllowedMimeTypes', newTypes);

    closeAddMimeTypeModal();
    await loadFilesView();
    showToast('MIME type added');
  } catch (error) {
    showToast(`Error: ${error.message}`);
  }
}

async function toggleMimeType(mimeType, enable) {
  try {
    const currentTypes = await apiCall('getAllowedMimeTypes') || [];
    
    let newTypes;
    if (enable) {
      // Add type if not already present
      newTypes = currentTypes.includes(mimeType) ? currentTypes : [...currentTypes, mimeType];
    } else {
      // Remove type from allowed list
      newTypes = currentTypes.filter(t => t !== mimeType);
    }

    await apiCall('setAllowedMimeTypes', newTypes);
    await loadFilesView();
    showToast(enable ? 'MIME type enabled' : 'MIME type disabled');
    return Promise.resolve();
  } catch (error) {
    showToast(`Error: ${error.message}`);
    await loadFilesView();
    return Promise.reject(error);
  }
}

async function removeMimeType(mimeType) {
  // Only allow removing custom types, not predefined ones
  if (PREDEFINED_TYPE_LIST.includes(mimeType)) {
    showToast('Cannot delete predefined MIME types - use toggle to disable');
    return;
  }

  if (!confirm(`Delete '${mimeType}' from allowed types?`)) {
    return;
  }

  try {
    // Remove from custom types
    await apiCall('removeCustomMimeType', [mimeType]);

    // Also remove from allowed types
    const currentTypes = await apiCall('getAllowedMimeTypes') || [];
    const newTypes = currentTypes.filter(t => t !== mimeType);

    if (newTypes.length === 0) {
      showToast('Cannot remove all MIME types');
      return;
    }

    await apiCall('setAllowedMimeTypes', newTypes);
    await loadFilesView();
    showToast('MIME type removed');
  } catch (error) {
    showToast(`Error: ${error.message}`);
  }
}

function openAddCategoryModal() {
  document.getElementById('addCategoryName').value = '';
  document.getElementById('addCategoryModal').classList.add('active');
}

function closeAddCategoryModal() {
  document.getElementById('addCategoryModal').classList.remove('active');
}

async function addCategory() {
  const name = document.getElementById('addCategoryName').value.trim();

  if (!name) {
    showToast('Please enter a category name');
    return;
  }

  try {
    await apiCall('createCategory', [name]);
    showToast('Category created');
    closeAddCategoryModal();
    loadCurrentView();
  } catch (error) {
    showToast(`Error: ${error.message}`);
  }
}
