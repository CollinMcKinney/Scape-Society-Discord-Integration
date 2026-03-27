import fs from "node:fs";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import type { Router, Request, Response } from "express";

import * as auth from "../auth.ts";
import type { ActorData } from "../auth.ts";
import * as cache from "../cache.ts";
import { Roles, type RoleType } from "../permission.ts";
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

// ============================================================================
// Auth Helpers
// ============================================================================

/**
 * Ensures the caller meets the provided role requirement.
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
 * Enforces the configured role requirement for an admin command.
 */
async function requireAdminCommand(commandName: string, actorSessionToken: string): Promise<AdminActor> {
  const minimumRole = await import("../permission.ts").then(m => m.getRequiredRoleForCommand(commandName));
  return requireRole(actorSessionToken, minimumRole);
}

// ============================================================================
// Auth Exports
// ============================================================================

export const authenticate = auth.authenticate;
export const verifySession = auth.verifySession;

// ============================================================================
// Cache Exports
// ============================================================================

export const saveState = async (actorSessionToken: string) => {
  await requireAdminCommand("saveState", actorSessionToken);
  return cache.saveState();
};

export const loadState = async (actorSessionToken: string) => {
  await requireAdminCommand("loadState", actorSessionToken);
  return cache.loadState();
};

// ============================================================================
// Packet Management Exports
// ============================================================================

export const addPacket = (
  actorSessionToken: string,
  body: string,
  actorDetails: import("../packet.ts").ActorInfo = {},
  origin = "admin",
  data: import("../packet.ts").PacketData = {},
  meta: import("../packet.ts").PacketObject = {}
): Promise<boolean> => {
  const requireAuth = () => requireAdminCommand("addPacket", actorSessionToken);
  return packets.addPacket(requireAuth, actorSessionToken, body, actorDetails, origin, data, meta);
};

export const getPackets = (
  actorSessionToken: string,
  limit = 50
): Promise<import("../packet.ts").SerializedPacket[]> => {
  const requireAuth = () => requireAdminCommand("getPackets", actorSessionToken);
  return packets.getPackets(requireAuth, limit);
};

export const deletePacket = (
  actorSessionToken: string,
  packetId: string
): Promise<boolean> => {
  const requireAuth = () => requireAdminCommand("deletePacket", actorSessionToken);
  return packets.deletePacket(requireAuth, packetId);
};

export const editPacket = (
  actorSessionToken: string,
  packetId: string,
  newContent: string
): Promise<boolean> => {
  const requireAuth = () => requireAdminCommand("editPacket", actorSessionToken);
  return packets.editPacket(requireAuth, packetId, newContent);
};

export const getSuppressedPrefixes = (
  actorSessionToken: string
): Promise<string[]> => {
  const requireAuth = () => requireAdminCommand("getSuppressedPrefixes", actorSessionToken);
  return packets.getSuppressedPrefixes(requireAuth);
};

export const setSuppressedPrefixes = (
  actorSessionToken: string,
  prefixes: string[]
): Promise<string[]> => {
  const requireAuth = () => requireAdminCommand("setSuppressedPrefixes", actorSessionToken);
  return packets.setSuppressedPrefixes(requireAuth, prefixes);
};

export const getCommandRoleRequirements = (
  actorSessionToken: string
): Promise<Record<string, import("../permission.ts").CommandRoleRequirementDetails>> => {
  const requireAuth = () => requireAdminCommand("getCommandRoleRequirements", actorSessionToken);
  return packets.getCommandRoleRequirements(requireAuth);
};

export const setCommandRoleRequirement = (
  actorSessionToken: string,
  commandName: string,
  role: string | number | null
): Promise<{ commandName: string; roleValue: RoleType | null; roleName: string }> => {
  const requireAuth = () => requireAdminCommand("setCommandRoleRequirement", actorSessionToken);
  return packets.setCommandRoleRequirement(requireAuth, commandName, role);
};

// ============================================================================
// File Management Exports
// ============================================================================

export const listFiles = (
  actorSessionToken: string
): Promise<Record<import("../files.ts").FileCategory, import("../files.ts").FileMeta[]>> => {
  const requireAuth = () => requireAdminCommand("listFiles", actorSessionToken);
  return files.listFiles(requireAuth);
};

export const uploadFile = (
  actorSessionToken: string,
  category: import("../files.ts").FileCategory,
  name: string,
  base64Data: string,
  mimeType?: string
): Promise<import("../files.ts").FileMeta> => {
  const requireAuth = () => requireAdminCommand("uploadFile", actorSessionToken);
  return files.uploadFile(requireAuth, category, name, base64Data, mimeType);
};

