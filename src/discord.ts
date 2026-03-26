import { Client, GatewayIntentBits, Message, WebhookClient } from "discord.js";

import { Packet, packetEvents, addPacket, type PacketObject, type SerializedPacket } from "./packet.ts";
import { broadcast } from "./runelite.ts";
import * as cache from "./cache.ts";

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

// Discord config cache key
const DISCORD_CONFIG_KEY = "config:discord";

// Lazy-initialized instances
let bot: Client | null = null;
let webhook: WebhookClient | null = null;
let isConnected = false;

interface DiscordConfig {
  botToken?: string;
  channelId?: string;
  webhookUrl?: string;
  permissionsInteger?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  discordInviteUrl?: string;
}

interface Attachment extends PacketObject {
  type: "image" | "video" | "file" | "link";
  url: string;
}

/**
 * Gets the stored Discord configuration from cache.
 */
async function getDiscordConfig(): Promise<DiscordConfig> {
  return (await cache.get(DISCORD_CONFIG_KEY)) || {};
}

/**
 * Saves the Discord configuration to cache.
 */
async function saveDiscordConfig(config: DiscordConfig): Promise<void> {
  await cache.set(DISCORD_CONFIG_KEY, config);
}

/**
 * Checks if the Discord bot is currently connected.
 */
function getIsConnected(): boolean {
  return isConnected && bot?.isReady() === true;
}

/**
 * Parses a Discord webhook URL into ID and token.
 * @param url - The webhook URL (format: https://discord.com/api/webhooks/ID/TOKEN)
 * @returns Object with id and token, or null if invalid
 */
function parseWebhookUrl(url: string): { id: string; token: string } | null {
  const match = url.match(/discord(?:app)?\.com\/api\/webhooks\/([^/]+)\/([^/?]+)/);
  if (match && match[1] && match[2]) {
    return { id: match[1], token: match[2] };
  }
  return null;
}

/**
 * Initializes the Discord bot and webhook clients without starting them.
 * Call startDiscord() to actually connect.
 */
async function initDiscord(): Promise<void> {
  const config = await getDiscordConfig();

  if (!config.botToken || !config.webhookUrl) {
    console.log(`${colors.yellow}[discord]${colors.reset} Not configured - set credentials in admin panel to enable`);
    return;
  }

  const webhookParsed = parseWebhookUrl(config.webhookUrl);
  if (!webhookParsed) {
    console.log(`${colors.yellow}[discord]${colors.reset} Invalid webhook URL format`);
    return;
  }

  // Initialize bot (don't login yet)
  if (!bot) {
    bot = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    // Set up event listeners
    bot.on("messageCreate", handleDiscordMessage);
    bot.once("clientReady", () => {
      if (bot) {
        console.log(`${colors.green}[discord]${colors.reset} Bot logged in as ${colors.cyan}${bot.user?.tag}${colors.reset}`);
      }
    });
  }

  // Initialize webhook (don't send yet)
  if (!webhook) {
    webhook = new WebhookClient({
      id: webhookParsed.id,
      token: webhookParsed.token,
    });
  }

  console.log(`${colors.green}[discord]${colors.reset} Initialized (not connected - click "Connect" in admin panel)`);
}

/**
 * Starts the Discord bot connection.
 */
async function startDiscord(): Promise<{ success: boolean; error?: string }> {
  try {
    const config = await getDiscordConfig();

    if (!config.botToken) {
      return { success: false, error: "Bot token not configured" };
    }

    if (!config.webhookUrl) {
      return { success: false, error: "Webhook URL not configured" };
    }

    const webhookParsed = parseWebhookUrl(config.webhookUrl);
    if (!webhookParsed) {
      return { success: false, error: "Invalid webhook URL format" };
    }

    // Initialize if not already done
    if (!bot) {
      await initDiscord();
    }

    // Login bot
    if (bot && !bot.isReady()) {
      await bot.login(config.botToken);
    }

    // (Re)create webhook with fresh config
    webhook = new WebhookClient({
      id: webhookParsed.id,
      token: webhookParsed.token,
    });

    isConnected = true;
    console.log(`${colors.green}[discord]${colors.reset} Connected`);
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`${colors.red}[discord]${colors.reset} Failed to connect:`, err);
    return { success: false, error };
  }
}

/**
 * Stops the Discord bot and webhook.
 */
async function stopDiscord(): Promise<void> {
  try {
    if (bot) {
      await bot.destroy();
      console.log(`${colors.yellow}[discord]${colors.reset} Bot disconnected`);
    }

    if (webhook) {
      webhook.destroy();
      console.log(`${colors.yellow}[discord]${colors.reset} Webhook disconnected`);
    }

    bot = null;
    webhook = null;
    isConnected = false;
  } catch (err) {
    console.error(`${colors.red}[discord]${colors.reset} Error stopping:`, err);
  }
}

