import crypto from "crypto";
import * as cache from "./cache";
import { Roles, type RoleType } from "./permission";
import { User } from "./user";

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

/**
 * Session time to live (TTL) in hours. Default: 24 hours.
 * Can be configured via SESSION_TTL_HOURS environment variable.
 */
const SESSION_TTL_HOURS = parseInt(process.env.SESSION_TTL_HOURS || "24");
const SESSION_TTL_MS = SESSION_TTL_HOURS * 60 * 60 * 1000;

/**
 * Hashes a raw session token before it is stored or looked up in Redis.
 * @param token - The raw session token string to hash.
 * @returns The SHA-256 hash of the provided token.
 */
function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Minimal authenticated actor shape returned by authorization helpers.
 */
interface ActorData {
  id: string;
  osrs_name?: string;
  disc_name?: string;
  forum_name?: string;
  role: RoleType;
  hashedPass: string;
  created_at?: number | Date;
}

interface SessionData {
  userId: string;
  created: number;
  expires: number;
}

/**
 * Creates a new member account directly from registration details.
 * @param osrs_name - The user's in-game RuneScape name to store on the new account.
 * @param disc_name - The Discord handle to associate with the account.
 * @param forum_name - The forum username to associate with the account.
 * @param hashedPass - The pre-hashed credential value that will be stored for later authentication.
 */
async function register(
  osrs_name: string,
  disc_name: string,
  forum_name: string,
  hashedPass: string
): Promise<ActorData> {
  const users = await import("./user");
  return users.createUserInternal(osrs_name, disc_name, forum_name, Roles.MEMBER, hashedPass);
}

/**
 * Finds a user by any identifier (userId, osrs_name, disc_name, or forum_name).
 * @param identifier - Any user identifier (name or ID).
 * @returns The user data or null if not found.
 */
async function findUserByIdentifier(identifier: string): Promise<ActorData | null> {
  // First try as userId
  let user = await cache.get<ActorData>(`user:${identifier}`);
  if (user) return user;

  // Try as osrs_name
  const osrsKey = `user:osrs:${identifier}`;
  const osrsUserId = await cache.get<string>(osrsKey);
  if (osrsUserId) {
    user = await cache.get<ActorData>(`user:${osrsUserId}`);
    if (user) return user;
  }

  // Try as disc_name
  const discKey = `user:discord:${identifier}`;
  const discUserId = await cache.get<string>(discKey);
  if (discUserId) {
    user = await cache.get<ActorData>(`user:${discUserId}`);
    if (user) return user;
  }

  // Try as forum_name
  const forumKey = `user:forum:${identifier}`;
  const forumUserId = await cache.get<string>(forumKey);
  if (forumUserId) {
    user = await cache.get<ActorData>(`user:${forumUserId}`);
    if (user) return user;
  }

  return null;
}

/**
 * Validates credentials and returns a reusable session token on success.
 * @param identifier - User ID, OSRS name, Discord name, or forum name.
 * @param password - Password or hashed password.
 */
async function authenticate(identifier: string, password: string): Promise<string | null> {
  // Normal authentication flow (username + password)
  const user = await findUserByIdentifier(identifier);

  // Don't authenticate blocked users
  if (!user || user.role === Roles.BLOCKED) {
    console.log(`${colors.cyan}[auth]${colors.reset} Authentication failed: user blocked or not found`);
    return null;
  }

  const userId = user.id;

  // Verify password using Argon2
  const validPassword = await User.verifyPassword(password, user.hashedPass);
  if (!validPassword) {
    console.log(`${colors.cyan}[auth]${colors.reset} Authentication failed for user:`, { userId });
    return null;
  }

  // Create a new session token
  const sessionToken = crypto.randomBytes(32).toString("hex");
  const sessionTokenHash = hashSessionToken(sessionToken);
  const newSession: SessionData = {
    userId,
    created: Date.now(),
    expires: Date.now() + SESSION_TTL_MS
  };

  await cache.set(`session:${sessionTokenHash}`, newSession);

  console.log(`${colors.cyan}[auth]${colors.reset} Authentication successful, new session created for user:`, { userId });
  return sessionToken;
}

/**
 * Verifies that a session token is valid and returns the associated user ID.
 * @param sessionToken - The raw session token presented by the caller.
 */
async function verifySession(sessionToken: string): Promise<string | null> {
  const session = await cache.get<SessionData>(`session:${hashSessionToken(sessionToken)}`);
  if (!session) return null;

  if (session.expires < Date.now()) {
    console.warn(`${colors.yellow}[auth]${colors.reset} Failed session verification: token expired`);
    return null;
  }
  return session.userId;
}

/**
 * Loads the authenticated actor record for a valid session.
 * @param sessionToken - The raw session token that identifies the actor.
 */
async function getVerifiedActor(sessionToken: string): Promise<ActorData> {
  const verifiedId = await verifySession(sessionToken);
  if (!verifiedId) {
    throw new Error("Actor not authenticated");
  }

  const actor = await cache.get<ActorData>(`user:${verifiedId}`);
  if (!actor) {
    throw new Error("Actor not found");
  }

  return actor;
}

/**
 * Ensures the authenticated actor meets a minimum role requirement.
 * @param sessionToken - The raw session token used to authenticate the actor.
 * @param minimumRole - The lowest role value the actor must have to pass the check.
 */
async function requireRole(sessionToken: string, minimumRole: RoleType): Promise<ActorData> {
  const actor = await getVerifiedActor(sessionToken);
  if (actor.role < minimumRole) {
    throw new Error("Insufficient role");
  }

  return actor;
}

export {
  register,
  authenticate,
  verifySession,
  getVerifiedActor,
  requireRole,
  hashSessionToken,
  SESSION_TTL_HOURS,
  type ActorData,
  type SessionData
};
