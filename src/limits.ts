import { createClient } from "redis";
import * as cache from "./cache.ts";

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

// Redis client for rate limiting
const redisHost = process.env.REDIS_HOST ?? 'redis';
const redisPort = parseInt(process.env.REDIS_PORT ?? '6379');

export const redisClient = createClient({
  socket: {
    host: redisHost,
    port: redisPort
  }
});

// ============================================================================
// Configuration
// ============================================================================

const CONFIG_KEY = "config:limits";

const DEFAULT_LIMITS: Record<string, string> = {
  SESSION_TTL_HOURS: "24",
  RATE_LIMIT_LOGIN_WINDOW_MS: "900000",
  RATE_LIMIT_LOGIN_MAX: "5",
  RATE_LIMIT_API_WINDOW_MS: "60000",
  RATE_LIMIT_API_MAX: "200",
  RATE_LIMIT_ENV_WINDOW_MS: "300000",
  RATE_LIMIT_ENV_MAX: "10",
  RATE_LIMIT_WS_CONNECTIONS: "10",
  RATE_LIMIT_WS_MESSAGES: "20",
  RATE_LIMIT_WS_PAYLOAD: "1048576",
  UPLOAD_SIZE_LIMIT: "10485760",
};

// Runtime limit values (loaded from cache)
export let RATE_LIMITS = {
  LOGIN: { windowMs: 900000, maxAttempts: 5 },
  API: { windowMs: 60000, maxAttempts: 200 },
  ENV_CHANGE: { windowMs: 300000, maxAttempts: 10 },
};

export let WS_RATE_LIMITS = {
  MAX_CONNECTIONS: 10,
  MAX_MESSAGES_PER_SECOND: 20,
  MAX_PAYLOAD_SIZE: 1048576
};

export let SESSION_TTL_HOURS = 24;
export let UPLOAD_SIZE_LIMIT = 10485760;

// ============================================================================
// Config Management
// ============================================================================

export async function getLimitsConfig(): Promise<Record<string, string>> {
  const stored = await cache.get<Record<string, string>>(CONFIG_KEY);
  return { ...DEFAULT_LIMITS, ...stored };
}

