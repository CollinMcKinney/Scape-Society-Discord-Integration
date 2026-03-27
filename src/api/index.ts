import fs from "node:fs";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import type { Router, Request, Response } from "express";

import * as auth from "../auth.ts";
import type { ActorData } from "../auth.ts";
import * as cache from "../cache.ts";
import { Roles, type RoleType, getMinimumRoleForCommand } from "../permission.ts";
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
  const minimumRole = await getMinimumRoleForCommand(commandName);

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
// Cache Exports
// ============================================================================

export const saveState = apiCommand("saveState", cache.saveState);
export const loadState = apiCommand("loadState", cache.loadState);

// ============================================================================
// Packet Management Exports
// ============================================================================

export const addPacket = apiCommand("addPacket", packets.addPacket);
export const getPackets = apiCommand("getPackets", packets.getPackets);
export const deletePacket = apiCommand("deletePacket", packets.deletePacket);
export const editPacket = apiCommand("editPacket", packets.editPacket);
export const getSuppressedPrefixes = apiCommand("getSuppressedPrefixes", packets.getSuppressedPrefixes);
export const setSuppressedPrefixes = apiCommand("setSuppressedPrefixes", packets.setSuppressedPrefixes);
export const getCommandRoleRequirements = apiCommand("getCommandRoleRequirements", packets.getCommandRoleRequirements);
export const setCommandRoleRequirement = apiCommand("setCommandRoleRequirement", packets.setCommandRoleRequirement);

// ============================================================================
// File Management Exports
// ============================================================================

export const listFiles = apiCommand("listFiles", files.listFiles);
export const uploadFile = apiCommand("uploadFile", files.uploadFile);
export const deleteFile = apiCommand("deleteFile", files.deleteFile);
export const getCategories = apiCommand("getCategories", files.getCategories);
export const createCategory = apiCommand("createCategory", files.createCategory);
export const deleteCategory = apiCommand("deleteCategory", files.deleteCategory);
export const getAllowedMimeTypes = apiCommand("getAllowedMimeTypes", files.getAllowedMimeTypes);
export const setAllowedMimeTypes = apiCommand("setAllowedMimeTypes", files.setAllowedMimeTypes);

// ============================================================================
// User Management Exports
// ============================================================================

export const createUser = apiCommand("createUser", user.createUser);
export const listUsers = apiCommand("listUsers", user.listUsers);
export const getUser = apiCommand("getUser", user.getUser);
export const setRole = apiCommand("setRole", user.setRole);
export const deleteUser = apiCommand("deleteUser", user.deleteUser);
export const changePassword = apiCommand("changePassword", user.changePassword);
export const resetPassword = apiCommand("resetPassword", user.resetPassword);

// ============================================================================
// Discord Configuration Exports
// ============================================================================

export const getDiscordStatus = apiCommand("getDiscordStatus", config.getDiscordStatus);
export const updateDiscordConfig = apiCommand("updateDiscordConfig", config.updateDiscordConfig);
export const startDiscord = apiCommand("startDiscord", config.startDiscord);
export const stopDiscord = apiCommand("stopDiscord", config.stopDiscord);

// ============================================================================
// Limits Configuration Exports
// ============================================================================

export const getAllLimits = apiCommand("getAllLimits", config.getAllLimits);
export const updateLimits = apiCommand("updateLimits", config.updateLimits);

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
