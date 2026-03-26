/**
 * Modal Event Listeners
 * Attaches event listeners to all modal buttons (replaces inline onclick handlers)
 */

function attachModalEventListeners() {
  // ===== View JSON Modal =====
  document.getElementById('viewJsonCloseBtn1')?.addEventListener('click', closeViewJsonModal);
  document.getElementById('viewJsonCloseBtn2')?.addEventListener('click', closeViewJsonModal);
  document.getElementById('viewJsonCopyBtn')?.addEventListener('click', copyViewJson);

  // ===== Credentials Modal =====
  document.getElementById('credentialsCloseBtn')?.addEventListener('click', closeCredentialsModal);
  document.getElementById('credentialsLogoutBtn')?.addEventListener('click', logout);
  document.getElementById('credentialsChangePasswordBtn')?.addEventListener('click', openChangePasswordModal);
  document.getElementById('credentialsClearBtn')?.addEventListener('click', clearCredentials);
  document.getElementById('credentialsLoginBtn')?.addEventListener('click', closeCredentialsModal);

  // ===== Packet Modal =====
  document.getElementById('packetCloseBtn1')?.addEventListener('click', closePacketModal);
  document.getElementById('packetCancelBtn')?.addEventListener('click', closePacketModal);
  document.getElementById('packetSaveBtn')?.addEventListener('click', savePacket);

  // ===== Set Role Modal =====
  document.getElementById('setRoleCloseBtn')?.addEventListener('click', closeSetRoleModal);
  document.getElementById('setRoleCancelBtn')?.addEventListener('click', closeSetRoleModal);
  document.getElementById('setRoleSaveBtn')?.addEventListener('click', saveRoleChange);

  // ===== Add Prefix Modal =====
  document.getElementById('addPrefixCloseBtn')?.addEventListener('click', closeAddPrefixModal);
  document.getElementById('addPrefixCancelBtn')?.addEventListener('click', closeAddPrefixModal);
  document.getElementById('addPrefixSaveBtn')?.addEventListener('click', addPrefix);

  // ===== Edit Command Role Modal =====
  document.getElementById('editCommandRoleCloseBtn')?.addEventListener('click', closeEditCommandRoleModal);
  document.getElementById('editCommandRoleCancelBtn')?.addEventListener('click', closeEditCommandRoleModal);
  document.getElementById('editCommandRoleSaveBtn')?.addEventListener('click', saveCommandRoleChange);

  // ===== Upload File Modal =====
  document.getElementById('uploadFileCloseBtn')?.addEventListener('click', closeUploadFileModal);
  document.getElementById('uploadFileCancelBtn')?.addEventListener('click', closeUploadFileModal);
  document.getElementById('uploadFileSaveBtn')?.addEventListener('click', uploadFile);

  // ===== Preview File Modal =====
  document.getElementById('previewFileCloseBtn')?.addEventListener('click', closePreviewFileModal);
  document.getElementById('previewFileCancelBtn')?.addEventListener('click', closePreviewFileModal);

  // ===== Add Category Modal =====
  document.getElementById('addCategoryCloseBtn')?.addEventListener('click', closeAddCategoryModal);
  document.getElementById('addCategoryCancelBtn')?.addEventListener('click', closeAddCategoryModal);
  document.getElementById('addCategorySaveBtn')?.addEventListener('click', addCategory);

  // ===== Change Password Modal =====
  document.getElementById('changePasswordCloseBtn')?.addEventListener('click', closeChangePasswordModal);
  document.getElementById('changePasswordCancelBtn')?.addEventListener('click', closeChangePasswordModal);
  document.getElementById('changePasswordSaveBtn')?.addEventListener('click', savePasswordChange);

  // ===== Reset Password Modal =====
  document.getElementById('resetPasswordCloseBtn')?.addEventListener('click', closeResetPasswordModal);
  document.getElementById('resetPasswordCancelBtn')?.addEventListener('click', closeResetPasswordModal);
  document.getElementById('resetPasswordSaveBtn')?.addEventListener('click', saveResetPassword);

  // ===== Add MIME Type Modal =====
  document.getElementById('addMimeTypeCloseBtn')?.addEventListener('click', closeAddMimeTypeModal);
  document.getElementById('addMimeTypeCancelBtn')?.addEventListener('click', closeAddMimeTypeModal);
  document.getElementById('addMimeTypeSaveBtn')?.addEventListener('click', saveAddMimeType);
}

// Export for use in modals.js
window.attachModalEventListeners = attachModalEventListeners;