export const deleteFile = (
  actorSessionToken: string,
  category: import("../files.ts").FileCategory,
  name: string
): Promise<boolean> => {
  const requireAuth = () => requireAdminCommand("deleteFile", actorSessionToken);
  return files.deleteFile(requireAuth, category, name);
};

export const getCategories = (
  actorSessionToken: string
): Promise<import("../files.ts").FileCategory[]> => {
  const requireAuth = () => requireAdminCommand("getCategories", actorSessionToken);
  return files.getCategories(requireAuth);
};

export const createCategory = (
  actorSessionToken: string,
  name: string
): Promise<import("../files.ts").FileCategory> => {
  const requireAuth = () => requireAdminCommand("createCategory", actorSessionToken);
  return files.createCategory(requireAuth, name);
};

export const deleteCategory = (
  actorSessionToken: string,
  name: string
): Promise<boolean> => {
  const requireAuth = () => requireAdminCommand("deleteCategory", actorSessionToken);
  return files.deleteCategory(requireAuth, name);
};

export const getAllowedMimeTypes = (
  actorSessionToken: string
): Promise<string[]> => {
  const requireAuth = () => requireAdminCommand("getAllowedMimeTypes", actorSessionToken);
  return files.getAllowedMimeTypes(requireAuth);
};

export const setAllowedMimeTypes = (
  actorSessionToken: string,
  ...mimeTypes: string[]
): Promise<void> => {
  const requireAuth = () => requireAdminCommand("setAllowedMimeTypes", actorSessionToken);
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
  await requireAdminCommand("createUser", actorSessionToken);
  return user.createUser(actorSessionToken, osrs_name, disc_name, forum_name, password);
};

export const listUsers = user.listUsers;
export const getUser = user.getUser;
export const setRole = user.setRole;
export const deleteUser = user.deleteUser;
export const changePassword = user.changePassword;
export const resetPassword = user.resetPassword;

// ============================================================================
// Discord Configuration Exports
// ============================================================================

export const getDiscordStatus = (
  actorSessionToken: string
): Promise<{ isConnected: boolean; isConfigured: boolean; botTag?: string; channelId?: string }> => {
  const requireAuth = () => requireAdminCommand("getDiscordStatus", actorSessionToken);
  return config.getDiscordStatus(requireAuth);
};

export const updateDiscordConfig = (
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
): Promise<{ success: boolean; error?: string }> => {
  const requireAuth = () => requireAdminCommand("updateDiscordConfig", actorSessionToken);
  return config.updateDiscordConfig(requireAuth, config, autoConnect);
};

export const startDiscord = (
  actorSessionToken: string
): Promise<{ success: boolean; error?: string }> => {
  const requireAuth = () => requireAdminCommand("startDiscord", actorSessionToken);
  return config.startDiscord(requireAuth);
};

export const stopDiscord = (
  actorSessionToken: string
): Promise<void> => {
  const requireAuth = () => requireAdminCommand("stopDiscord", actorSessionToken);
  return config.stopDiscord(requireAuth);
};

// ============================================================================
// Limits Configuration Exports
// ============================================================================

export const getAllLimits = (
  actorSessionToken: string
): Promise<Array<object>> => {
  const requireAuth = () => requireAdminCommand("getAllLimits", actorSessionToken);
  return config.getAllLimits(requireAuth);
};

export const updateLimits = (
  actorSessionToken: string,
  config: Record<string, string>
): Promise<{ success: boolean; error?: string }> => {
  const requireAuth = () => requireAdminCommand("updateLimits", actorSessionToken);
  return config.updateLimits(requireAuth, config);
};

// ============================================================================
// Command Dispatcher
// ============================================================================

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

type AdminApiFunctionName = keyof typeof adminModule;

function isAdminApiFunctionName(value: unknown): value is AdminApiFunctionName {
  return typeof value === "string" && value in adminModule;
}

async function invokeAdminCommand(functionName: AdminApiFunctionName, args: unknown[]): Promise<unknown> {
  const handler = adminModule[functionName] as AdminCommandHandler;
  return handler(...args);
}

// ============================================================================
// HTTP Routes
// ============================================================================

router.get("/", (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

router.get("/root", (req: Request, res: Response) => {
  user.printRootCredentials();
  res.sendFile(path.join(__dirname, "../public/root-login.html"));
});

router.post("/root", async (req: Request, res: Response) => {
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

    console.log(`${colors.green}[admin]${colors.reset} ROOT login successful`);

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
