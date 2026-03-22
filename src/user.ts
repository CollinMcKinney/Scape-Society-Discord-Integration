import crypto from "crypto";
import * as cache from "./cache";
import * as auth from "./auth";
import { type ActorData, type SessionData, SESSION_TTL_MS } from "./auth";
import * as permission from "./permission";
import { Roles, type RoleType } from "./permission";

/**
 * Stored user record shape persisted in the datastore.
 */
interface UserData {
  id: string;
  osrs_name?: string;
  disc_name?: string;
  forum_name?: string;
  role: RoleType;
  hashedPass: string;
  created_at?: number | Date;
}

/**
 * Canonical name fields stored on user records and indexes.
 */
type UserNames = {
  osrs_name: string;
  disc_name: string;
  forum_name: string;
};

/**
 * Guest session bootstrap payload returned to RuneLite connection setup.
 */
type GuestSession = {
  user: User;
  sessionToken: string;
};

/**
 * In-memory user model with convenience helpers for display and credential handling.
 */
class User {
  id: string;
  osrs_name: string;
  disc_name: string;
  forum_name: string;
  role: RoleType;
  hashedPass: string;
  created_at?: number | Date;

  constructor({
    id,
    osrs_name = "",
    disc_name = "",
    forum_name = "",
    role,
    hashedPass,
    created_at,
  }: UserData) {
    this.id = id;
    this.osrs_name = osrs_name || "";
    this.disc_name = disc_name || "";
    this.forum_name = forum_name || "";
    this.role = role;
    this.hashedPass = hashedPass;
    this.created_at = created_at;
  }

  /**
   * Returns a single display name for the user.
   * Preference order: OSRS → Discord → Forum → truncated ID
   */
  getDisplayName(): string {
    const osrs = this.osrs_name?.trim();
    const disc = this.disc_name?.trim();
    const forum = this.forum_name?.trim();

    return osrs || disc || forum || this.id.slice(0, 12);
  }

  /**
   * Hash a password/token
   */
  static hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }
}

/**
 * Prints the current root credentials to the console for local admin access.
 */
function printRootCredentials(): void {
  console.log("[printRootCredentials] Reading from env:", { 
    hasUserId: !!process.env.ROOT_USER_ID, 
    hasSessionToken: !!process.env.ROOT_SESSION_TOKEN 
  });
  console.log("Paste these into the admin page:");
  console.log("ROOT_CREDENTIALS:");
  console.log(`${process.env.ROOT_USER_ID || ""}=${process.env.ROOT_SESSION_TOKEN || ""}`);
}

/**
 * Builds the canonical Redis storage key for a user record.
 * @param userId - The stored user id to embed in the cache key.
 * @returns The Redis key used for the user's primary record.
 */
function getUserKey(userId: string): string {
  return `user:${userId}`;
}

/**
 * Builds reverse-index key/value pairs for the provided user names.
 * @param names - Partial user name fields that should produce lookup indexes.
 * @returns A list of cache key/value pairs that can be written or deleted.
 */
function getUserIndexEntries(names: Partial<UserNames>): Array<{ key: string; value: string }> {
  const entries: Array<{ key: string; value: string }> = [];

  if (names.osrs_name) {
    entries.push({ key: `user:osrs:${names.osrs_name}`, value: names.osrs_name });
  }
  if (names.disc_name) {
    entries.push({ key: `user:discord:${names.disc_name}`, value: names.disc_name });
  }
  if (names.forum_name) {
    entries.push({ key: `user:forum:${names.forum_name}`, value: names.forum_name });
  }

  return entries;
}

/**
 * Loads a stored user record directly from cache.
 * @param userId - The stored user id to load.
 * @returns The raw persisted user data, or null when no record exists.
 */
async function loadStoredUser(userId: string): Promise<UserData | null> {
  return cache.get<UserData>(getUserKey(userId));
}

/**
 * Saves a raw user record back to cache.
 * @param userData - The user record to write.
 * @param nx - When true, only create the record if it does not already exist.
 * @returns True when Redis reports a successful write.
 */
async function saveStoredUser(userData: UserData, nx = false): Promise<boolean> {
  const result = await cache.set(getUserKey(userData.id), userData, nx ? { NX: true } : undefined);
  return result === "OK";
}

