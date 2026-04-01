import fs from "node:fs";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import type { Router, Request, Response } from "express";

import * as auth from "../auth.ts";
import type { ActorData } from "../auth.ts";
import * as cache from "../ephemeral/cache.ts";
import { Roles, type RoleType, getMinimumRoleForCommand } from "../persistent/permissions.ts";
import * as limits from "../persistent/limits.ts";
import * as user from "../persistent/users.ts";
import type { DbUser } from "../persistent/users.ts";

import * as packets from "../ephemeral/packets.ts";
import type { ActorInfo, PacketData, PacketObject, SerializedPacket } from "../ephemeral/packets.ts";
import { broadcastSuppressedPrefixesUpdate } from "../runelite.ts";
import * as permission from "../persistent/permissions.ts";
import type { CommandRoleRequirementDetails } from "../persistent/permissions.ts";

import * as files from "../persistent/files.ts";
import type { FileCategory, FileMeta } from "../persistent/files.ts";

import * as discord from "../discord.ts";

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
 * Lightweight actor wrapper used by API auth helpers when a command allows anonymous access.
 */
type ApiActor = ActorData | null;

/**
 * Request body shape accepted by the `/api/call` endpoint.
 */
type ApiCallRequest = { functionName?: unknown; args?: unknown };

/**
 * Normalized async handler signature used by the API dispatcher.
 */
type ApiCommandHandler = (...args: unknown[]) => Promise<unknown>;

const apiRouter: Router = express.Router();
apiRouter.use(express.json());

// ============================================================================
// Auth Helpers
// ============================================================================

/**
 * Checks if the caller has access to execute an API command.
 * For commands that allow anonymous access, pass an empty session token.
 */
async function checkCommandAccess(commandName: string, actorSessionToken: string): Promise<ApiActor> {
  const minimumRole = await getMinimumRoleForCommand(commandName);

  // If no role required, allow anonymous access
  if (minimumRole == null) {
    return null;
  }

  // Special case: authenticate command doesn't require a session token
  // (user is trying to GET a session token)
  if (commandName === "authenticate") {
    return null;
  }

  // If session token is empty/null, user can't meet role requirement
  if (!actorSessionToken) {
    throw new Error("Authentication required");
  }

  return auth.requireRole(actorSessionToken, minimumRole);
}

/**
 * Wraps a function with automatic access checking.
 * The first parameter of the wrapped function must be the session token.
 */
function apiCommand<T extends (sessionToken: string, ...args: any[]) => any>(
  commandName: string,
  fn: T
): T {
  return (async (sessionToken: string, ...args: any[]) => {
    await checkCommandAccess(commandName, sessionToken || "");
    return fn(sessionToken, ...args);
  }) as T;
}

// ============================================================================
// Auth Exports
// ============================================================================

export const authenticate = apiCommand("authenticate", auth.authenticate);
export const verifySession = apiCommand("verifySession", auth.verifySession);

// ============================================================================
// Cache Exports (removed - Redis is ephemeral)
// ============================================================================

// ============================================================================
// Packet Management Exports
// ============================================================================

export const addPacket = apiCommand("addPacket", async (
  _sessionToken: string,
  body: string,
  actorDetails: Partial<ActorInfo> = {},
  origin = "Concord",
  data: PacketData = {},
  meta: PacketObject = {}
): Promise<boolean> => {
  const packet = new packets.Packet({
    type: "chat.message",
    origin,
    actor: {
      id: null,
      name: actorDetails.name || "Concord",
      roles: actorDetails.roles || [],
      permissions: actorDetails.permissions || [],
    },
    auth: {
      userId: null,
      sessionToken: _sessionToken,
    },
    data: {
      body,
      ...data,
    },
    meta,
  });

  console.log(
    `[api.addPacket] ${new Date().toISOString()} packetId=${packet.id} origin=${packet.origin} body=${JSON.stringify(
      packet.data.body
    )}`
  );
  return packets.addPacket(packet);
});

export const getPackets = apiCommand("getPackets", async (_sessionToken: string, limit = 50): Promise<SerializedPacket[]> => {
  return packets.getPackets(limit);
});
export const deletePacket = apiCommand("deletePacket", async (_sessionToken: string, packetId: string): Promise<boolean> => {
  return packets.deletePacket(packetId);
});

