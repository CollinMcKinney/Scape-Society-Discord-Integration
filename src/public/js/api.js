/**
 * Admin Panel - API Communication
 */

// =====================
// API Calls
// =====================
async function apiCall(functionName, args = []) {
  const identifier = document.getElementById('rootCredentials').value.trim();
  let credential = sessionStorage.getItem('sessionToken');
  
  // If no session token, use the password (will authenticate and get a token)
  if (!credential) {
    credential = document.getElementById('rootPassword').value.trim();
  }
  
  // For authenticate calls, pass credentials directly without wrapping
  if (functionName === 'authenticate') {
    const response = await fetch('/admin/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ functionName, args })
    });
    
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || data.message || 'API call failed');
    }
    
    if (data.result) {
      sessionStorage.setItem('sessionToken', data.result);
      
      // Fetch user info to determine role
      try {
        const users = await apiCall('listUsers');
        if (users && Array.isArray(users)) {
          const identifier = args[0];
          const currentUser = users.find(u => 
            u.id === identifier || 
            u.osrs_name === identifier || 
            u.disc_name === identifier ||
            u.forum_name === identifier
          );
          
          if (currentUser) {
            state.currentUserRole = currentUser.role;
            sessionStorage.setItem('currentUserRole', currentUser.role.toString());
            console.log('[API] User role stored:', currentUser.role);
            // Update UI
            if (window.permissions) {
              permissions.updateNavVisibility();
            }
            updateSessionSummary();
          }
        }
      } catch (error) {
        // Can't access user list, default role
        state.currentUserRole = 2; // MEMBER
        sessionStorage.setItem('currentUserRole', '2');
      }
    }
    
    return data.result !== undefined ? data.result : data;
  }
  
  // For all other calls, use session token only
  const fullArgs = credential
    ? [credential, ...args]
    : ['', ...args];

  const response = await fetch('/admin/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ functionName, args: fullArgs })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || data.message || 'API call failed');
  }

  return data.result !== undefined ? data.result : data;
}
