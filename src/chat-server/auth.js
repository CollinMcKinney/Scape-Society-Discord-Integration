// auth.js
const crypto = require("crypto");
const datastore = require("./datastore");
const { Roles } = require("./roles");
/**
 * Seassion time to live (TTL) in milliseconds. After this time, the session will expire and require re-authentication.
 * TODO: consider putting in .env or config file for flexibility. For demonstration, we use 1 hour.
 */
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

  async function register(osrs_name, disc_name, forum_name, hashedPass) {
    // For registration, we create a new user with the provided details and a default role of USER.
    // The password is hashed before storing.
    return await require("./users").createUserInternal(osrs_name, disc_name, forum_name, Roles.USER, hashedPass);
  }

async function authenticate(userId, hashedPass) {
  console.log("Authenticating user:", { userId });

  const user = await datastore.get(`user:${userId}`);
  console.log("User data retrieved for authentication:", user);

  // Don't authenticate blocked users
  if (!user || user.role === Roles.BLOCKED) {
    console.log("Authentication failed: user blocked or not found");
    return null;
  }

  // Allow authentication via session token if the session exists and is valid
  const existingSession = await datastore.get(`session:${hashedPass}`);
  if (existingSession && existingSession.userId === userId && existingSession.expires > Date.now()) {
    console.log("Authenticated via existing session token for user:", { userId });
    return hashedPass; // Return the session token itself
  }

  // Verify password hash
  if (user.hashedPass !== hashedPass) {
    console.log("Authentication failed for user:", { userId });
    console.log("hashedPass provided:", hashedPass);
    console.log("hashedPass expected:", user.hashedPass);
    return null;
  }

  // Create a new session token
  const sessionToken = crypto.randomBytes(32).toString("hex");
  const newSession = {
    userId,
    created: Date.now(),
    expires: Date.now() + SESSION_TTL_MS
  };

  await datastore.set(`session:${sessionToken}`, newSession);

  console.log("Authentication successful, new session created for user:", { userId });
  return sessionToken;
}

async function verifySession(actorId, sessionToken) {
  const session = await datastore.get(`session:${sessionToken}`);
  if (!session) return null;  
  // Check if session belongs to the actor and hasn't expired
  if (session.userId !== actorId || session.expires < Date.now()) {
    // Optional: log invalid session attempt
    console.warn(`Failed session verification for user ${actorId}`);

    // Do NOT delete automatically; let some cleanup process handle expired sessions
    return null;
  } 
  return actorId;
}

module.exports = { 
  register,
  authenticate,
  verifySession
};