export const editPacket = apiCommand("editPacket", async (_sessionToken: string, packetId: string, newContent: string): Promise<boolean> => {
  return packets.editPacket(packetId, newContent);
});

export const getSuppressedPrefixes = apiCommand("getSuppressedPrefixes", async (_sessionToken: string): Promise<string[]> => {
  return permission.getSuppressedPrefixes();
});

export const setSuppressedPrefixes = apiCommand("setSuppressedPrefixes", async (_sessionToken: string, prefixes: string[]): Promise<string[]> => {
  await permission.setSuppressedPrefixes(prefixes);
  broadcastSuppressedPrefixesUpdate(prefixes);
  return prefixes;
});

export const getCommandRoleRequirements = apiCommand("getCommandRoleRequirements", async (_sessionToken: string): Promise<Record<string, CommandRoleRequirementDetails>> => {
  return permission.getCommandRoleRequirementDetails();
});

export const setCommandRoleRequirement = apiCommand("setCommandRoleRequirement", async (
  _sessionToken: string,
  commandName: string,
  role: string | number | null
): Promise<{ commandName: string; roleValue: RoleType | null; roleName: string }> => {
  // Parse role string/number to RoleType
  let parsedRole: RoleType | null = null;
  if (typeof role === "number") {
    // Validate number is a valid RoleType
    if (role >= 0 && role <= 6) {
      parsedRole = role as RoleType;
    }
  } else if (typeof role === "string") {
    const upper = role.toUpperCase();
    if (upper in Roles) {
      parsedRole = Roles[upper as keyof typeof Roles];
    }
  }

  await permission.setCommandRoleRequirement(commandName, parsedRole);
  
  // Get role name from numeric value
  const roleName = parsedRole !== null 
    ? (Object.keys(Roles)[parsedRole] as string)
    : "None";
  
  return {
    commandName,
    roleValue: parsedRole,
    roleName,
  };
});

// ============================================================================
// File Management Exports
// ============================================================================

export const listFiles = apiCommand("listFiles", files.listAllFiles);

export const uploadFile = apiCommand("uploadFile", async (
  _sessionToken: string,
  category: FileCategory,
  name: string,
  base64Data: string,
  mimeType?: string
): Promise<FileMeta> => {
  if (!/^[a-z0-9_-]+$/.test(category)) {
    throw new Error("Invalid category name. Use only lowercase letters, numbers, dashes, and underscores.");
  }

  const buffer = Buffer.from(base64Data, "base64");
  if (buffer.length === 0) {
    throw new Error("Invalid or empty file data");
  }

  return await files.uploadFile(category, name, buffer, mimeType);
});

export const deleteFile = apiCommand("deleteFile", async (_sessionToken: string, category: FileCategory, name: string): Promise<boolean> => {
  const validCategories: FileCategory[] = await files.getCategories();
  if (!validCategories.includes(category)) {
    throw new Error(`Invalid category. Must be one of: ${validCategories.join(", ")}`);
  }
  return await files.deleteFile(category, name);
});

export const getCategories = apiCommand("getCategories", async (_sessionToken: string): Promise<FileCategory[]> => {
  return files.getCategories();
});

export const createCategory = apiCommand("createCategory", async (_sessionToken: string, name: string): Promise<FileCategory> => {
  return files.createCategory(name);
});

export const deleteCategory = apiCommand("deleteCategory", async (_sessionToken: string, name: string): Promise<boolean> => {
  return files.deleteCategory(name);
});

export const getAllowedMimeTypes = apiCommand("getAllowedMimeTypes", async (_sessionToken: string): Promise<string[]> => {
  return files.getAllowedMimeTypes();
});

export const setAllowedMimeTypes = apiCommand("setAllowedMimeTypes", async (_sessionToken: string, ...mimeTypes: string[]): Promise<void> => {
  return files.setAllowedMimeTypes(mimeTypes);
});

export const getCustomMimeTypes = apiCommand("getCustomMimeTypes", async (_sessionToken: string): Promise<string[]> => {
  return files.getCustomMimeTypes();
});

