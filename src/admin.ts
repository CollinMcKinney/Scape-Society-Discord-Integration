import express, { Router, Request, Response } from "express";
import * as auth from "./auth";
import * as cache from "./cache";
import * as packets from "./packet";
import * as user from "./user";
import * as files from "./files";
import * as env from "./env";
import * as rateLimiter from "./rateLimiter";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import * as permission from "./permission";
import { Roles, type RoleType } from "./permission";
import { broadcastSuppressedPrefixesUpdate, broadcastDiscordInviteUrlUpdate } from "./runelite";
import type { ActorInfo, PacketData, PacketObject, SerializedPacket } from "./packet";
import type { ActorData } from "./auth";
import type { CommandRoleRequirementDetails } from "./permission";
import type { UserData } from "./user";
import type { FileCategory, FileMeta } from "./files";

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
};


const ENV_FILE = path.join(__dirname, "..", ".env");
const ENV_KEY_PATTERN = /^[A-Z0-9_]+$/i;

/**
 * Lightweight actor wrapper used by admin auth helpers when a command allows anonymous access.
 */
type AdminActor = ActorData | null;
/**
 * Result payload returned after a `.env` variable is updated from the admin panel.
 */
type EnvVarUpdateResult = { key: string; value: string; persisted: boolean; note: string };
/**
 * Auth context passed between admin command helpers.
 */
type AdminContext = { actorId: string | null; actorSessionToken: string };
/**
 * Request body shape accepted by the `/admin/call` endpoint.
 */
type AdminCallRequest = { functionName?: unknown; args?: unknown };
/**
 * Normalized async handler signature used by the admin dispatcher.
 */
type AdminCommandHandler = (...args: unknown[]) => Promise<unknown>;

const router: Router = express.Router();
router.use(bodyParser.json());

/**
 * Ensures the caller meets the provided role requirement.
 * @param actorSessionToken - The session token presented for the actor.
 * @param minimumRole - The minimum role required to proceed, or null when only authentication is needed.
 */
async function requireRole(
  actorSessionToken: string,
  minimumRole: RoleType | null
): Promise<AdminActor> {
  if (minimumRole == null) {
    return actorSessionToken ? auth.getVerifiedActor(actorSessionToken) : null;
  }

  return auth.requireRole(actorSessionToken, minimumRole);
}

/**
 * Resolves and enforces the configured role requirement for an admin command.
 * @param commandName - The admin command identifier whose access rule should be enforced.
 * @param actorSessionToken - The session token presented for the actor.
 */
async function requireCommandRole(
  commandName: string,
  actorSessionToken: string
): Promise<AdminActor> {
  const minimumRole = await permission.getRequiredRoleForCommand(commandName);
  return requireRole(actorSessionToken, minimumRole);
}

/**
 * Creates a normalized admin auth context object.
 * @param actorSessionToken - The session token presented by the actor.
 * @returns A reusable auth context object for downstream admin helpers.
 */
function createAdminContext(actorSessionToken: string): AdminContext {
  return { actorId: null, actorSessionToken };
}

/**
 * Enforces the configured role requirement for an admin command using a shared context object.
 * @param commandName - The admin command identifier whose access should be checked.
 * @param context - The normalized actor/session context for the current call.
 * @returns The verified actor when one exists, or null for anonymous open commands.
 */
async function requireAdminCommand(commandName: string, context: AdminContext): Promise<AdminActor> {
  return requireCommandRole(commandName, context.actorSessionToken);
}

/**
 * Resolves the best display name for the actor attached to an admin-created packet.
 * @param actorId - The actor id to look up in cached user records.
 * @param actorDetails - Optional packet actor overrides supplied by the caller.
 * @returns The actor display name that should be stored on the packet.
 */
async function resolveActorName(actorId: string | null, actorDetails: Partial<ActorInfo>): Promise<string> {
  if (actorDetails.name) {
    return actorDetails.name;
  }

  const actorUser = actorId ? await cache.get<UserData>(`user:${actorId}`) : null;
  return actorUser?.osrs_name || actorUser?.disc_name || actorUser?.forum_name || "Unknown";
}

