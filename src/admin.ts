import fs from "node:fs";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import type { Router, Request, Response } from "express";

import * as auth from "./auth.ts";
import type { ActorData } from "./auth.ts";
import * as cache from "./cache.ts";
import * as files from "./files.ts";
import type { FileCategory, FileMeta } from "./files.ts";
import * as permission from "./permission.ts";
import { Roles, type RoleType } from "./permission.ts";
import type { CommandRoleRequirementDetails } from "./permission.ts";
import * as packets from "./packet.ts";
import type { ActorInfo, PacketData, PacketObject, SerializedPacket } from "./packet.ts";
import { broadcastSuppressedPrefixesUpdate, broadcastDiscordInviteUrlUpdate } from "./runelite.ts";
import * as limits from "./limits.ts";
import * as user from "./user.ts";
import type { UserData } from "./user.ts";
import * as discord from "./discord.ts";

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Lightweight actor wrapper used by admin auth helpers when a command allows anonymous access.
 */
type AdminActor = ActorData | null;

/**
 * Request body shape accepted by the `/admin/call` endpoint.
 */
type AdminCallRequest = { functionName?: unknown; args?: unknown };
/**
 * Normalized async handler signature used by the admin dispatcher.
 */
type AdminCommandHandler = (...args: unknown[]) => Promise<unknown>;

const router: Router = express.Router();
router.use(express.json());

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
 * Enforces the configured role requirement for an admin command using a shared context object.
 * @param commandName - The admin command identifier whose access should be checked.
 * @param actorSessionToken - The session token presented by the caller.
 * @returns The verified actor when one exists, or null for anonymous open commands.
 */
async function requireAdminCommand(commandName: string, actorSessionToken: string): Promise<AdminActor> {
  return requireCommandRole(commandName, actorSessionToken);
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
 * @param actorSessionToken - The session token used to authorize the caller and attach auth context.
 * @param body - The message body to place in the packet payload.
 * @param actorDetails - Optional packet actor overrides supplied by the caller.
 * @param origin - The origin label to store on the packet.
 * @param data - Additional packet payload fields to merge into `data`.
 * @param meta - Extra packet metadata to store alongside the payload.
 * @returns A newly constructed packet ready for persistence.
 */
async function buildAdminPacket(
  actorSessionToken: string,
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
      id: null,
      name: await resolveActorName(null, actorDetails),
      roles: actorDetails.roles || [],
      permissions: actorDetails.permissions || [],
    },
    auth: {
      userId: null,
      sessionToken: actorSessionToken,
    },
    data: {
      body,
      ...data,
    },
    meta,
  });
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
  await requireAdminCommand("addPacket", actorSessionToken);
  const packet = await buildAdminPacket(actorSessionToken, body, actorDetails, origin, data, meta);

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
  await requireAdminCommand("getPackets", actorSessionToken);
  return packets.getPackets(limit);
}

/**
 * Marks a packet as deleted through the admin API.
 * @param actorSessionToken - The session token used to authorize the caller.
 * @param packetId - The unique packet id that should be marked deleted.
 */
async function deletePacket(actorSessionToken: string, packetId: string): Promise<boolean> {
  await requireAdminCommand("deletePacket", actorSessionToken);
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
  await requireAdminCommand("editPacket", actorSessionToken);
  return packets.editPacket(packetId, newContent);
}

/**
 * Returns the configured RuneLite message suppression prefixes.
 * @param actorSessionToken - The session token used to authorize the caller.
 */
async function getSuppressedPrefixes(actorSessionToken: string): Promise<string[]> {
  await requireAdminCommand("getSuppressedPrefixes", actorSessionToken);
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
  await requireAdminCommand("setSuppressedPrefixes", actorSessionToken);
  const updatedPrefixes = await permission.setSuppressedPrefixes(prefixes);
  broadcastSuppressedPrefixesUpdate(updatedPrefixes);
  return updatedPrefixes;
}

/**
 * Returns the effective role requirement for each admin command.
 * @param actorSessionToken - The session token used to authorize the caller.
 */
async function getCommandRoleRequirements(actorSessionToken: string): Promise<Record<string, CommandRoleRequirementDetails>> {
  await requireAdminCommand("getCommandRoleRequirements", actorSessionToken);
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
  await requireAdminCommand("setCommandRoleRequirement", actorSessionToken);
  return permission.setCommandRoleRequirement(commandName, role);
}

/**
 * Lists all files across all categories.
 * @param actorId - The actor id requesting the file list.
 * @param actorSessionToken - The session token used to authorize the caller.
 */
