/**
 * chatService.js
 *
 * Redis-backed chat system with:
 * - Centralized authentication using a single token field
 * - Role-based authorization (blocked users included)
 * - Session token gating for all endpoints
 * - Message storage with duplicate prevention
 */

const redis = require("redis");
const crypto = require("crypto");

const client = redis.createClient();
client.on("error", (err) => console.error("Redis error:", err));
client.connect().then(() => console.log("Redis connected"));

// ========================
// Roles
// ========================

const Roles = Object.freeze({
  BLOCKED: 0,
  USER: 1,
  MODERATOR: 2,
  ADMIN: 3,
  OWNER: 4,
});

// ========================
// Internal User Management
// ========================

async function createUserInternal({ id, osrs_name, disc_name, forum_name, role = Roles.USER, token }) {
  const user = { id, osrs_name, disc_name, forum_name, role, token, created_at: Date.now() };
  await client.set(`user:${id}`, JSON.stringify(user));
  return user;
}

async function getUserInternal(userId) {
  const data = await client.get(`user:${userId}`);
  return data ? JSON.parse(data) : null;
}

async function updateUserInternal(user) {
  await client.set(`user:${user.id}`, JSON.stringify(user));
}

// ========================
// Authentication Service
// ========================

const AuthService = {
  async authenticate({ userId, token }) {
    const user = await getUserInternal(userId);
    if (!user || user.role === Roles.BLOCKED) return null;
    if (user.token !== token) return null;

    const sessionToken = crypto.randomBytes(32).toString("hex");
    const session = { userId, created: Date.now(), expires: Date.now() + 1000 * 60 * 60 };
    await client.set(`session:${sessionToken}`, JSON.stringify(session));

    return sessionToken;
  },

  async verifySession(actorId, sessionToken) {
    const data = await client.get(`session:${sessionToken}`);
    if (!data) return null;

    const session = JSON.parse(data);
    if (session.userId !== actorId || session.expires < Date.now()) {
      await client.del(`session:${sessionToken}`);
      return null;
    }

    return actorId;
  },
};

// ========================
// Authenticated / Role-Checked User API
// ========================

async function createUser(actorId, actorSessionToken, newUserData) {
  const verifiedActor = await AuthService.verifySession(actorId, actorSessionToken);
  if (!verifiedActor) throw new Error("Actor not authenticated");

  const actor = await getUserInternal(actorId);
  if (!actor || actor.role < Roles.MODERATOR) throw new Error("Insufficient role");

  return createUserInternal(newUserData);
}

async function getUser(actorId, actorSessionToken, targetId) {
  await AuthService.verifySession(actorId, actorSessionToken) || (() => { throw new Error("Actor not authenticated"); })();
  return getUserInternal(targetId);
}

async function updateUserAuth(actorId, actorSessionToken, targetUser) {
  const verifiedActor = await AuthService.verifySession(actorId, actorSessionToken);
  if (!verifiedActor) throw new Error("Actor not authenticated");

  const actor = await getUserInternal(actorId);
  if (!actor || actor.role < Roles.MODERATOR) throw new Error("Insufficient role");

  return updateUserInternal(targetUser);
}

// ========================
// Role / Permission Helpers
// ========================

/**
 * Set the role of a target user, if the actor has sufficient permissions.
 * @param {string} actorId - ID of the user performing the role change
 * @param {string} actorSessionToken - Actor's session token
 * @param {string} targetId - ID of the user whose role is being changed
 * @param {number} newRole - Role to assign (use Roles enum)
 * @returns {boolean} - true if role changed successfully
 */
async function setRole(actorId, actorSessionToken, targetId, newRole) {
  const verifiedActor = await AuthService.verifySession(actorId, actorSessionToken);
  if (!verifiedActor) return false;

  const actor = await getUserInternal(adtorId);
  const target = await getUserInternal(targetId);
  if (!actor || !target) return false;

  // Only allow actor with higher role to set role of lower role
  if (actor.role <= target.role || actor.role <= newRole || actor.role < Roles.MODERATOR) return false;

  target.role = newRole;
  await updateUserInternal(target);
  return true;
}


// ========================
// Message System
// ========================

async function addMessage(actorId, actorSessionToken, message) {
  const verifiedActor = await AuthService.verifySession(actorId, actorSessionToken);
  if (!verifiedActor) return false;

  const actor = await getUserInternal(actorId);
  if (!actor || actor.role === Roles.BLOCKED) return false;

  const messageKey = `message:${message.id}`;
  if (await client.exists(messageKey)) return false;

  const storedMessage = { id: message.id, actorId, content: message.content, timestamp: message.timestamp || Date.now() };
  await client.set(messageKey, JSON.stringify(storedMessage));
  await client.zAdd("messages", { score: storedMessage.timestamp, value: storedMessage.id });

  return true;
}

async function getMessages(actorId, actorSessionToken, limit = 50) {
  const verifiedActor = await AuthService.verifySession(actorId, actorSessionToken);
  if (!verifiedActor) return [];

  const ids = await client.zRange("messages", -limit, -1);
  const messages = [];

  for (const id of ids) {
    const data = await client.get(`message:${id}`);
    if (data) messages.push(JSON.parse(data));
  }

  return messages;
}

// ========================
// Module Exports
// ========================

module.exports = {
  Roles,                 // exported for external permission checks
  AuthService,           // authentication/login
  createUserAuth: createUser,        // auth-checked user creation
  getUserAuth: getUser,           // auth-checked user retrieval
  updateUserAuth,        // auth-checked user update
  setRole,           // auth-checked role management
  addMessage,            // send messages
  getMessages,           // read messages
};
 