/**
 * Builds the admin-origin packet used by the `addPacket` command.
 * @param context - The normalized actor/session context for the current admin call.
 * @param body - The message body to place in the packet payload.
 * @param actorDetails - Optional packet actor overrides supplied by the caller.
 * @param origin - The origin label to store on the packet.
 * @param data - Additional packet payload fields to merge into `data`.
 * @param meta - Extra packet metadata to store alongside the payload.
 * @returns A newly constructed packet ready for persistence.
 */
async function buildAdminPacket(
  context: AdminContext,
  body: string,
  actorDetails: Partial<ActorInfo>,
  origin: string,
  data: PacketData,
  meta: PacketObject
): Promise<packets.Packet> {
  return new packets.Packet({
    type: "chat.message",
    origin,
    actor: {
      id: context.actorId,
      name: await resolveActorName(context.actorId, actorDetails),
      roles: actorDetails.roles || [],
      permissions: actorDetails.permissions || [],
    },
    auth: {
      userId: context.actorId,
      sessionToken: context.actorSessionToken,
    },
    data: {
      body,
      ...data,
    },
    meta,
  });
}

/**
 * Validates and normalizes an environment variable name before persistence.
 * @param key - The raw environment variable name supplied by the caller.
 * @returns A trimmed, validated environment variable key.
 */
function normalizeEnvKey(key: string): string {
  if (!key || typeof key !== "string") {
    throw new Error("Environment variable key is required");
  }

  const normalizedKey = key.trim();
  if (!ENV_KEY_PATTERN.test(normalizedKey)) {
    throw new Error("Environment variable key contains invalid characters");
  }

  return normalizedKey;
}

/**
 * Normalizes a dynamic environment variable value into a string.
 * @param value - The raw value supplied by the caller.
 * @returns The normalized string value written into process.env and `.env`.
 */
function normalizeEnvValue(value: unknown): string {
  return value == null ? "" : String(value);
}

/**
 * Reads the current `.env` file contents when the file exists locally.
 * @returns The raw `.env` file contents, or an empty string when no file exists yet.
 */
function readEnvFileContents(): string {
  if (!fs.existsSync(ENV_FILE)) {
    return "";
  }

  return fs.readFileSync(ENV_FILE, "utf8");
}

/**
 * Replaces or appends a single key/value line inside the `.env` contents.
 * @param envContents - The current raw `.env` file contents.
 * @param key - The environment variable key to replace or append.
 * @param value - The string value to persist for the key.
 * @returns The updated `.env` file contents.
 */
function upsertEnvFileValue(envContents: string, key: string, value: string): string {
  const envLine = `${key}=${value}`;
  const envPattern = new RegExp(`^${key}=.*$`, "m");
  return envPattern.test(envContents)
    ? envContents.replace(envPattern, envLine)
    : `${envContents}${envContents && !envContents.endsWith("\n") ? "\n" : ""}${envLine}\n`;
}

/**
 * Writes an environment variable to both process memory and the local `.env` file.
 * @param key - The environment variable key to write.
 * @param value - The normalized string value to persist.
 */
function persistEnvVar(key: string, value: string): void {
  process.env[key] = value;
  const envContents = readEnvFileContents();
  const updatedContents = upsertEnvFileValue(envContents, key, value);
  fs.writeFileSync(ENV_FILE, updatedContents, "utf8");
}

/**
 * Emits any live runtime updates triggered by a changed environment variable.
 * @param key - The environment variable key that was changed.
 * @param value - The normalized value that was just persisted.
 */
function broadcastEnvVarUpdate(key: string, value: string): void {
  if (key === "DISCORD_INVITE_URL") {
    broadcastDiscordInviteUrlUpdate(value);
  }
}

/**
 * Creates and persists a chat packet through the admin API.
 * @param actorId - The actor id to attribute the packet to.
 * @param actorSessionToken - The session token used to authorize the caller and attach auth context.
 * @param body - The chat message body to store in the packet.
 * @param actorDetails - Optional actor fields used to override the packet's display identity.
 * @param origin - The origin label to store on the packet, usually `admin`.
 * @param data - Additional payload fields to merge into the packet's `data` object.
 * @param meta - Extra metadata to store alongside the packet without putting it in the message body.
 */