export const addCustomMimeType = apiCommand("addCustomMimeType", async (_sessionToken: string, mimeType: string): Promise<void> => {
  return files.addCustomMimeType(mimeType);
});

export const removeCustomMimeType = apiCommand("removeCustomMimeType", async (_sessionToken: string, mimeType: string): Promise<void> => {
  return files.removeCustomMimeType(mimeType);
});

// ============================================================================
// User Management Exports
// ============================================================================

export const createUser = apiCommand("createUser", user.createUser);
export const listUsers = apiCommand("listUsers", async (_sessionToken: string): Promise<any[]> => {
  return user.listUsers(_sessionToken);
});
export const getUser = apiCommand("getUser", async (_sessionToken: string, targetId: string): Promise<any> => {
  return user.getUser(_sessionToken, targetId);
});
export const setRole = apiCommand("setRole", async (_sessionToken: string, targetId: string, newRole: string | number): Promise<boolean> => {
  return user.setRole(_sessionToken, targetId, newRole);
});
export const deleteUser = apiCommand("deleteUser", async (_sessionToken: string, targetId: string): Promise<boolean> => {
  return user.deleteUser(_sessionToken, targetId);
});
export const changePassword = apiCommand("changePassword", async (_sessionToken: string, targetIdentifier: string, newPassword: string): Promise<boolean> => {
  return user.changePassword(_sessionToken, targetIdentifier, newPassword);
});
export const resetPassword = apiCommand("resetPassword", async (_sessionToken: string, targetIdentifier: string, newPassword: string): Promise<boolean> => {
  return user.resetPassword(_sessionToken, targetIdentifier, newPassword);
});

// ============================================================================
// Discord Configuration Exports
// ============================================================================

export const getDiscordStatus = apiCommand("getDiscordStatus", async (_sessionToken: string): Promise<any> => {
  return discord.getDiscordStatus();
});
export const updateDiscordConfig = apiCommand("updateDiscordConfig", async (
  _sessionToken: string,
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
): Promise<{ success: boolean; error?: string }> => {
  return discord.updateDiscordConfig(config, autoConnect);
});
export const startDiscord = apiCommand("startDiscord", async (_sessionToken: string): Promise<{ success: boolean; error?: string }> => {
  return discord.startDiscord();
});
export const stopDiscord = apiCommand("stopDiscord", async (_sessionToken: string): Promise<void> => {
  return discord.stopDiscord();
});

// ============================================================================
// Limits Configuration Exports
// ============================================================================

export const getAllLimits = apiCommand("getAllLimits", async (_sessionToken: string): Promise<Array<object>> => {
  return limits.getAllLimits();
});
export const updateLimits = apiCommand("updateLimits", async (_sessionToken: string, config: Record<string, string>): Promise<{ success: boolean; error?: string }> => {
  return limits.saveLimitsConfig(config);
});

// ============================================================================
// Command Dispatcher
// ============================================================================

const apiModule = {
  authenticate,
  verifySession,
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
  listFiles,
  uploadFile,
  deleteFile,
  getCategories,
  createCategory,
  deleteCategory,
  getAllowedMimeTypes,
  setAllowedMimeTypes,
  getCustomMimeTypes,
  addCustomMimeType,
  removeCustomMimeType,
  // Discord
  getDiscordStatus,
  updateDiscordConfig,
  startDiscord,
  stopDiscord,
  // Limits
  getAllLimits,
  updateLimits,
};

type ApiFunctionName = keyof typeof apiModule;

function isApiFunctionName(value: unknown): value is ApiFunctionName {
  return typeof value === "string" && value in apiModule;
}

async function invokeApiCommand(functionName: ApiFunctionName, args: unknown[]): Promise<unknown> {
  const handler = apiModule[functionName] as ApiCommandHandler;
  return handler(...args);
}

// ============================================================================
// HTTP Routes
// ============================================================================

const publicDir = path.join(__dirname, "../../public");

// Helper functions for file routes
function validateCategory(category: string): FileCategory | null {
  const normalizedName = category.toLowerCase().trim();
  if (!/^[a-z0-9_-]+$/.test(normalizedName)) {
    return null;
  }
  return normalizedName;
}

