import fs from "node:fs";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import type { Router, Request, Response } from "express";

import * as auth from "../auth.ts";
import type { ActorData } from "../auth.ts";
import * as cache from "../cache.ts";
import { Roles, type RoleType, getRequiredRoleForCommand } from "../permission.ts";
import * as limits from "../limits.ts";
import * as user from "../user.ts";
import type { UserData } from "../user.ts";

import * as packets from "./packets.ts";
import * as files from "./files.ts";
import * as config from "./config.ts";

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
  const minimumRole = await getRequiredRoleForCommand(commandName);

  // If no role required, allow anonymous access
  if (minimumRole == null) {
    return null;
  }

  // If session token is empty/null, user can't meet role requirement
  if (!actorSessionToken) {
    throw new Error("Authentication required");
  }

  return auth.requireRole(actorSessionToken, minimumRole);
}

// ============================================================================
// Auth Exports
// ============================================================================

export const authenticate = async (
  identifier: string,
  password: string
) => {
  // authenticate() allows anonymous access (no session token needed)
  await checkCommandAccess("authenticate", "");
  return auth.authenticate(identifier, password);
};

export const verifySession = async (
  sessionToken: string
) => {
  // verifySession() allows anonymous access (just validates the token)
  await checkCommandAccess("verifySession", sessionToken || "");
  return auth.verifySession(sessionToken);
};


// ============================================================================
// Cache Exports
// ============================================================================

export const saveState = async (actorSessionToken: string) => {
  await checkCommandAccess("saveState", actorSessionToken);
  return cache.saveState();
};

export const loadState = async (actorSessionToken: string) => {
  await checkCommandAccess("loadState", actorSessionToken);
  return cache.loadState();
};

// ============================================================================
// Packet Management Exports
// ============================================================================

export const addPacket = (
  actorSessionToken: string,
  body: string,
  actorDetails: Partial<import("../packet.ts").ActorInfo> = {},
  origin = "Concord",
  data: import("../packet.ts").PacketData = {},
  meta: import("../packet.ts").PacketObject = {}
): Promise<boolean> => {
  const requireAuth = () => checkCommandAccess("addPacket", actorSessionToken);
  return packets.addPacket(requireAuth, actorSessionToken, body, actorDetails, origin, data, meta);
};

export const getPackets = (
  actorSessionToken: string,
  limit = 50
): Promise<import("../packet.ts").SerializedPacket[]> => {
  const requireAuth = () => checkCommandAccess("getPackets", actorSessionToken);
  return packets.getPackets(requireAuth, limit);
};

export const deletePacket = (
  actorSessionToken: string,
  packetId: string
): Promise<boolean> => {
  const requireAuth = () => checkCommandAccess("deletePacket", actorSessionToken);
  return packets.deletePacket(requireAuth, packetId);
};

export const editPacket = (
  actorSessionToken: string,
  packetId: string,
  newContent: string
): Promise<boolean> => {
  const requireAuth = () => checkCommandAccess("editPacket", actorSessionToken);
  return packets.editPacket(requireAuth, packetId, newContent);
};

export const getSuppressedPrefixes = (
  actorSessionToken: string
): Promise<string[]> => {
  const requireAuth = () => checkCommandAccess("getSuppressedPrefixes", actorSessionToken);
  return packets.getSuppressedPrefixes(requireAuth);
};

export const setSuppressedPrefixes = (
  actorSessionToken: string,
  prefixes: string[]
): Promise<string[]> => {
  const requireAuth = () => checkCommandAccess("setSuppressedPrefixes", actorSessionToken);
  return packets.setSuppressedPrefixes(requireAuth, prefixes);
};

export const getCommandRoleRequirements = (
  actorSessionToken: string
): Promise<Record<string, import("../permission.ts").CommandRoleRequirementDetails>> => {
  const requireAuth = () => checkCommandAccess("getCommandRoleRequirements", actorSessionToken);
  return packets.getCommandRoleRequirements(requireAuth);
};