/**
 * Updates Discord configuration and optionally restarts the connection.
 */
async function updateDiscordConfig(
  config: Partial<DiscordConfig>,
  autoConnect?: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const current = await getDiscordConfig();
    const updated = { ...current, ...config };
    await saveDiscordConfig(updated);

    // Stop existing connection
    if (isConnected) {
      await stopDiscord();
    }

    // Auto-connect if all credentials are present
    if (autoConnect && updated.botToken && updated.webhookUrl) {
      return await startDiscord();
    }

    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`${colors.red}[discord]${colors.reset} Failed to update config:`, err);
    return { success: false, error };
  }
}

/**
 * Gets current Discord connection status and config (without secrets).
 */
async function getDiscordStatus(): Promise<{
  isConnected: boolean;
  isConfigured: boolean;
  botTag?: string;
  channelId?: string;
  webhookUrl?: string;
  permissionsInteger?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  discordInviteUrl?: string;
  botToken?: string;
}> {
  const config = await getDiscordConfig();
  const isConfigured = !!(config.botToken && config.webhookUrl);

  return {
    isConnected,
    isConfigured,
    botTag: bot?.user?.tag,
    channelId: config.channelId,
    webhookUrl: config.webhookUrl ? 'https://discord.com/api/webhooks/•••/•••' : undefined,
    botToken: config.botToken ? '••••••••' : undefined,
    clientSecret: config.clientSecret ? '••••••••' : undefined,
    permissionsInteger: config.permissionsInteger,
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    discordInviteUrl: config.discordInviteUrl,
  };
}

// ---------------- Discord -> Concord ----------------
async function handleDiscordMessage(discordMsg: Message): Promise<void> {
  if (discordMsg.author.bot) return;
  if (discordMsg.webhookId) return;
  if (bot?.user && discordMsg.author.id === bot?.user.id) return;
  if (!bot) return; // Bot not initialized

  try {
    const attachments: Attachment[] = [];

    discordMsg.attachments.forEach(att => {
      const contentType = att.contentType || "";
      const type: "image" | "video" | "file" | "link" = contentType.startsWith("image")
        ? "image"
        : contentType.startsWith("video")
        ? "video"
        : "file";
      attachments.push({ type, url: att.url });
    });

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = discordMsg.content.match(urlRegex) || [];
    urls.forEach(url => {
      if (!attachments.find(a => a.url === url)) {
        const ext = url.split(".").pop()?.toLowerCase() || "";
        const type: "image" | "video" | "file" | "link" = ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)
          ? "image"
          : ["mp4", "mov", "webm"].includes(ext)
          ? "video"
          : "link";
        attachments.push({ type, url });
      }
    });

    const packet = new Packet({
      type: "chat.message",
      origin: "discord",
      actor: {
        id: discordMsg.author.id,
        name: discordMsg.author.username,
        roles: [],
        permissions: [],
      },
      auth: {
        userId: null,
        sessionToken: null,
      },
      data: {
        body: discordMsg.content,
        attachments,
      },
    });

    await addPacket(packet);
    console.log(`${colors.green}[discord]${colors.reset} Discord -> Concord: ${colors.cyan}${packet.data.body}${colors.reset} (${colors.yellow}${attachments.length}${colors.reset} attachments)`);
  } catch (err) {
    console.error(`${colors.red}[discord]${colors.reset} Failed to relay Discord message:`, err);
  }
}

// ---------------- Concord -> Discord + RuneLite ----------------
packetEvents.on("packetAdded", async (packetJson: Packet | SerializedPacket) => {
  const packet = Packet.fromJson(packetJson);
  if (packet.deleted) return;
  console.log(
    `${colors.cyan}[discord]${colors.reset} [${new Date().toISOString()}] packetId=${colors.yellow}${packet.id}${colors.reset} origin=${colors.cyan}${packet.origin}${colors.reset} body=${JSON.stringify(packet.data.body)}`
  );

  broadcast(packet);

  if (packet.type !== "chat.message") return;
  if (String(packet.origin).toLowerCase() === "discord") return;
  if (!webhook) return; // Webhook not initialized

  try {
    console.log(`${colors.cyan}[discord]${colors.reset} Webhook send: packetId=${colors.yellow}${packet.id}${colors.reset}`);
    await webhook.send({
      content: packet.data.body,
      username: `${packet.actor.name}`,
    });
    console.log(`${colors.green}[discord]${colors.reset} Concord -> Discord: ${colors.cyan}${packet.data.body}${colors.reset}`);
  } catch (err) {
    console.error(`${colors.red}[discord]${colors.reset} Webhook send failed:`, err);
  }
});

export {
  initDiscord,
  getDiscordConfig,
  saveDiscordConfig,
  getIsConnected,
  startDiscord,
  stopDiscord,
  updateDiscordConfig,
  getDiscordStatus,
};
