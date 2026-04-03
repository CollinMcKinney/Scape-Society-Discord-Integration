import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "dotenv/config";
import express from "express";
import helmet from "helmet";

import { initDiscord } from "./discord.ts";
import { initStorage, client } from "./ephemeral/cache.ts";
import { initDatabase } from "./persistent/database.ts";
import { initFiles, updateUploadSizeLimit, getFile, getFileMeta } from "./persistent/files.ts";
import { Packet, type SerializedPacket } from "./ephemeral/packets.ts";
import { attachToServer, broadcast, closeWebSocketServer } from "./runelite.ts";
import { initializeRoot } from "./persistent/users.ts";
import { updateSessionTTL } from "./ephemeral/sessions.ts";
import { initLimits } from "./persistent/limits.ts";
import apiRouter from "./api/index.ts";

type Express = express.Express;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "../public");

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

// --- Express setup ---
const app: Express = express();

// Security headers (works with or without TLS)
app.use(helmet({
  contentSecurityPolicy: {
    // Avoid forcing HTTPS upgrades when serving over plain HTTP (e.g., IP access)
    // Helmet may add upgrade-insecure-requests by default in some versions.
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"], // External scripts only
      scriptSrcAttr: ["'none'"], // No inline event handlers (onclick, etc.)
      styleSrc: ["'self'", "'unsafe-inline'"], // Self-hosted fonts only
      fontSrc: ["'self'"], // Self-hosted fonts only
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"], // Prevent embedding in iframes
      upgradeInsecureRequests: null,
      blockAllMixedContent: null,
    }
  },
  frameguard: { action: 'deny' }, // Additional clickjacking protection
  hsts: false, // Disable HSTS until TLS is enabled
  crossOriginEmbedderPolicy: false, // Allow loading resources without CORS
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Serve static files from public folder (but not index.html - that's handled by /dashboard route)
app.use(express.static(publicDir, { index: false }));

// Dashboard router - UI for all authenticated users (not just admins)
app.use("/dashboard", apiRouter);
app.use("/modals", express.static(path.join(publicDir, "modals")));

// File serving route (separate from dashboard API)
app.get("/files/:category/:name", async (req, res) => {
  try {
    const { category, name } = req.params;
    const fileBuffer = await getFile(category, name);
    if (!fileBuffer) {
      return res.status(404).json({ error: "File not found" });
    }
    const meta = await getFileMeta(category, name);
    const mimeType = meta?.mimeType || "application/octet-stream";
    res.set("Content-Type", mimeType);
    res.set("Cache-Control", "public, max-age=31536000");
    res.send(fileBuffer);
  } catch (err) {
    console.error("[files] Error serving file:", err);
    res.status(500).json({ error: "Failed to serve file" });
  }
});

// Favicon config endpoint
app.get("/files/favicon", async (req, res) => {
  try {
    const { getFavicon } = await import("./persistent/files.ts");
    const favicon = await getFavicon();
    res.json(favicon || { category: "concord", name: "concord.png" });
  } catch {
    res.json({ category: "concord", name: "concord.png" });
  }
});

// Optional: simple broadcast endpoint for testing
app.post("/broadcast", (req, res) => {
  const body = req.body as { packet?: SerializedPacket | string };
  const { packet } = body;
  if (!packet) return res.status(400).json({ error: "Missing packet" });

  const normalizedPacket = typeof packet === "string" ? Packet.fromJson(packet).serialize() : packet;
  broadcast(normalizedPacket);
  return res.json({ success: true, packet });
});

// --- Create HTTP server for both Express and WebSocket ---
const server = http.createServer(app);

// --- Attach RuneLite WebSocket server ---
attachToServer(server);

// --- Start services and listen ---
/**
 * Bootstraps storage, restores state, initializes the ROOT session, and starts the HTTP/WebSocket server.
 * @returns A promise that resolves after the server has been started and the listeners are active.
 */
async function start(): Promise<void> {
  await initStorage();
  await initDatabase();
  await initializeRoot();
  await initFiles();
  await initLimits();
  await initDiscord();

  // Load runtime config from cache
  await updateSessionTTL();
  await updateUploadSizeLimit();

  const port = process.env.API_PORT || '8080';
  server.listen(port, () => {
    console.log(`${colors.green}[server]${colors.reset} Concord is running!`);
  });
}

start();

// Graceful shutdown - closes all connections for fast container stops
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`${colors.yellow}[server]${colors.reset} Received ${signal}, shutting down gracefully...`);

  try {
    // Stop accepting new connections
    server.close(() => {
      console.log(`${colors.green}[server]${colors.reset} HTTP server closed`);
    });

    // Close WebSocket server and all clients
    await closeWebSocketServer();

    // Close Discord connections
    const { stopDiscord } = await import('./discord.ts');
    await stopDiscord();

    // Close Redis connection
    if (client && client.isOpen) {
      console.log(`${colors.cyan}[server]${colors.reset} Closing Redis...`);
      await client.quit();
      console.log(`${colors.green}[server]${colors.reset} Redis connection closed`);
    }

    console.log(`${colors.green}[server]${colors.reset} Graceful shutdown complete`);
    process.exit(0);
  } catch (err) {
    console.error(`${colors.red}[server]${colors.reset} Shutdown error:`, err);
    process.exit(1);
  }
}

// Nodemon sends SIGINT to the Node process
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error(`${colors.red}[server]${colors.reset} Uncaught exception:`, err);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error(`${colors.red}[server]${colors.reset} Unhandled rejection:`, reason);
});