export const setCommandRoleRequirement = (
  actorSessionToken: string,
  commandName: string,
  role: string | number | null
): Promise<{ commandName: string; roleValue: RoleType | null; roleName: string }> => {
  const requireAuth = () => checkCommandAccess("setCommandRoleRequirement", actorSessionToken);
  return packets.setCommandRoleRequirement(requireAuth, commandName, role);
};

// ============================================================================
// File Management Exports
// ============================================================================

export const listFiles = (
  actorSessionToken: string
): Promise<Record<import("../files.ts").FileCategory, import("../files.ts").FileMeta[]>> => {
  const requireAuth = () => checkCommandAccess("listFiles", actorSessionToken);
  return files.listFiles(requireAuth);
};

export const uploadFile = (
  actorSessionToken: string,
  category: import("../files.ts").FileCategory,
  name: string,
  base64Data: string,
  mimeType?: string
): Promise<import("../files.ts").FileMeta> => {
  const requireAuth = () => checkCommandAccess("uploadFile", actorSessionToken);
  return files.uploadFile(requireAuth, category, name, base64Data, mimeType);
};

export const deleteFile = (
  actorSessionToken: string,
  category: import("../files.ts").FileCategory,
  name: string
): Promise<boolean> => {
  const requireAuth = () => checkCommandAccess("deleteFile", actorSessionToken);
  return files.deleteFile(requireAuth, category, name);
};

export const getCategories = (
  actorSessionToken: string
): Promise<import("../files.ts").FileCategory[]> => {
  const requireAuth = () => checkCommandAccess("getCategories", actorSessionToken);
  return files.getCategories(requireAuth);
};

export const createCategory = (
  actorSessionToken: string,
  name: string
): Promise<import("../files.ts").FileCategory> => {
  const requireAuth = () => checkCommandAccess("createCategory", actorSessionToken);
  return files.createCategory(requireAuth, name);
};

export const deleteCategory = (
  actorSessionToken: string,
  name: string
): Promise<boolean> => {
  const requireAuth = () => checkCommandAccess("deleteCategory", actorSessionToken);
  return files.deleteCategory(requireAuth, name);
};

export const getAllowedMimeTypes = (
  actorSessionToken: string
): Promise<string[]> => {
  const requireAuth = () => checkCommandAccess("getAllowedMimeTypes", actorSessionToken);
  return files.getAllowedMimeTypes(requireAuth);
};

export const setAllowedMimeTypes = (
  actorSessionToken: string,
  ...mimeTypes: string[]
): Promise<void> => {
  const requireAuth = () => checkCommandAccess("setAllowedMimeTypes", actorSessionToken);
  const requireRoot = async () => {
    const actor = await auth.getVerifiedActor(actorSessionToken);
    if (actor.role < Roles.ROOT) {
      throw new Error("ROOT access required");
    }
  };
  return files.setAllowedMimeTypes(requireAuth, requireRoot, ...mimeTypes);
};

// ============================================================================
// User Management Exports
// ============================================================================

export const createUser = async (
  actorSessionToken: string,
  osrs_name: string,
  disc_name: string,
  forum_name: string,
  password: string
) => {
  await checkCommandAccess("createUser", actorSessionToken);
  return user.createUser(actorSessionToken, osrs_name, disc_name, forum_name, password);
};

export const listUsers = async (
  actorSessionToken: string
) => {
  await checkCommandAccess("listUsers", actorSessionToken);
  return user.listUsers(actorSessionToken);
};

export const getUser = async (
  actorSessionToken: string,
  identifier: string
) => {
  await checkCommandAccess("getUser", actorSessionToken);
  return user.getUser(actorSessionToken, identifier);
};

export const setRole = async (
  actorSessionToken: string,
  targetIdentifier: string,
  newRole: string | number
) => {
  await checkCommandAccess("setRole", actorSessionToken);
  return user.setRole(actorSessionToken, targetIdentifier, newRole);
};

