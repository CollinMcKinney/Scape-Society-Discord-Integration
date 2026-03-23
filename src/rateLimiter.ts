import { createClient } from "redis";

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

const redisClient = createClient({
  socket: { 
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379')
  }
});

// Rate limit configurations
const RATE_LIMITS = {
  // Login attempts: 5 per 15 minutes
  LOGIN: { windowMs: 15 * 60 * 1000, maxAttempts: 5 },
  
  // API calls: 100 per minute
  API: { windowMs: 60 * 1000, maxAttempts: 100 },
  
  // Env changes: 10 per 5 minutes
  ENV_CHANGE: { windowMs: 5 * 60 * 1000, maxAttempts: 10 }
};

/**
 * Initialize Redis client for rate limiting
 */
export async function initRateLimiter(): Promise<void> {
  if (!redisClient.isOpen) {
    await redisClient.connect();
    console.log(`${colors.green}[RateLimiter]${colors.reset} Redis connected`);
  }
}

/**
 * Check if an action is rate limited
 * @param key - Unique identifier for the action (e.g., IP + action type)
 * @param limitType - Type of rate limit to apply
 * @returns True if action is allowed, false if rate limited
 */
export async function checkRateLimit(key: string, limitType: keyof typeof RATE_LIMITS): Promise<boolean> {
  const limit = RATE_LIMITS[limitType];
  const redisKey = `ratelimit:${limitType}:${key}`;
  
  // Get current count
  const current = await redisClient.get(redisKey);
  const count = current ? parseInt(current) : 0;
  
  if (count >= limit.maxAttempts) {
    // Check if window has expired
    const ttl = await redisClient.ttl(redisKey);
    if (ttl > 0) {
      console.log(`${colors.yellow}[RateLimiter]${colors.reset} Rate limited: ${colors.cyan}${key}${colors.reset} (${limitType}) - ${count}/${limit.maxAttempts}`);
      return false;
    }
  }
  
  // Increment counter
  await redisClient.set(redisKey, (count + 1).toString(), { EX: Math.floor(limit.windowMs / 1000) });
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
  
  const current = await redisClient.get(redisKey);
  const count = current ? parseInt(current) : 0;
  
  return Math.max(0, limit.maxAttempts - count);
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
  
  const current = await redisClient.get(redisKey);
  const count = current ? parseInt(current) : 0;
  const ttl = await redisClient.ttl(redisKey);
  
  return {
    current: count,
    max: limit.maxAttempts,
    remaining: Math.max(0, limit.maxAttempts - count),
    resetIn: ttl > 0 ? ttl * 1000 : 0
  };
}

export { RATE_LIMITS, redisClient };
