import * as discord from "../discord.ts";
import * as limits from "../limits.ts";

/**
 * Gets Discord connection status and configuration.
 */
export async function getDiscordStatus(): Promise<{
  isConnected: boolean;
  isConfigured: boolean;
  botTag?: string;
  channelId?: string;
}> {
  return discord.getDiscordStatus();
}

/**
 * Updates Discord configuration.
 */
export async function updateDiscordConfig(
  sessionToken: string,
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
  return discord.updateDiscordConfig(config, autoConnect);
}

/**
 * Starts Discord bot connection.
 */
export async function startDiscord(): Promise<{ success: boolean; error?: string }> {
  return discord.startDiscord();
}

/**
 * Stops Discord bot connection.
 */
export async function stopDiscord(): Promise<void> {
  return discord.stopDiscord();
}

/**
 * Gets all runtime limits configuration.
 */
export async function getAllLimits(): Promise<Array<object>> {
  return limits.getAllLimits();
}

/**
 * Updates runtime limits configuration.
 */
export async function updateLimits(
  sessionToken: string,
  config: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  return limits.saveLimitsConfig(config);
}
