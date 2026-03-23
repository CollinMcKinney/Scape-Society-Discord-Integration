/**
 * Admin Panel - Files View
 */

async function loadFilesView() {
  const allFiles = await apiCall('listFiles');
  state.files = allFiles || {};
  state.filesCurrentTab = state.filesCurrentTab || 'all';

  // Get categories
  const categories = await apiCall('getCategories');
  state.filesCategories = categories || ['clan_icons', 'chat_badges', 'branding'];
  
  // Put branding first, then sort the rest alphabetically
  const sortedCategories = ['branding', ...state.filesCategories.filter(c => c !== 'branding').sort()];
  state.filesCategories = sortedCategories;

  // Build file counts
  const fileCounts = {};
  let totalFiles = 0;
  for (const category of state.filesCategories) {
    fileCounts[category] = (state.files[category] || []).length;
    totalFiles += fileCounts[category];
  }

  // Get files for current category with search filtering
  const currentFiles = (state.files[state.filesCurrentTab] || []).filter(f => {
    if (!state.filesSearchQuery) return true;
    const query = state.filesSearchQuery.toLowerCase();
    return f.name.toLowerCase().includes(query) || f.category.toLowerCase().includes(query);
  });

  contentPanel.innerHTML = `
    <div class="content-panel-header">
      <h2 class="content-panel-title">
        📁 Files
        <span class="compact-badge compact-badge-status">${totalFiles} total</span>
      </h2>
      <div class="content-panel-actions">
        <button type="button" class="primary-button" onclick="openUploadFileModal()" title="Upload a new file">+ Upload File</button>
        <button type="button" class="secondary-button" onclick="openAddCategoryModal()" title="Create a new category">📁 Add Folder</button>
        <button type="button" class="secondary-button" onclick="loadCurrentView()" title="Reload this view from the cache">↻ Refresh</button>
      </div>
    </div>
    <div class="content-panel-body">
      <!-- Sub-tabs for file categories -->
      <div style="display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid var(--line); padding-bottom: 8px; flex-wrap: wrap;">
        <button
          type="button"
          class="secondary-button"
          onclick="setFilesTab('all')"
          style="background: ${state.filesCurrentTab === 'all' ? 'rgba(141, 240, 181, 0.2)' : 'transparent'}; border-color: ${state.filesCurrentTab === 'all' ? 'var(--accent)' : 'rgba(255, 255, 255, 0.1)'}">
          📋 All (${totalFiles})
        </button>
        ${state.filesCategories.map(cat => `
          <button
            type="button"
            class="secondary-button"
            onclick="setFilesTab('${cat}')"
            style="background: ${state.filesCurrentTab === cat ? 'rgba(141, 240, 181, 0.2)' : 'transparent'}; border-color: ${state.filesCurrentTab === cat ? 'var(--accent)' : 'rgba(255, 255, 255, 0.1)'}">
            ${getCategoryIcon(cat)} ${formatCategoryName(cat)} (${fileCounts[cat]})
          </button>
        `).join('')}
      </div>

      <!-- Search bar -->
      <div style="margin-bottom: 16px;">
        <input type="text" id="filesSearchInput" placeholder="Search files..."
          oninput="handleFilesSearch(this);"
          autocomplete="off" name="filesSearch"
          value="${escapeHtml(state.filesSearchQuery || '')}"
          style="width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.1); background: rgba(7, 15, 11, 0.86); color: var(--text); font: inherit; font-size: 0.9rem;">
      </div>

      <!-- Results container -->
      <div id="filesResults">
        ${totalFiles === 0 && !state.filesSearchQuery ? `
          <div class="empty-state">
            <div class="empty-state-icon">📁</div>
            <div class="empty-state-title">No Files</div>
            <div class="empty-state-description">No files found in the cache. Click "Upload File" to add one.</div>
          </div>
        ` : state.filesCurrentTab === 'all' ? `
          ${Object.entries(state.files).filter(([_, files]) => files.length > 0).map(([cat, files]) => `
            <h3 style="margin: 16px 0 8px; color: var(--accent);">${getCategoryIcon(cat)} ${formatCategoryName(cat)} (${files.length})</h3>
            ${files.filter(f => !state.filesSearchQuery || f.name.toLowerCase().includes(state.filesSearchQuery.toLowerCase())).map(file => renderFileCard(file)).join('')}
          `).join('')}
        ` : `
          <h3 style="margin: 16px 0 8px; color: var(--accent);">${getCategoryIcon(state.filesCurrentTab)} ${formatCategoryName(state.filesCurrentTab)} (${fileCounts[state.filesCurrentTab]})</h3>
          ${currentFiles.length === 0 ? '<div class="empty-state" style="padding: 20px;"><div class="empty-state-description">No files in this category yet.</div></div>' : currentFiles.map(file => renderFileCard(file)).join('')}
        `}
      </div>
    </div>
  `;
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

function getCategoryIcon(category) {
  const icons = {
    'clan_icons': '🛡️',
    'chat_badges': '⭐',
    'branding': '🏳️'
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
  const isSmallImage = file.name.toLowerCase().includes('48') ||
                       file.name.toLowerCase().includes('icon') ||
                       file.category === 'clan_icons' ||
                       file.category === 'chat_badges';

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
      const base64Data = e.target.result.split(',')[1]; // Remove data:image/...;base64, prefix

      await apiCall('uploadFile', [category, fileName, base64Data]);
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
  const categories = state.filesCategories || ['clan_icons', 'chat_badges', 'branding'];
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
  
  fetch('/files/favicon', {
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