/**
 * Writes all reverse-lookup indexes for the provided user names.
 * @param userData - The user id and names that should become lookup indexes.
 */
async function addUserIndexes(userData: Pick<UserData, "id" | "osrs_name" | "disc_name" | "forum_name">): Promise<void> {
  const indexEntries = getUserIndexEntries({
    osrs_name: userData.osrs_name || "",
    disc_name: userData.disc_name || "",
    forum_name: userData.forum_name || "",
  });

  for (const entry of indexEntries) {
    await cache.set(entry.key, userData.id);
  }
}

/**
 * Removes reverse-lookup indexes for the provided user names.
 * @param userData - The user name fields whose lookup indexes should be deleted.
 */
async function removeUserIndexes(userData: Partial<UserData>): Promise<void> {
  const indexEntries = getUserIndexEntries({
    osrs_name: userData.osrs_name || "",
    disc_name: userData.disc_name || "",
    forum_name: userData.forum_name || "",
  });

  for (const entry of indexEntries) {
    await cache.del(entry.key);
  }
}

/**
 * Saves a user record and refreshes its membership and reverse indexes.
 * @param userData - The user record to persist.
 * @param nx - When true, only create the record if it does not already exist.
 * @returns True when the primary user record write succeeded.
 */
async function saveUserRecord(userData: UserData, nx = false): Promise<boolean> {
  const saved = await saveStoredUser(userData, nx);
  if (!saved) {
    return false;
  }

  await cache.sAdd("users", userData.id);
  await addUserIndexes(userData);
  return true;
}

/**
 * Creates a new in-memory user record with generated id and timestamps.
 * @param names - The canonical name fields to place on the record.
 * @param role - The role value assigned to the new user.
 * @param hashedPass - The hashed credential stored on the record.
 * @param createdAt - The creation timestamp to assign to the new record.
 * @returns A new in-memory user instance.
 */
function createUserRecord(
  names: UserNames,
  role: RoleType,
  hashedPass: string,
  createdAt: number | Date = Date.now()
): User {
  return new User({
    id: crypto.randomUUID(),
    osrs_name: names.osrs_name,
    disc_name: names.disc_name,
    forum_name: names.forum_name,
    role,
    hashedPass,
    created_at: createdAt,
  });
}

/**
 * Removes any lingering ROOT users before a fresh server-run ROOT is created.
 */
async function removeRootUsers(): Promise<void> {
  const userIds = await cache.sMembers("users");
  for (const userId of userIds) {
    const existingUser = await loadStoredUser(userId);
    if (existingUser?.role === Roles.ROOT) {
      console.log(`Deleting existing ROOT user ${userId}...`);
      await deleteUserById(userId);
    }
  }
}

/**
 * Authenticates a user and guarantees a valid session token is returned.
 * @param userId - The stored user id being authenticated.
 * @param hashedPass - The already-hashed password (for internal use like ROOT init).
 * @returns A valid session token for the user.
 */
async function authenticateUserSession(userId: string, hashedPass: string): Promise<string> {
  const user = await cache.get<ActorData>(`user:${userId}`);
  if (!user) {
    throw new Error("User not found");
  }

  // The hashedPass is already hashed, compare directly
  if (user.hashedPass !== hashedPass) {
    throw new Error("Password mismatch");
  }

  // Create a new session token
  const sessionToken = crypto.randomBytes(32).toString("hex");
  const sessionTokenHash = auth.hashSessionToken(sessionToken);
  const newSession: SessionData = {
    userId,
    created: Date.now(),
    expires: Date.now() + SESSION_TTL_MS
  };

  await cache.set(`session:${sessionTokenHash}`, newSession);
  return sessionToken;
}

/**
 * Verifies a freshly issued session token and returns the confirmed user id.
 * @param userId - The stored user id expected to own the session.
 * @param sessionToken - The raw session token to verify.
 * @returns The verified user id.
 */
async function verifyAuthenticatedUser(userId: string, sessionToken: string): Promise<string> {
  const verifiedId = await auth.verifySession(sessionToken);
  if (!verifiedId) {
    throw new Error("Failed to verify authenticated session");
  }

  return verifiedId;
}