async function addPacket(
  actorSessionToken: string,
  body: string,
  actorDetails: Partial<ActorInfo> = {},
  origin = "admin",
  data: PacketData = {},
  meta: PacketObject = {}
): Promise<boolean> {
  const context = createAdminContext(actorSessionToken);
  await requireAdminCommand("addPacket", context);
  const packet = await buildAdminPacket(context, body, actorDetails, origin, data, meta);

  console.log(
    `[admin.addPacket] ${new Date().toISOString()} packetId=${packet.id} origin=${packet.origin} body=${JSON.stringify(
      packet.data.body
    )}`
  );
  return packets.addPacket(packet);
}

/**
 * Returns recent packets for an authorized admin actor.
 * @param actorSessionToken - The session token used to authorize the caller.
 * @param limit - The maximum number of recent packets to return.
 */
async function getPackets(actorSessionToken: string, limit = 50): Promise<SerializedPacket[]> {
  await requireAdminCommand("getPackets", createAdminContext(actorSessionToken));
  return packets.getPackets(limit);
}

/**
 * Marks a packet as deleted through the admin API.
 * @param actorSessionToken - The session token used to authorize the caller.
 * @param packetId - The unique packet id that should be marked deleted.
 */
async function deletePacket(actorSessionToken: string, packetId: string): Promise<boolean> {
  await requireAdminCommand("deletePacket", createAdminContext(actorSessionToken));
  return packets.deletePacket(packetId);
}

/**
 * Updates an existing packet's content through the admin API.
 * @param actorSessionToken - The session token used to authorize the caller.
 * @param packetId - The unique packet id to edit.
 * @param newContent - The replacement message content to persist on the packet.
 */
async function editPacket(
  actorSessionToken: string,
  packetId: string,
  newContent: string
): Promise<boolean> {
  await requireAdminCommand("editPacket", createAdminContext(actorSessionToken));
  return packets.editPacket(packetId, newContent);
}

/**
 * Updates an environment variable in-memory and in the local `.env` file.
 * @param actorSessionToken - The session token used to authorize the caller.
 * @param key - The environment variable name to update.
 * @param value - The new value to assign before persisting it to `.env`.
 */
async function setEnvVar(
  actorSessionToken: string,
  key: string,
  value: unknown
): Promise<EnvVarUpdateResult> {
  await requireAdminCommand("setEnvVar", createAdminContext(actorSessionToken));
  const normalizedKey = normalizeEnvKey(key);
  const normalizedValue = normalizeEnvValue(value);

  persistEnvVar(normalizedKey, normalizedValue);
  broadcastEnvVarUpdate(normalizedKey, normalizedValue);

  return {
    key: normalizedKey,
    value: normalizedValue,
    persisted: true,
    note: "Updated process.env immediately. Some settings may still require a server restart to fully take effect.",
  };
}

/**
 * Returns the configured RuneLite message suppression prefixes.
 * @param actorSessionToken - The session token used to authorize the caller.
 */
async function getSuppressedPrefixes(actorSessionToken: string): Promise<string[]> {
  await requireAdminCommand("getSuppressedPrefixes", createAdminContext(actorSessionToken));
  return permission.getSuppressedPrefixes();
}

/**
 * Replaces the configured RuneLite message suppression prefixes.
 * @param actorSessionToken - The session token used to authorize the caller.
 * @param prefixes - The replacement list of suppression prefixes to normalize and save.
 */
async function setSuppressedPrefixes(
  actorSessionToken: string,
  prefixes: string[]
): Promise<string[]> {
  await requireAdminCommand("setSuppressedPrefixes", createAdminContext(actorSessionToken));
  const updatedPrefixes = await permission.setSuppressedPrefixes(prefixes);
  broadcastSuppressedPrefixesUpdate(updatedPrefixes);
  return updatedPrefixes;
}

/**
 * Returns the effective role requirement for each admin command.
 * @param actorSessionToken - The session token used to authorize the caller.
 */
async function getCommandRoleRequirements(actorSessionToken: string): Promise<Record<string, CommandRoleRequirementDetails>> {
  await requireAdminCommand("getCommandRoleRequirements", createAdminContext(actorSessionToken));
  return permission.getCommandRoleRequirements();
}