function sanitizeFileName(name: string): string | null {
  const decoded = decodeURIComponent(name);
  if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) {
    return null;
  }
  if (decoded.startsWith(".")) {
    return null;
  }
  if (decoded.length === 0 || decoded.length > 255) {
    return null;
  }
  return decoded;
}

async function requireAuth(req: Request, res: Response, next: Function): Promise<void> {
  const sessionToken = req.headers['x-session-token'] as string || '';
  if (!sessionToken) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const actor = await auth.getVerifiedActor(sessionToken);
    (req as any).actor = actor;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
}

function requireRole(minRole: number): (req: Request, res: Response, next: Function) => void {
  return (req: Request, res: Response, next: Function): void => {
    const actor = (req as any).actor;
    if (!actor) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (actor.role < minRole) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

// Main dashboard route
apiRouter.get("/", (req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

apiRouter.get("/root", (req: Request, res: Response) => {
  user.printRootCredentials();
  res.sendFile(path.join(publicDir, "root-login.html"));
});

apiRouter.post("/root", async (req: Request, res: Response) => {
  try {
    const { sessionToken } = req.body as { sessionToken?: string };

    if (!sessionToken) {
      return res.status(400).json({ error: "Session token required" });
    }

    const userId = await auth.verifySession(sessionToken);
    if (!userId) {
      return res.status(401).json({ error: "Invalid or expired session token" });
    }

    const userData = await cache.get<DbUser>(`user:${userId}`);
    if (!userData || userData.role !== Roles.ROOT) {
      return res.status(403).json({ error: "ROOT access required" });
    }

    res.cookie('sessionToken', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    });

    console.log(`${colors.green}[api]${colors.reset} ROOT login successful`);

    return res.json({
      success: true,
      sessionToken,
      userId,
      username: 'ROOT',
      redirect: '/dashboard/'
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to login";
    console.error(`${colors.red}[api]${colors.reset} ROOT login failed:`, message);
    return res.status(500).json({ error: message });
  }
});

// File routes
apiRouter.get("/files", async (_req: Request, res: Response): Promise<void> => {
  try {
    const allFiles = await files.listAllFiles();
    res.json(allFiles);
  } catch (err) {
    console.error("[api/files] Error listing files:", err);
    res.status(500).json({ error: "Failed to list files" });
  }
});

apiRouter.get("/files/categories", async (_req: Request, res: Response): Promise<void> => {
  try {
    const categories = await files.getCategories();
    res.json(categories);
  } catch (err) {
    console.error("[api/files] Error listing categories:", err);
    res.status(500).json({ error: "Failed to list categories" });
  }
});

apiRouter.post("/files/categories", requireAuth, requireRole(Roles.ADMIN), async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "Category name is required" });
      return;
    }
    const category = await files.createCategory(name);
    res.json({ category });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create category";
    res.status(400).json({ error: message });
  }
});

apiRouter.delete("/files/categories/:name", requireAuth, requireRole(Roles.ADMIN), async (req: Request, res: Response): Promise<void> => {
  try {
    const category = validateCategory(req.params.name as string);
    if (!category) {
      res.status(400).json({ error: "Invalid category name" });
      return;
    }
    await files.deleteCategory(category);
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete category";
    res.status(400).json({ error: message });
  }
});

apiRouter.get("/files/favicon", async (_req: Request, res: Response): Promise<void> => {
  try {
    const favicon = await files.getFavicon();
    if (favicon) {
      res.json(favicon);
    } else {
      res.json({ category: "concord", name: "concord.png" });
    }
  } catch {
    res.json({ category: "concord", name: "concord.png" });
  }
});

apiRouter.post("/files/favicon", requireAuth, requireRole(Roles.ADMIN), async (req: Request, res: Response): Promise<void> => {
  try {
    const { category, name } = req.body;
    if (!category || !name) {
      res.status(400).json({ error: "Category and name are required" });
      return;
    }
    await files.setFavicon(category, name);
    res.json({ success: true, category, name });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to set favicon";
    res.status(400).json({ error: message });
  }
});