/**
 * Stores the current ephemeral ROOT credentials in process environment variables.
 * @param root - The in-memory ROOT user record for this server run.
 * @param verifiedId - The verified ROOT user id.
 * @param sessionToken - The active ROOT session token.
 */
function assignRootEnv(root: User, verifiedId: string, sessionToken: string): void {
  process.env.ROOT_USER_ID = verifiedId;
  process.env.ROOT_SESSION_TOKEN = sessionToken;
  process.env.ROOT_HASHED_PASS = root.hashedPass;
  console.log("[assignRootEnv] Set ROOT credentials:", { 
    userId: verifiedId, 
    sessionToken: sessionToken ? `${sessionToken.substring(0, 16)}...` : 'NONE' 
  });
}

/**
 * Enforces the configured role requirement for a user-facing command.
 * @param actorId - The user id of the actor attempting to run the command.
 * @param actorSessionToken - The actor's session token.
 * @param commandName - The logical command name whose required role should be enforced.
 */
async function requireCommandRole(actorId: string, actorSessionToken: string, commandName: string): Promise<void> {
  const minimumRole = await permission.getRequiredRoleForCommand(commandName);
  if (minimumRole != null) {
    await auth.requireRole(actorSessionToken, minimumRole);
  }
}

/**
 * Deletes a user record and all of its reverse indexes.
 * @param userId - The stored user id to remove.
 * @returns True when a user record existed and was removed.
 */
async function deleteUserById(userId: string): Promise<boolean> {
  const user = await loadStoredUser(userId);
  if (!user) {
    await cache.sRem("users", userId);
    return false;
  }

  await cache.del(getUserKey(userId));
  await cache.sRem("users", userId);
  await removeUserIndexes(user);

  return true;
}

/**
 * Recreates the ephemeral root account for the current server run.
 * @returns The new in-memory ROOT user, or null when initialization fails.
 */
async function initializeRoot(): Promise<User | null> {
  try {
    console.log("[initializeRoot] Starting...");
    await removeRootUsers();
    console.log("[initializeRoot] Removed old ROOT users");

    const root = createUserRecord(
      {
        osrs_name: "ROOT",
        disc_name: "ROOT#0000",
        forum_name: "ROOT",
      },
      Roles.ROOT,
      User.hashToken(crypto.randomBytes(32).toString("hex")),
      new Date()
    );
    console.log("[initializeRoot] Created ROOT user record:", root.id);

    const saved = await saveUserRecord(root, true);
    console.log("[initializeRoot] Saved ROOT user:", saved);
    if (!saved) {
      throw new Error("ROOT user already exists");
    }

    const sessionToken = await authenticateUserSession(root.id, root.hashedPass);
    console.log("[initializeRoot] Got session token:", sessionToken ? `${sessionToken.substring(0, 16)}...` : 'NONE');
    
    const verifiedId = await verifyAuthenticatedUser(root.id, sessionToken);
    console.log("[initializeRoot] Verified ID:", verifiedId);
    
    assignRootEnv(root, verifiedId, sessionToken);

    console.log("New ROOT created for this server run.");
    printRootCredentials();
    return root;
  } catch (error: unknown) {
    console.error("ROOT initialization failed:", error);
    return null;
  }
}

/**
 * Creates and stores a user record without performing caller authorization checks.
 * @param osrs_name - The RuneScape name to store on the new user record.
 * @param disc_name - The Discord handle to store on the new user record.
 * @param forum_name - The forum username to store on the new user record.
 * @param role - The role value assigned to the newly created account.
 * @param password - The raw secret to hash and store as the account credential, or null for an empty secret.
 */
async function createUserInternal(
  osrs_name: string,
  disc_name: string,
  forum_name: string,
  role: RoleType = Roles.GUEST,
  password: string | null = null
): Promise<User> {
  const user = createUserRecord(
    { osrs_name, disc_name, forum_name },
    role,
    User.hashToken(password || "")
  );

  const result = await saveUserRecord(user, true);
  if (!result) throw new Error("User already exists");

  if (role !== Roles.GUEST || osrs_name || disc_name || forum_name) {
    console.log("User created:", { id: user.id, osrs_name, disc_name, forum_name, role });
  }

  return user;
}