/**
 * Overrides the configured role requirement for a specific admin command.
 * @param actorSessionToken - The session token used to authorize the caller.
 * @param commandName - The admin command whose required role should be updated.
 * @param role - The new minimum role to require, expressed as a role name, number, or null/open marker.
 */
async function setCommandRoleRequirement(
  actorSessionToken: string,
  commandName: string,
  role: string | number | null
): Promise<{ commandName: string; roleValue: RoleType | null; roleName: string }> {
  await requireAdminCommand("setCommandRoleRequirement", createAdminContext(actorSessionToken));
  return permission.setCommandRoleRequirement(commandName, role);
}

/**
 * Lists all files across all categories.
 * @param actorId - The actor id requesting the file list.
 * @param actorSessionToken - The session token used to authorize the caller.
 */
async function listFilesAdmin(actorSessionToken: string): Promise<Record<FileCategory, FileMeta[]>> {
  await requireAdminCommand("listFiles", createAdminContext(actorSessionToken));
  return files.listAllFiles();
}

/**
 * Lists all files in a specific category.
 * @param actorId - The actor id requesting the file list.
 * @param actorSessionToken - The session token used to authorize the caller.
 * @param category - The file category to list.
 */
async function listFilesByCategory(
  actorSessionToken: string,
  category: FileCategory
): Promise<FileMeta[]> {
  await requireAdminCommand("listFiles", createAdminContext(actorSessionToken));
  const fileList = await files.listFiles(category);
  const metadata: FileMeta[] = [];
  
  for (const name of fileList) {
    const meta = await files.getFileMeta(category, name);
    if (meta) {
      metadata.push(meta);
    }
  }
  
  return metadata;
}

/**
 * Uploads a file to disk from base64-encoded data.
 * @param actorId - The actor id requesting the upload.
 * @param actorSessionToken - The session token used to authorize the caller.
 * @param category - The file category.
 * @param name - The file name.
 * @param base64Data - The base64-encoded file data.
 */
async function uploadFile(
  actorSessionToken: string,
  category: FileCategory,
  name: string,
  base64Data: string
): Promise<FileMeta> {
  await requireAdminCommand("uploadFile", createAdminContext(actorSessionToken));

  // Validate category name format
  if (!/^[a-z0-9_-]+$/.test(category)) {
    throw new Error("Invalid category name. Use only lowercase letters, numbers, dashes, and underscores.");
  }

  // Validate and decode base64 data
  const buffer = Buffer.from(base64Data, "base64");
  if (buffer.length === 0) {
    throw new Error("Invalid or empty file data");
  }

  return await files.uploadFile(category, name, buffer);
}

/**
 * Deletes a file from disk and cache.
 * @param actorId - The actor id requesting the deletion.
 * @param actorSessionToken - The session token used to authorize the caller.
 * @param category - The file category.
 * @param name - The file name.
 */
async function deleteFile(
  actorSessionToken: string,
  category: FileCategory,
  name: string
): Promise<boolean> {
  await requireAdminCommand("deleteFile", createAdminContext(actorSessionToken));
  
  // Validate category
  const validCategories: FileCategory[] = await files.getCategories();
  if (!validCategories.includes(category)) {
    throw new Error(`Invalid category. Must be one of: ${validCategories.join(", ")}`);
  }
  
  return await files.deleteFile(category, name);
}

/**
 * Lists all file categories.
 * @param actorId - The actor id requesting the category list.
 * @param actorSessionToken - The session token used to authorize the caller.
 */
async function getCategories(
  actorSessionToken: string
): Promise<FileCategory[]> {
  await requireAdminCommand("getCategories", createAdminContext(actorSessionToken));
  return files.getCategories();
}

/**
 * Creates a new file category.
 * @param actorId - The actor id requesting the category creation.
 * @param actorSessionToken - The session token used to authorize the caller.
 * @param name - The category name to create.
 */
async function createCategory(
  actorSessionToken: string,
  name: string
): Promise<FileCategory> {
  await requireAdminCommand("createCategory", createAdminContext(actorSessionToken));
  return files.createCategory(name);
}

/**
 * Deletes a file category.
 * @param actorSessionToken - The session token used to authorize the caller.
 * @param name - The category name to delete.
 */
