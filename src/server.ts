import dotenv from "dotenv";
dotenv.config();

import express, { Express } from "express";
import bodyParser from "body-parser";
import path from "path";
import http from "http";
import { initStorage, saveState, loadState, startAutoSaveDynamic } from "./cache";
import { initializeRoot } from "./user";
import { attachToServer, broadcast } from "./runelite";
import adminRouter from "./admin";
import filesRouter from "./filesRouter";
import { initFiles } from "./files";
import { initRateLimiter } from "./rateLimiter";
import "./discord"; // auto-start Discord integrations
import { Packet, type SerializedPacket } from "./packet";

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
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

// Serve static files from public folder (but not index.html - that's handled by /admin route)
app.use(express.static(path.join(__dirname, "public"), { index: false }));

// Example admin route to broadcast a message to all RuneLite clients
app.use("/admin", adminRouter);
app.use("/files", filesRouter);
app.use("/modals", express.static(path.join(__dirname, "public", "modals")));

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
  await loadState();
  await initializeRoot();
  await initFiles(); // Load files from disk into cache
  await initRateLimiter(); // Initialize rate limiter
  startAutoSaveDynamic();
  await saveState();

  server.listen(process.env.API_PORT, () => {
    console.log(`${colors.green}[server]${colors.reset} Concord is Running: `
      + `${colors.magenta}http://localhost:${process.env.API_PORT}${colors.reset}`);
  });
}

start();