export async function saveLimitsConfig(config: Record<string, string>): Promise<{ success: boolean; error?: string }> {
  try {
    const current = await getLimitsConfig();
    const updated = { ...current, ...config };
    await cache.set(CONFIG_KEY, updated);
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

export function getLimitMetadata(key: string): { label: string; type: string; help: string } | undefined {
  const metadata: Record<string, { label: string; type: string; help: string }> = {
    SESSION_TTL_HOURS: { label: 'Session TTL (Hours)', type: 'number', help: 'How long user sessions remain valid' },
    RATE_LIMIT_LOGIN_WINDOW_MS: { label: 'Login Rate Window (ms)', type: 'number', help: 'Time window for login attempt counting' },
    RATE_LIMIT_LOGIN_MAX: { label: 'Max Login Attempts', type: 'number', help: 'Maximum login attempts per window' },
    RATE_LIMIT_API_WINDOW_MS: { label: 'API Rate Window (ms)', type: 'number', help: 'Time window for API call counting' },
    RATE_LIMIT_API_MAX: { label: 'Max API Calls', type: 'number', help: 'Maximum API calls per window' },
    RATE_LIMIT_ENV_WINDOW_MS: { label: 'Env Change Window (ms)', type: 'number', help: 'Time window for env change counting' },
    RATE_LIMIT_ENV_MAX: { label: 'Max Env Changes', type: 'number', help: 'Maximum env changes per window' },
    RATE_LIMIT_WS_CONNECTIONS: { label: 'Max WS Connections', type: 'number', help: 'Maximum WebSocket connections per IP' },
    RATE_LIMIT_WS_MESSAGES: { label: 'Max WS Messages/sec', type: 'number', help: 'Maximum WebSocket messages per second' },
    RATE_LIMIT_WS_PAYLOAD: { label: 'Max WS Payload (bytes)', type: 'number', help: 'Maximum WebSocket message size' },
    UPLOAD_SIZE_LIMIT: { label: 'Upload Size Limit (bytes)', type: 'number', help: 'Maximum file upload size' },
  };
  return metadata[key];
}

export async function getAllLimits(): Promise<Array<{ key: string; value: string; label: string; type: string; help: string }>> {
  const config = await getLimitsConfig();
  return Object.entries(config).map(([key, value]) => {
    const meta = getLimitMetadata(key);
    return {
      key,
      value,
      label: meta?.label || key,
      type: meta?.type || 'text',
      help: meta?.help || '',
    };
  });
}

// ============================================================================
// Initialization
// ============================================================================

export async function initLimits(): Promise<void> {
  if (!redisClient.isOpen) {
    await redisClient.connect();
    console.log(`${colors.green}[Limits]${colors.reset} Redis connected`);
  }

  // Load limits from cache
  const config = await getLimitsConfig();

  RATE_LIMITS = {
    LOGIN: {
      windowMs: parseInt(config.RATE_LIMIT_LOGIN_WINDOW_MS) || 900000,
      maxAttempts: parseInt(config.RATE_LIMIT_LOGIN_MAX) || 5
    },
    API: {
      windowMs: parseInt(config.RATE_LIMIT_API_WINDOW_MS) || 60000,
      maxAttempts: parseInt(config.RATE_LIMIT_API_MAX) || 200
    },
    ENV_CHANGE: {
      windowMs: parseInt(config.RATE_LIMIT_ENV_WINDOW_MS) || 300000,
      maxAttempts: parseInt(config.RATE_LIMIT_ENV_MAX) || 10
    },
  };

  WS_RATE_LIMITS = {
    MAX_CONNECTIONS: parseInt(config.RATE_LIMIT_WS_CONNECTIONS) || 10,
    MAX_MESSAGES_PER_SECOND: parseInt(config.RATE_LIMIT_WS_MESSAGES) || 20,
    MAX_PAYLOAD_SIZE: parseInt(config.RATE_LIMIT_WS_PAYLOAD) || 1048576
  };

  SESSION_TTL_HOURS = parseInt(config.SESSION_TTL_HOURS) || 24;
  UPLOAD_SIZE_LIMIT = parseInt(config.UPLOAD_SIZE_LIMIT) || 10485760;

  console.log(`${colors.green}[Limits]${colors.reset} Configuration loaded from cache`);
}

// ============================================================================
// Rate Limiting
// ============================================================================

/**
 * Check if an action is rate limited using sliding window algorithm.
 * @param key - Unique identifier for the action (e.g., IP + action type)
 * @param limitType - Type of rate limit to apply
 * @returns True if action is allowed, false if rate limited
 */
export async function checkRateLimit(key: string, limitType: keyof typeof RATE_LIMITS): Promise<boolean> {
  const limit = RATE_LIMITS[limitType];
  const redisKey = `ratelimit:${limitType}:${key}`;
  const now = Date.now();
  const windowStart = now - limit.windowMs;

  // Get recent request timestamps using sorted set
  const timestamps = await redisClient.zRangeByScore(redisKey, windowStart, '+inf');
  const recentCount = timestamps.length;

  if (recentCount >= limit.maxAttempts) {
    // Calculate time until next request is allowed
    const oldestTimestamp = timestamps[0];
    const retryAfter = Math.ceil((parseInt(oldestTimestamp) + limit.windowMs - now) / 1000);
    console.log(`${colors.yellow}[Limits]${colors.reset} Rate limited: ${colors.cyan}${key}${colors.reset} (${limitType}) - retry in ${retryAfter}s`);
    return false;
  }

  // Add current request timestamp to sorted set
  await redisClient.zAdd(redisKey, { score: now, value: now.toString() });

  // Set expiry to clean up old keys automatically
  await redisClient.expire(redisKey, Math.ceil(limit.windowMs / 1000) + 1);

  return true;
}

/**
 * Get remaining attempts for a rate limit
 * @param key - Unique identifier for the action
 * @param limitType - Type of rate limit
 * @returns Number of remaining attempts
 */
export async function getRemainingAttempts(key: string, limitType: keyof typeof RATE_LIMITS): Promise<number> {
  const limit = RATE_LIMITS[limitType];
  const redisKey = `ratelimit:${limitType}:${key}`;
  const now = Date.now();
  const windowStart = now - limit.windowMs;

  const timestamps = await redisClient.zRangeByScore(redisKey, windowStart, '+inf');
  const recentCount = timestamps.length;

  return Math.max(0, limit.maxAttempts - recentCount);
}

/**
 * Get rate limit info for display
 * @param key - Unique identifier for the action
 * @param limitType - Type of rate limit
 * @returns Object with current status
 */
export async function getRateLimitInfo(key: string, limitType: keyof typeof RATE_LIMITS): Promise<{
  current: number;
  max: number;
  remaining: number;
  resetIn: number;
}> {
  const limit = RATE_LIMITS[limitType];
  const redisKey = `ratelimit:${limitType}:${key}`;
  const now = Date.now();
  const windowStart = now - limit.windowMs;

  const timestamps = await redisClient.zRangeByScore(redisKey, windowStart, '+inf');
  const recentCount = timestamps.length;

  // Calculate when the oldest request will expire
  const oldestTimestamp = timestamps[0] ? parseInt(timestamps[0]) : now;
  const resetIn = timestamps.length > 0 ? (oldestTimestamp + limit.windowMs - now) : 0;

  return {
    current: recentCount,
    max: limit.maxAttempts,
    remaining: Math.max(0, limit.maxAttempts - recentCount),
    resetIn: Math.max(0, resetIn)
  };
}