async function deleteCategory(
  actorSessionToken: string,
  name: string
): Promise<boolean> {
  await requireAdminCommand("deleteCategory", createAdminContext(actorSessionToken));
  return files.deleteCategory(name);
}

/**
 * Authenticates a user and returns a session token when successful.
 */
export const authenticate = auth.authenticate;
/**
 * Verifies that a session token belongs to the given actor.
 */
export const verifySession = auth.verifySession;
/**
 * Saves the current datastore contents to disk.
 * @param actorId - The actor id requesting the backup.
 * @param actorSessionToken - The session token used to authorize the caller.
 */
export const saveState = async (actorSessionToken: string) => {
  await requireAdminCommand("saveState", createAdminContext(actorSessionToken));
  return cache.saveState();
};

export const loadState = async (actorSessionToken: string) => {
  await requireAdminCommand("loadState", createAdminContext(actorSessionToken));
  return cache.loadState();
};

export { addPacket, getPackets, deletePacket, editPacket, setEnvVar, getSuppressedPrefixes, setSuppressedPrefixes, getCommandRoleRequirements, setCommandRoleRequirement };
export { listFilesAdmin as listFiles, uploadFile, deleteFile, getCategories, createCategory, deleteCategory };
export const createUser = async (
  actorSessionToken: string,
  osrs_name: string,
  disc_name: string,
  forum_name: string,
  password: string
) => {
  await requireAdminCommand("createUser", createAdminContext(actorSessionToken));
  return user.createUser(actorSessionToken, osrs_name, disc_name, forum_name, password);
};
export const listUsers = user.listUsers;
export const getUser = user.getUser;
export const setRole = user.setRole;
export const deleteUser = user.deleteUser;
/**
 * Changes a user's password.
 */
export const changePassword = user.changePassword;
/**
 * Resets a user's password (ROOT only).
 */
export const resetPassword = user.resetPassword;
export const getCategoriesExport = getCategories;
export const createCategoryExport = createCategory;
export const deleteCategoryExport = deleteCategory;

/**
 * Gets all environment variables.
 * @param actorSessionToken - The session token used to authorize the caller.
 */
async function getEnvVars(actorSessionToken: string): Promise<Record<string, string>> {
  await requireAdminCommand("getEnvVars", createAdminContext(actorSessionToken));
  return env.readEnvFile();
}

/**
 * Sets an environment variable.
 * @param actorSessionToken - The session token used to authorize the caller.
 * @param key - The variable name.
 * @param value - The value to set.
 */
async function setEnvVariable(
  actorSessionToken: string,
  key: string,
  value: string
): Promise<void> {
  await requireAdminCommand("setEnvVar", createAdminContext(actorSessionToken));
  env.setEnvVar(key, value);
}

const adminModule = {
  authenticate,
  verifySession,
  saveState,
  loadState,
  addPacket,
  getPackets,
  deletePacket,
  editPacket,
  setEnvVar,
  getSuppressedPrefixes,
  setSuppressedPrefixes,
  getCommandRoleRequirements,
  setCommandRoleRequirement,
  createUser,
  listUsers,
  getUser,
  setRole,
  deleteUser,
  changePassword,
  resetPassword,
  listFiles: listFilesAdmin,
  uploadFile,
  deleteFile,
  getCategories,
  createCategory,
  deleteCategory,
  getEnvVars,
  setEnvVariable,
};

type AdminApiFunctionName = keyof typeof adminModule;

/**
 * Narrows unknown command names to the allow-listed admin dispatcher names.
 * @param value - The raw value supplied by the `/admin/call` request body.
 * @returns True when the value is an allowed admin command name.
 */
function isAdminApiFunctionName(value: unknown): value is AdminApiFunctionName {
  return typeof value === "string" && value in adminModule;
}

/**
 * Invokes a single allow-listed admin command through the in-memory dispatcher.
 * @param functionName - The allow-listed admin command to call.
 * @param args - The raw argument list forwarded from the admin UI.
 * @returns The resolved result produced by the selected admin command.
 */
async function invokeAdminCommand(functionName: AdminApiFunctionName, args: unknown[]): Promise<unknown> {
  const handler = adminModule[functionName] as AdminCommandHandler;
  return handler(...args);
}

