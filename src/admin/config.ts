import * as discord from "../discord.ts";
import * as limits from "../limits.ts";

/**
 * Gets Discord connection status and configuration.
 */
export async function getDiscordStatus(
  requireAuth: () => Promise<void>
): Promise<{
  isConnected: boolean;
  isConfigured: boolean;
  botTag?: string;
  channelId?: string;
}> {
  await requireAuth();
  return discord.getDiscordStatus();
}

/**
 * Updates Discord configuration.
 */
export async function updateDiscordConfig(
  requireAuth: () => Promise<void>,
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
  await requireAuth();
  return discord.updateDiscordConfig(config, autoConnect);
}

/**
 * Starts Discord bot connection.
 */
export async function startDiscord(
  requireAuth: () => Promise<void>
): Promise<{ success: boolean; error?: string }> {
  await requireAuth();
  return discord.startDiscord();
}

/**
 * Stops Discord bot connection.
 */
export async function stopDiscord(
  requireAuth: () => Promise<void>
): Promise<void> {
  await requireAuth();
  await discord.stopDiscord();
}

/**
 * Gets all runtime limits configuration.
 */
export async function getAllLimits(
  requireAuth: () => Promise<void>
): Promise<Array<object>> {
  await requireAuth();
  return limits.getAllLimits();
}

/**
 * Updates runtime limits configuration.
 */
export async function updateLimits(
  requireAuth: () => Promise<void>,
  config: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  await requireAuth();
  return limits.saveLimitsConfig(config);
}
