import { eq } from "drizzle-orm";
import { db, dbWithRelations } from "./database.ts";
import { config as configTable } from "./limits.ts";
import * as cache from "../ephemeral/cache.ts";

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

export interface DiscordConfig {
  botToken?: string;
  channelId?: string;
  webhookUrl?: string;
  permissionsInteger?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  discordInviteUrl?: string;
}

const CONFIG_KEY = "config:discord";

/**
 * Gets the Discord configuration from the persistent database,
 * falling back to the Redis cache if the database has no record yet.
 */
export async function getDiscordConfig(): Promise<DiscordConfig> {
  // Try persistent database first
  try {
    const dbResult = await dbWithRelations.query.config.findFirst({
      where: eq(configTable.key, CONFIG_KEY),
    });

    if (dbResult) {
      const config = dbResult.value as DiscordConfig;
      await cache.set(CONFIG_KEY, config);
      return config;
    }
  } catch (err: any) {
    // Table doesn't exist yet or DB not ready — fall through to cache
    if (err?.code !== '42P01') {
      console.warn(`${colors.yellow}[config]${colors.reset} Failed to read discord config from DB:`, err?.message || err);
    }
  }

  // Fall back to Redis cache
  const cached = await cache.get<DiscordConfig>(CONFIG_KEY);
  if (cached) {
    return cached;
  }

  return {};
}

/**
 * Saves the Discord configuration to the persistent database and Redis cache.
 */
export async function saveDiscordConfig(discordConfig: DiscordConfig): Promise<void> {
  // Always sync to Redis cache first (this is the fast path)
  await cache.set(CONFIG_KEY, discordConfig);

  // Then persist to PostgreSQL (may fail if table not ready yet)
  try {
    await db.insert(configTable).values({
      key: CONFIG_KEY,
      value: discordConfig,
    }).onConflictDoUpdate({
      target: configTable.key,
      set: { value: discordConfig },
    });

    console.log(`${colors.green}[config]${colors.reset} Discord config saved to persistent database`);
  } catch (err: any) {
    console.warn(`${colors.yellow}[config]${colors.reset} Failed to save discord config to DB (will retry later):`, err?.message || err);
  }
}