router.get("/", (req: Request, res: Response) => {
  user.printRootCredentials();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

router.post("/call", async (req: Request, res: Response) => {
  const { functionName, args } = req.body as AdminCallRequest;

  // Get client IP for rate limiting
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

  // Check rate limit for API calls
  const apiAllowed = await rateLimiter.checkRateLimit(clientIp, 'API');
  if (!apiAllowed) {
    const remaining = await rateLimiter.getRemainingAttempts(clientIp, 'API');
    return res.status(429).json({
      error: "Rate limit exceeded",
      retryAfter: remaining
    });
  }

  const parsedArgs = Array.isArray(args) ? args : [];
  
  // Try to get username from session token (first arg) for cleaner logs
  let userIdentifier = 'anonymous';
  if (parsedArgs.length > 0 && typeof parsedArgs[0] === 'string') {
    try {
      const actor = await auth.getVerifiedActor(parsedArgs[0]);
      userIdentifier = actor.osrs_name || actor.disc_name || actor.forum_name || actor.id.slice(0, 8);
    } catch {
      // Invalid session, keep anonymous
    }
  }
  
  // Log without the session token (skip first arg if it's a token)
  const logArgs = parsedArgs.length > 0 && parsedArgs[0]?.length > 32 ? parsedArgs.slice(1) : parsedArgs;
  const argsStr = logArgs.length === 0 ? '' : logArgs.map(a => JSON.stringify(a)).join(', ');
  console.log(
    `${colors.gray}[admin/call]${colors.reset} ` +
    `${colors.blue}${new Date().toISOString()}${colors.reset} ` +
    `${colors.cyan}${userIdentifier}${colors.reset} ` +
    `${colors.green}'${functionName}'${colors.reset}(${colors.yellow}${argsStr}${colors.reset})`
  );

  if (!isAdminApiFunctionName(functionName)) {
    console.error(`${colors.red}Error:${colors.reset} [admin/call] Function not allowed:`, functionName);
    return res.status(400).json({ error: "Function not allowed" });
  }

  try {
    const result = await invokeAdminCommand(functionName, parsedArgs);
    return res.json({ result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown admin error";
    console.error(`${colors.red}Error:${colors.reset} [admin/call]`, message);
    return res.status(500).json({ error: message });
  }
});

/**
 * POST /admin/restore-env-backup - Restore .env from backup
 */
router.post("/restore-env-backup", async (req: Request, res: Response): Promise<void> => {
  try {
    const sessionToken = req.headers['x-session-token'] as string;
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    
    if (!sessionToken) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const actor = await auth.getVerifiedActor(sessionToken);
    if (actor.role < Roles.ROOT) {
      res.status(403).json({ error: "ROOT access required" });
      return;
    }

    // Rate limit env changes
    const envAllowed = await rateLimiter.checkRateLimit(`${clientIp}:env`, 'ENV_CHANGE');
    if (!envAllowed) {
      res.status(429).json({ error: "Rate limit exceeded for environment changes" });
      return;
    }

    const backupPath = ENV_FILE + '.backup';
    if (!fs.existsSync(backupPath)) {
      res.status(404).json({ error: "No backup found" });
      return;
    }

    // Restore backup
    fs.copyFileSync(backupPath, ENV_FILE);
    console.log(`${colors.green}[admin]${colors.reset} Restored .env from backup`);

    // Reload environment variables into process.env
    const envVars = env.readEnvFile();
    for (const [key, value] of Object.entries(envVars)) {
      process.env[key] = value;
    }

    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to restore backup";
    res.status(500).json({ error: message });
  }
});

/**
 * GET /admin/env-backup-status - Check if backup exists
 */
router.get("/env-backup-status", async (req: Request, res: Response): Promise<void> => {
  try {
    const sessionToken = req.headers['x-session-token'] as string;
    if (!sessionToken) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const actor = await auth.getVerifiedActor(sessionToken);
    if (actor.role < Roles.MODERATOR) {
      res.status(403).json({ error: "MODERATOR+ access required" });
      return;
    }

    const hasBackup = fs.existsSync(ENV_FILE + '.backup');
    res.json({ hasBackup });
  } catch (err: unknown) {
    res.status(500).json({ error: "Failed to check backup status" });
  }
});

export default router;