export const deleteUser = async (
  actorSessionToken: string,
  targetIdentifier: string
) => {
  await checkCommandAccess("deleteUser", actorSessionToken);
  return user.deleteUser(actorSessionToken, targetIdentifier);
};

export const changePassword = async (
  actorSessionToken: string,
  targetIdentifier: string,
  newPassword: string
) => {
  await checkCommandAccess("changePassword", actorSessionToken);
  return user.changePassword(actorSessionToken, targetIdentifier, newPassword);
};

export const resetPassword = async (
  actorSessionToken: string,
  targetIdentifier: string,
  newPassword: string
) => {
  await checkCommandAccess("resetPassword", actorSessionToken);
  return user.resetPassword(actorSessionToken, targetIdentifier, newPassword);
};

// ============================================================================
// Discord Configuration Exports
// ============================================================================

export const getDiscordStatus = (
  actorSessionToken: string
): Promise<{ isConnected: boolean; isConfigured: boolean; botTag?: string; channelId?: string }> => {
  const requireAuth = () => checkCommandAccess("getDiscordStatus", actorSessionToken);
  return config.getDiscordStatus(requireAuth);
};

export const updateDiscordConfig = (
  actorSessionToken: string,
  discordConfig: {
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
  const requireAuth = () => checkCommandAccess("updateDiscordConfig", actorSessionToken);
  return config.updateDiscordConfig(requireAuth, discordConfig, autoConnect);
};

export const startDiscord = (
  actorSessionToken: string
): Promise<{ success: boolean; error?: string }> => {
  const requireAuth = () => checkCommandAccess("startDiscord", actorSessionToken);
  return config.startDiscord(requireAuth);
};

export const stopDiscord = (
  actorSessionToken: string
): Promise<void> => {
  const requireAuth = () => checkCommandAccess("stopDiscord", actorSessionToken);
  return config.stopDiscord(requireAuth);
};

// ============================================================================
// Limits Configuration Exports
// ============================================================================

export const getAllLimits = (
  actorSessionToken: string
): Promise<Array<object>> => {
  const requireAuth = () => checkCommandAccess("getAllLimits", actorSessionToken);
  return config.getAllLimits(requireAuth);
};

export const updateLimits = (
  actorSessionToken: string,
  limitsConfig: Record<string, string>
): Promise<{ success: boolean; error?: string }> => {
  const requireAuth = () => checkCommandAccess("updateLimits", actorSessionToken);
  return config.updateLimits(requireAuth, limitsConfig);
};

// ============================================================================
// Command Dispatcher
// ============================================================================

const apiModule = {
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
  listFiles,
  uploadFile,
  deleteFile,
  getCategories,
  createCategory,
  deleteCategory,
  getAllowedMimeTypes,
  setAllowedMimeTypes,
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

apiRouter.get("/", (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

apiRouter.get("/root", (req: Request, res: Response) => {
  user.printRootCredentials();
  res.sendFile(path.join(__dirname, "../public/root-login.html"));
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

    const userData = await cache.get<UserData>(`user:${userId}`);
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

  if (parsedArgs.length > 0 && typeof parsedArgs[0] === 'string' && parsedArgs[0].length > 32) {
    try {
      const actor = await auth.getVerifiedActor(parsedArgs[0]);
      userIdentifier = actor.osrs_name || actor.disc_name || actor.forum_name || actor.id.slice(0, 8);
    } catch {
      // Invalid session, keep anonymous
    }
    logArgs = parsedArgs.slice(1);
  }

  if (functionName === 'uploadFile' && logArgs.length > 3) {
    logArgs = [logArgs[0], logArgs[1], `<${logArgs[2].length} bytes>`, logArgs[3]];
  }

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
    const message = err instanceof Error ? err.message : "Unknown API error";
    console.error(`${colors.red}Error:${colors.reset} [api/call]`, message);
    return res.status(500).json({ error: message });
  }
});

export default apiRouter;