/**
 * Creates a guest user and returns a valid session token for immediate use.
 * @param osrsName - An optional initial RuneScape name to attach to the guest account before first use.
 */
async function createGuestSession(osrsName = ""): Promise<GuestSession> {
  const guestSecret = crypto.randomBytes(32).toString("hex");
  const guest = await createUserInternal(osrsName, "", "", Roles.GUEST, guestSecret);
  const sessionToken = await authenticateUserSession(guest.id, guest.hashedPass);

  return {
    user: guest,
    sessionToken,
  };
}

/**
 * Updates the stored OSRS name and reverse lookup index for a user.
 * @param userId - The stored user id whose RuneScape name should be updated.
 * @param osrsName - The new RuneScape display name to normalize and persist.
 */
async function updateUserOsrsName(userId: string, osrsName: string): Promise<boolean> {
  const normalizedName = typeof osrsName === "string" ? osrsName.trim() : "";
  if (!userId || !normalizedName) {
    return false;
  }

  const user = await loadStoredUser(userId);
  if (!user) {
    return false;
  }

  if (user.osrs_name === normalizedName) {
    return true;
  }

  await removeUserIndexes({ osrs_name: user.osrs_name });

  user.osrs_name = normalizedName;
  await saveStoredUser(user);
  await addUserIndexes({ id: userId, osrs_name: normalizedName });
  console.log("Guest user named:", {
    id: userId,
    osrs_name: normalizedName,
    disc_name: user.disc_name || "",
    forum_name: user.forum_name || "",
    role: user.role,
  });
  return true;
}

/**
 * Creates a member account on behalf of an authorized actor.
 * @param actorId - The user id of the actor requesting account creation.
 * @param actorSessionToken - The session token used to authorize the actor.
 * @param osrs_name - The RuneScape name to assign to the new member.
 * @param disc_name - The Discord handle to assign to the new member.
 * @param forum_name - The forum username to assign to the new member.
 * @param password - The raw password or secret that will be hashed for the new member.
 */
async function createUser(
  actorSessionToken: string,
  osrs_name: string,
  disc_name: string,
  forum_name: string,
  password: string
): Promise<User> {
  const actor = await auth.getVerifiedActor(actorSessionToken);

  // Pass plain password - createUserInternal will hash it
  return createUserInternal(osrs_name, disc_name, forum_name, Roles.MEMBER, password);
}

/**
 * Returns the current list of stored users.
 * @param actorId - The user id of the actor requesting the user list.
 * @param actorSessionToken - The session token used to authorize the actor.
 */
async function listUsers(actorSessionToken: string): Promise<User[]> {
  const actor = await auth.getVerifiedActor(actorSessionToken);
  
  // Check if actor has required role (MODERATOR+)
  if (actor.role < Roles.MODERATOR) {
    throw new Error("Insufficient role - MODERATOR+ required");
  }
  
  const isRoot = actor.role === Roles.ROOT;
  
  const ids = await cache.sMembers("users");
  const userList: User[] = [];
  let rootAlreadyIncluded = false;
  for (const id of ids) {
    const data = await loadStoredUser(id);
    if (!data) {
      continue;
    }

    if (data.role === Roles.ROOT) {
      if (rootAlreadyIncluded) {
        continue;
      }
      rootAlreadyIncluded = true;
    }

    // Strip sensitive data for non-ROOT users
    if (!isRoot) {
      delete (data as any).hashedPass;
    }

    userList.push(new User(data));
  }
  return userList;
}

/**
 * Loads a single user by id for an authorized actor.
 * @param actorId - The user id of the actor requesting the lookup.
 * @param actorSessionToken - The session token used to authorize the actor.
 * @param targetId - The stored user id of the user record being loaded.
 */
async function getUser(
  actorSessionToken: string,
  targetId: string
): Promise<User | null> {
  const actor = await auth.getVerifiedActor(actorSessionToken);
  
  // Check if actor has required role (MODERATOR+)
  if (actor.role < Roles.MODERATOR) {
    throw new Error("Insufficient role - MODERATOR+ required");
  }
  
  const data = await loadStoredUser(targetId);
  if (!data) return null;

  const isRoot = actor.role === Roles.ROOT;

  // Strip sensitive data for non-ROOT users
  if (!isRoot) {
    delete (data as any).hashedPass;
  }

  return new User(data);
}

