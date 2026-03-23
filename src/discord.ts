import dotenv from "dotenv";
import { Client, GatewayIntentBits, WebhookClient, Message } from "discord.js";
import { Packet, packetEvents, addPacket, type PacketObject, type SerializedPacket } from "./packet";
import { broadcast } from "./runelite";

dotenv.config();

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

// ---------------- Discord Setup ----------------
const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const webhook = new WebhookClient({
  id: process.env.WEBHOOK_ID || "",
  token: process.env.WEBHOOK_TOKEN || "",
});

interface Attachment extends PacketObject {
  type: "image" | "video" | "file" | "link";
  url: string;
}

// ---------------- Discord -> Concord ----------------
bot.on("messageCreate", async (discordMsg: Message) => {
  if (discordMsg.author.bot) return;
  if (discordMsg.webhookId) return;
  if (bot.user && discordMsg.author.id === bot.user.id) return;

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
});

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

// ---------------- Startup ----------------
async function startBot(): Promise<void> {
  const token = process.env.BOT_TOKEN;

  bot.once("clientReady", () => {
    console.log(`${colors.green}[discord]${colors.reset} Bot logged in as ${colors.cyan}${bot.user?.tag}${colors.reset}`);
  });

  await bot.login(token).catch(console.error);
}

startBot();