apiRouter.get("/files/:category", async (req: Request, res: Response): Promise<void> => {
  const category = validateCategory(req.params.category as string);
  if (!category) {
    res.status(400).json({ error: "Invalid category" });
    return;
  }
  try {
    const fileList = await files.listFiles(category);
    const metadata: FileMeta[] = [];
    for (const name of fileList) {
      const meta = await files.getFileMeta(category, name);
      if (meta) {
        metadata.push(meta);
      }
    }
    res.json(metadata);
  } catch (err) {
    console.error("[api/files] Error listing files:", err);
    res.status(500).json({ error: "Failed to list files" });
  }
});

apiRouter.get("/files/:category/:name", async (req: Request, res: Response): Promise<void> => {
  const category = validateCategory(req.params.category as string);
  if (!category) {
    res.status(400).json({ error: "Invalid category" });
    return;
  }
  const sanitizedName = sanitizeFileName(req.params.name as string);
  if (!sanitizedName) {
    res.status(400).json({ error: "Invalid file name" });
    return;
  }
  try {
    const fileBuffer = await files.getFile(category, sanitizedName);
    if (!fileBuffer) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    const meta = await files.getFileMeta(category, sanitizedName);
    const mimeType = meta?.mimeType || "application/octet-stream";
    res.set("Content-Type", mimeType);
    res.set("Cache-Control", "public, max-age=31536000");
    res.send(fileBuffer);
  } catch (err) {
    console.error("[api/files] Error serving file:", err);
    res.status(500).json({ error: "Failed to serve file" });
  }
});

apiRouter.post("/call", async (req: Request, res: Response) => {
  const { functionName, args } = req.body as ApiCallRequest;
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

  const sessionToken = Array.isArray(args) && args.length > 0 && typeof args[0] === 'string' && args[0].length > 32
    ? args[0]
    : null;

  let rateLimitKey = `ip:${clientIp}`;
  let isLoginAttempt = functionName === 'authenticate';

  if (!isLoginAttempt && sessionToken) {
    try {
      const userId = await auth.verifySession(sessionToken);
      if (userId) {
        rateLimitKey = `user:${userId}`;
      }
    } catch {
      // Invalid session, fall back to IP-based limiting
    }
  }

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

  let userIdentifier = 'anonymous';
  let logArgs = parsedArgs;

  // Session token is always first arg - extract user info and exclude from logs
  if (parsedArgs.length > 0 && typeof parsedArgs[0] === 'string') {
    try {
      const actor = await auth.getVerifiedActor(parsedArgs[0]);
      userIdentifier = actor.osrsName || actor.discName || actor.forumName || actor.id.slice(0, 8);
    } catch {
      // Invalid session, keep anonymous
    }
    // Remove session token from logged args
    logArgs = parsedArgs.slice(1);
  }

  // Truncate long arguments (e.g., base64 image data) for cleaner logs
  logArgs = logArgs.map(arg => {
    if (typeof arg === 'string' && arg.length > 100) {
      return `<${arg.length} chars>`;
    }
    return arg;
  });

  const argsStr = logArgs.length === 0 ? '' : logArgs.map(a => JSON.stringify(a)).join(', ');
  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0];

  console.log(
    `${colors.gray}[api/call]${colors.reset} ` +
    `${colors.blue}${timeStr}${colors.reset} ` +
    `${colors.cyan}${userIdentifier}${colors.reset} ` +
    `${colors.green}${functionName}${colors.reset}(${colors.yellow}${argsStr}${colors.reset})`
  );

  if (!isApiFunctionName(functionName)) {
    console.error(`${colors.red}Error:${colors.reset} [api/call] Function not allowed:`, functionName);
    return res.status(400).json({ error: "Function not allowed" });
  }

  try {
    const result = await invokeApiCommand(functionName, parsedArgs);
    return res.json({ result });
  } catch (err: unknown) {
    let message = err instanceof Error ? err.message : "Unknown API error";
    // Truncate long error messages from the center (e.g., base64 data in validation errors)
    if (message.length > 500) {
      const headLen = Math.floor(250);
      const tailLen = 250;
      const start = message.substring(0, headLen);
      const end = message.substring(message.length - tailLen);
      const omitted = `${colors.gray}... (${message.length - headLen - tailLen} chars omitted) ...${colors.reset}`;
      message = `${start}${omitted}${end}`;
    }
    console.error(`${colors.red}Error:${colors.reset} [api/call]`, message);
    return res.status(500).json({ error: message });
  }
});

export default apiRouter;