/**
 * Updates a target user's role when the caller outranks both the current and requested roles.
 * @param actorId - The user id of the actor requesting the role change.
 * @param actorSessionToken - The session token used to authorize the actor.
 * @param targetId - The stored user id whose role should be updated.
 * @param newRole - The requested role value, supplied as either a numeric role or role name.
 */
async function setRole(
  actorSessionToken: string,
  targetId: string,
  newRole: string | number
): Promise<boolean> {
  const actor = await auth.getVerifiedActor(actorSessionToken);
  const target = await loadStoredUser(targetId);
  const parsedRole = parseRole(newRole);
  if (!target) return false;
  if (parsedRole == null) {
    throw new Error("Invalid role");
  }

  console.log("[setRole] Permission check:", {
    actorRole: actor.role,
    actorName: actor.osrs_name,
    targetRole: target.role,
    targetName: target.osrs_name,
    newRole: parsedRole
  });

  // Only Moderator+ can change roles
  if (actor.role < Roles.MODERATOR) {
    throw new Error("Only Moderator+ can change user roles");
  }

  // Cannot change ROOT
  if (target.role === Roles.ROOT) {
    throw new Error("Cannot change ROOT user's role");
  }

  // Cannot change own role to escalate privileges
  if (actor.id === targetId) {
    throw new Error("Cannot change your own role");
  }

  // Cannot promote someone above your own rank
  if (parsedRole > actor.role) {
    throw new Error("Cannot promote user above your own rank");
  }

  // Cannot promote someone to a rank higher than yours
  if (target.role < parsedRole && parsedRole > actor.role) {
    throw new Error("Cannot promote user above your own rank");
  }

  target.role = parsedRole;
  await saveStoredUser(target);
  return true;
}

/**
 * Parses a role input into a valid RoleType.
 * @param role - The requested role value supplied as a number or role-name string.
 * @returns The parsed role value, or null when the input is invalid.
 */
function parseRole(role: string | number): RoleType | null {
  if (typeof role === "number") {
    if (Object.values(Roles).includes(role as RoleType)) return role as RoleType;
    return null;
  }
  if (typeof role === "string") {
    const upper = role.toUpperCase();
    const namedRole = upper as keyof typeof Roles;
    if (namedRole in Roles) return Roles[namedRole];
  }
  return null;
}

/**
 * Deletes a user account (ROOT only).
 * @param actorId - The user id of the actor requesting the deletion.
 * @param actorSessionToken - The session token used to authorize the actor.
 * @param targetId - The stored user id to delete.
 * @returns True if the user was deleted.
 */
async function deleteUser(
  actorSessionToken: string,
  targetId: string
): Promise<boolean> {
  const actor = await auth.getVerifiedActor(actorSessionToken);

  // Only ROOT can delete users
  if (actor.role !== Roles.ROOT) {
    throw new Error("Only ROOT can delete users");
  }

  // Cannot delete ROOT
  const target = await loadStoredUser(targetId);
  if (!target) return false;
  if (target.role === Roles.ROOT) {
    throw new Error("Cannot delete ROOT user");
  }

  // Delete reverse indexes
  if (target.osrs_name) {
    await cache.del(`user:byOsrs:${target.osrs_name.toLowerCase()}`);
  }
  if (target.disc_name) {
    await cache.del(`user:byDisc:${target.disc_name.toLowerCase()}`);
  }
  if (target.forum_name) {
    await cache.del(`user:byForum:${target.forum_name.toLowerCase()}`);
  }

  // Delete user record
  await cache.del(`user:${targetId}`);
  await cache.sRem("users", targetId);

  return true;
}

export {
  User,
  initializeRoot,
  printRootCredentials,
  createUserInternal,
  createGuestSession,
  updateUserOsrsName,
  createUser,
  listUsers,
  getUser,
  setRole,
  deleteUser,
  type UserData
};