async function listFilesAdmin(actorSessionToken: string): Promise<Record<FileCategory, FileMeta[]>> {
  await requireAdminCommand("listFiles", actorSessionToken);
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
  await requireAdminCommand("listFiles", actorSessionToken);
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
 * @param mimeType - Optional MIME type (will be detected from filename if not provided).
 */
async function uploadFile(
  actorSessionToken: string,
  category: FileCategory,
  name: string,
  base64Data: string,
  mimeType?: string
): Promise<FileMeta> {
  await requireAdminCommand("uploadFile", actorSessionToken);

  // Validate category name format
  if (!/^[a-z0-9_-]+$/.test(category)) {
    throw new Error("Invalid category name. Use only lowercase letters, numbers, dashes, and underscores.");
  }

  // Validate and decode base64 data
  const buffer = Buffer.from(base64Data, "base64");
  if (buffer.length === 0) {
    throw new Error("Invalid or empty file data");
  }

  return await files.uploadFile(category, name, buffer, mimeType);
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
  await requireAdminCommand("deleteFile", actorSessionToken);

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
  await requireAdminCommand("getCategories", actorSessionToken);
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
  await requireAdminCommand("createCategory", actorSessionToken);
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
  await requireAdminCommand("deleteCategory", actorSessionToken);
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
  await requireAdminCommand("saveState", actorSessionToken);
  return cache.saveState();
};

export const loadState = async (actorSessionToken: string) => {
  await requireAdminCommand("loadState", actorSessionToken);
  return cache.loadState();
};

export { addPacket, getPackets, deletePacket, editPacket, getSuppressedPrefixes, setSuppressedPrefixes, getCommandRoleRequirements, setCommandRoleRequirement };
export { listFilesAdmin as listFiles, uploadFile, deleteFile, getCategories, createCategory, deleteCategory };

/**
 * Gets the list of allowed MIME types for file uploads.
 */
export const getAllowedMimeTypes = async (actorSessionToken: string): Promise<string[]> => {
  await requireAdminCommand("getAllowedMimeTypes", actorSessionToken);
  return files.getAllowedMimeTypes();
};

/**
 * Sets the list of allowed MIME types for file uploads (ROOT only).
 */
export const setAllowedMimeTypes = async (
  actorSessionToken: string,
  ...mimeTypes: string[]
): Promise<void> => {
  const actor = await auth.getVerifiedActor(actorSessionToken);
  if (actor.role < Roles.ROOT) {
    throw new Error("ROOT access required");
  }
  return files.setAllowedMimeTypes(mimeTypes);
};

export const createUser = async (
  actorSessionToken: string,
  osrs_name: string,
  disc_name: string,
  forum_name: string,
  password: string
) => {
  await requireAdminCommand("createUser", actorSessionToken);
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

// ============================================================================
// Discord Configuration
// ============================================================================

/**
 * Gets Discord connection status and configuration.
 * @param actorSessionToken - The session token used to authorize the caller.
 */
async function getDiscordStatusWrapper(actorSessionToken: string): Promise<{
  isConnected: boolean;
  isConfigured: boolean;
  botTag?: string;
  channelId?: string;
}> {
  await requireCommandRole("getDiscordStatus", actorSessionToken);
  return discord.getDiscordStatus();
}

/**
 * Updates Discord configuration.
 * @param actorSessionToken - The session token used to authorize the caller.
 * @param config - Discord configuration to update.
 * @param autoConnect - Whether to automatically connect after updating.
 */
async function updateDiscordConfigWrapper(
  actorSessionToken: string,
  config: { 
    botToken?: string; 
    channelId?: string; 
    webhookUrl?: string;
    permissionsInteger?: string;
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
    discordInviteUrl?: string;
  },
  autoConnect?: boolean
): Promise<{ success: boolean; error?: string }> {
  await requireCommandRole("updateDiscordConfig", actorSessionToken);
  return discord.updateDiscordConfig(config, autoConnect);
}

/**
 * Starts Discord bot connection.
 * @param actorSessionToken - The session token used to authorize the caller.
 */
async function startDiscordWrapper(actorSessionToken: string): Promise<{ success: boolean; error?: string }> {
  await requireCommandRole("startDiscord", actorSessionToken);
  return discord.startDiscord();
}

/**
 * Stops Discord bot connection.
 * @param actorSessionToken - The session token used to authorize the caller.
 */
async function stopDiscordWrapper(actorSessionToken: string): Promise<void> {
  await requireCommandRole("stopDiscord", actorSessionToken);
  await discord.stopDiscord();
}

// ============================================================================
// Limits Configuration (Rate Limiting, Session TTL, etc.)
// ============================================================================

async function getAllLimitsWrapper(actorSessionToken: string): Promise<Array<object>> {
  await requireCommandRole("getAllLimits", actorSessionToken);
  return limits.getAllLimits();
}

async function updateLimitsWrapper(
  actorSessionToken: string,
  config: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  await requireCommandRole("updateLimits", actorSessionToken);
  return limits.saveLimitsConfig(config);
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
  getAllowedMimeTypes,
  setAllowedMimeTypes,
  // Discord
  getDiscordStatus: getDiscordStatusWrapper,
  updateDiscordConfig: updateDiscordConfigWrapper,
  startDiscord: startDiscordWrapper,
  stopDiscord: stopDiscordWrapper,
  // Limits (rate limiting, session TTL, etc.)
  getAllLimits: getAllLimitsWrapper,
  updateLimits: updateLimitsWrapper,
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
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ROOT-only login endpoint
router.get("/root", (req: Request, res: Response) => {
  user.printRootCredentials();
  res.sendFile(path.join(__dirname, "public", "root-login.html"));
});

router.post("/root", async (req: Request, res: Response) => {
  try {
    const { sessionToken } = req.body as { sessionToken?: string };
    
    if (!sessionToken) {
      return res.status(400).json({ error: "Session token required" });
    }
    
    // Verify the session token
    const userId = await auth.verifySession(sessionToken);
    if (!userId) {
      return res.status(401).json({ error: "Invalid or expired session token" });
    }
    
    // Verify this is a ROOT user - load user directly from cache
    const userData = await cache.get<UserData>(`user:${userId}`);
    if (!userData || userData.role !== Roles.ROOT) {
      return res.status(403).json({ error: "ROOT access required" });
    }
    
    // Set session cookie (for backend requests)
    res.cookie('sessionToken', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    
    console.log(`${colors.green}[admin]${colors.reset} ROOT login successful`);

    // Return token and user info for frontend to store
    return res.json({
      success: true,
      sessionToken,
      userId,
      username: 'ROOT',
      redirect: '/admin/'
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to login";
    console.error(`${colors.red}[admin]${colors.reset} ROOT login failed:`, message);
    return res.status(500).json({ error: message });
  }
});

router.post("/call", async (req: Request, res: Response) => {
  const { functionName, args } = req.body as AdminCallRequest;

  // Get client IP for rate limiting
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  
  // Extract session token for user-based rate limiting
  const sessionToken = Array.isArray(args) && args.length > 0 && typeof args[0] === 'string' && args[0].length > 32
    ? args[0]
    : null;
  
  // Determine rate limit key: per-user for authenticated, per-IP for unauthenticated
  let rateLimitKey = `ip:${clientIp}`;
  let isLoginAttempt = functionName === 'authenticate';
  
  if (!isLoginAttempt && sessionToken) {
    // Try to get user ID from session for per-user rate limiting
    try {
      const userId = await auth.verifySession(sessionToken);
      if (userId) {
        rateLimitKey = `user:${userId}`;
      }
    } catch {
      // Invalid session, fall back to IP-based limiting
    }
  }

  // Apply stricter rate limiting for authentication attempts
  if (isLoginAttempt) {
    const loginAllowed = await limits.checkRateLimit(rateLimitKey, 'LOGIN');
    if (!loginAllowed) {
      const remaining = await limits.getRemainingAttempts(rateLimitKey, 'LOGIN');
      return res.status(429).json({
        error: "Too many login attempts",
        retryAfter: remaining
      });
    }
  } else {
    // Check rate limit for other API calls
    const apiAllowed = await limits.checkRateLimit(rateLimitKey, 'API');
    if (!apiAllowed) {
      const remaining = await limits.getRemainingAttempts(rateLimitKey, 'API');
      return res.status(429).json({
        error: "Rate limit exceeded",
        retryAfter: remaining
      });
    }
  }

  const parsedArgs = Array.isArray(args) ? args : [];

  // Extract user info from session token (first arg) for logging
  let userIdentifier = 'anonymous';
  let logArgs = parsedArgs;
  
  if (parsedArgs.length > 0 && typeof parsedArgs[0] === 'string' && parsedArgs[0].length > 32) {
    // First arg is a session token - resolve user info and exclude from logs
    try {
      const actor = await auth.getVerifiedActor(parsedArgs[0]);
      userIdentifier = actor.osrs_name || actor.disc_name || actor.forum_name || actor.id.slice(0, 8);
    } catch {
      // Invalid session, keep anonymous
    }
    // Exclude session token from logged args
    logArgs = parsedArgs.slice(1);
  }
  
  // For uploadFile, exclude base64 data from logs (4th arg, index 3)
  if (functionName === 'uploadFile' && logArgs.length > 3) {
    logArgs = [logArgs[0], logArgs[1], `<${logArgs[2].length} bytes>`, logArgs[3]];
  }
  
  const argsStr = logArgs.length === 0 ? '' : logArgs.map(a => JSON.stringify(a)).join(', ');
  
  // Format timestamp as HH:MM:SS
  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0]; // "12:48:04"
  
  console.log(
    `${colors.gray}[admin/call]${colors.reset} ` +
    `${colors.blue}${timeStr}${colors.reset} ` +
    `${colors.cyan}${userIdentifier}${colors.reset} ` +
    `${colors.green}${functionName}${colors.reset}(${colors.yellow}${argsStr}${colors.reset})`
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

export default router;
