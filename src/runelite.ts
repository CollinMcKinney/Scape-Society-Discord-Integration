import WebSocket, { Server as WebSocketServer } from "ws";
import http from "http";
import { Packet, persistPacket } from "./packet";
import { createGuestSession, updateUserOsrsName } from "./user";
import * as permission from "./permission";
import * as auth from "./auth";
import type { PacketValue, SerializedPacket } from "./packet";

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

/**
 * Extended WebSocket interface with additional properties for client authentication and initialization.
 */
interface ExtendedWebSocket extends WebSocket {
  /** Authentication details for the client session. */
  clientAuth?: { userId: string; sessionToken: string };
  /** Whether the client has been initialized with a session. */
  initialized?: boolean;
  /** Timer for delayed guest session initialization. */
  guestInitTimer?: NodeJS.Timeout;
}

/**
 * Set of active WebSocket clients.
 */
const clients = new Set<ExtendedWebSocket>();

/**
 * Delay in milliseconds before initializing a guest session for new connections.
 */
const GUEST_INIT_DELAY_MS = 500;
const RUNELITE_DEDUPE_WINDOW_MS = 1500;
const recentRuneliteFingerprints = new Map<string, number>();

/**
 * Reads a string value out of a packet payload field when the runtime value is string-like.
 * @param value - The packet payload value to inspect.
 * @returns The string value when present, otherwise undefined.
 */
function getPacketString(value: PacketValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Verifies, normalizes, and persists a packet originating from a RuneLite client.
 * @param packet - The incoming RuneLite packet after it has been parsed from the WebSocket payload.
 */
async function handleIncomingPacket(packet: Packet): Promise<boolean> {
  const verifiedUserId = await verifyRunelitePacketAuth(packet);
  if (!verifiedUserId) {
    return false;
  }

  await syncRuneliteProfile(packet, verifiedUserId);

  if (packet.type === "auth.profileSync") {
    return true;
  }

  if (await isSuppressedRuneliteMessage(packet)) {
    return true;
  }

  const fingerprint = buildRuneliteFingerprint(packet);
  const now = Date.now();
  const previousSeenAt = recentRuneliteFingerprints.get(fingerprint);

  if (previousSeenAt && (now - previousSeenAt) < RUNELITE_DEDUPE_WINDOW_MS) {
    return true;
  }

  recentRuneliteFingerprints.set(fingerprint, now);
  return persistPacket(packet, verifiedUserId);
}

/**
 * Attaches a WebSocket server to the provided HTTP server and sets up event handlers.
 * Handles RuneLite client connections, messages, and disconnections.
 * @param httpServer - The HTTP server to attach the WebSocket server to.
 * @returns The created WebSocket server instance.
 */
function attachToServer(httpServer: http.Server): WebSocketServer {
  const webSocketServer = new WebSocketServer({ server: httpServer });

  webSocketServer.on("connection", async (webSocket: ExtendedWebSocket, req: http.IncomingMessage) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`${colors.green}[runelite]${colors.reset} Client connected from ${colors.cyan}${clientIp}${colors.reset}`);
    clients.add(webSocket);
    webSocket.clientAuth = undefined;
    webSocket.initialized = false;
    webSocket.guestInitTimer = setTimeout(() => {
      initializeGuestSession(webSocket, clientIp as string).catch(err => {
        console.error(`${colors.red}[runelite]${colors.reset} Failed to initialize guest session for ${clientIp}:`, err);
        webSocket.close();
      });
    }, GUEST_INIT_DELAY_MS);

    webSocket.on("message", async (rawPacket: Buffer | string) => {
      try {
        const rawJson = typeof rawPacket === "string" ? rawPacket : rawPacket.toString("utf8");
        const packet = Packet.fromJson(rawJson);

        if (!webSocket.initialized && packet.type === "auth.resume") {
          const resumed = await tryResumeGuestSession(webSocket, clientIp as string, packet);
          if (!resumed) {
            await initializeGuestSession(webSocket, clientIp as string);
          }
          return;
        }

        const success = await handleIncomingPacket(packet);
        if (!success) {
          console.warn(`${colors.yellow}[runelite]${colors.reset} Failed to add packet:`, packet.serialize());
          return;
        }

        if (packet.type === "auth.profileSync") {
          console.log(
            `${colors.cyan}[runelite]${colors.reset} Updated guest profile for ${colors.cyan}${packet.actor.name || packet.data.osrsName || "Unknown"}${colors.reset}`
          );
        } else {
          console.log(`${colors.cyan}[runelite]${colors.reset} Received packet from ${colors.cyan}${packet.actor.name}${colors.reset}: "${colors.yellow}${packet.data.body || ""}${colors.reset}"`);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown WebSocket error";
        console.error(`${colors.red}[runelite]${colors.reset} WS error processing packet:`, err);
        webSocket.send(JSON.stringify({ error: message }));
      }
    });

    webSocket.on("close", () => {
      console.log(`${colors.green}[runelite]${colors.reset} Client disconnected: ${colors.cyan}${clientIp}${colors.reset}`);
      clearGuestInitTimer(webSocket);
      clients.delete(webSocket);
    });

    webSocket.on("error", (err: Error) => {
      console.error(`${colors.red}[runelite]${colors.reset} WS error from ${clientIp}:`, err);
    });
  });

  return webSocketServer;
}

/**
 * Clears the guest initialization timer for a WebSocket client.
 * @param webSocket - The WebSocket client.
 */
function clearGuestInitTimer(webSocket: ExtendedWebSocket): void {
  if (webSocket.guestInitTimer) {
    clearTimeout(webSocket.guestInitTimer);
    webSocket.guestInitTimer = undefined;
  }
}

/**
 * Initializes a guest session for a WebSocket client.
 * Creates a new guest user and session, then sends the authentication packet.
 * @param webSocket - The WebSocket client to initialize.
 * @param clientIp - The IP address of the client.
 */
async function initializeGuestSession(webSocket: ExtendedWebSocket, clientIp: string): Promise<void> {
  if (webSocket.initialized || webSocket.readyState !== WebSocket.OPEN) {
    return;
  }

  clearGuestInitTimer(webSocket);

  const guestSession = await createGuestSession();
  webSocket.clientAuth = {
    userId: guestSession.user.id,
    sessionToken: guestSession.sessionToken,
  };
  webSocket.initialized = true;

  await sendGuestIssuedPacket(webSocket, guestSession.user.id, guestSession.sessionToken);
  console.log(`${colors.green}[runelite]${colors.reset} Issued guest session for ${colors.cyan}${clientIp}${colors.reset}: ${colors.yellow}${guestSession.user.id}${colors.reset}`);
}

/**
 * Attempts to resume a guest session using authentication data from a packet.
 * Verifies the session token and updates user information if valid.
 * @param webSocket - The WebSocket client.
 * @param clientIp - The IP address of the client.
 * @param packet - The authentication packet containing session data.
 * @returns True if the session was successfully resumed, false otherwise.
 */
async function tryResumeGuestSession(webSocket: ExtendedWebSocket, clientIp: string, packet: Packet): Promise<boolean> {
  const userId = packet.auth?.userId || getPacketString(packet.data?.userId);
  const sessionToken = packet.auth?.sessionToken || getPacketString(packet.data?.sessionToken);
  if (!userId || !sessionToken) {
    return false;
  }

  const verifiedUserId = await auth.verifySession(sessionToken);
  if (!verifiedUserId) {
    console.warn(`${colors.yellow}[runelite]${colors.reset} Failed to resume guest session for ${clientIp}: invalid session`);
    return false;
  }

  const osrsName = getPacketString(packet.data?.osrsName) || packet.actor?.name;
  if (osrsName) {
    await updateUserOsrsName(verifiedUserId, osrsName);
  }

  clearGuestInitTimer(webSocket);
  webSocket.clientAuth = {
    userId: verifiedUserId,
    sessionToken,
  };
  webSocket.initialized = true;

  await sendGuestIssuedPacket(webSocket, verifiedUserId, sessionToken);
  console.log(`${colors.green}[runelite]${colors.reset} Resumed guest session for ${colors.cyan}${clientIp}${colors.reset}: ${colors.yellow}${verifiedUserId}${colors.reset}`);
  return true;
}

/**
 * Sends an authentication packet to a client with their session details and configuration.
 * @param webSocket - The WebSocket client to send the packet to.
 * @param userId - The user ID for the session.
 * @param sessionToken - The session token for authentication.
 */
async function sendGuestIssuedPacket(webSocket: ExtendedWebSocket, userId: string, sessionToken: string): Promise<void> {
  const suppressedPrefixes = await permission.getSuppressedPrefixes();
  const authPacket = new Packet({
    type: "auth.guestIssued",
    origin: "server",
    actor: {
      id: process.env.ROOT_USER_ID ?? null,
      name: "Concord",
      roles: [],
      permissions: [],
    },
    data: {
      userId,
      sessionToken,
      suppressedPrefixes,
      discordInviteUrl: process.env.DISCORD_INVITE_URL || "",
    },
  });

  webSocket.send(JSON.stringify(authPacket.serialize()));
}

/**
 * Broadcasts a serialized packet payload to every connected client.
 * @param packet - The packet instance or serialized packet payload to send to all connected RuneLite clients.
 */
function broadcast(packet: Packet | SerializedPacket): void {
  const payload = JSON.stringify(packet instanceof Packet ? packet.serialize() : packet);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

/**
 * Broadcasts an update to the suppressed prefixes configuration.
 * @param suppressedPrefixes - The latest suppression prefix list that clients should begin honoring.
 */
function broadcastSuppressedPrefixesUpdate(suppressedPrefixes: string[]): void {
  const packet = new Packet({
    type: "config.suppressedPrefixes",
    origin: "server",
    actor: {
      id: process.env.ROOT_USER_ID ?? null,
      name: "Concord",
      roles: [],
      permissions: [],
    },
    data: {
      suppressedPrefixes,
    },
  });

  broadcast(packet);
}

/**
 * Broadcasts an update to the Discord invite URL configuration.
 * @param discordInviteUrl - The current invite URL clients should surface in their UI.
 */
function broadcastDiscordInviteUrlUpdate(discordInviteUrl: string): void {
  const packet = new Packet({
    type: "config.discordInviteUrl",
    origin: "server",
    actor: {
      id: process.env.ROOT_USER_ID ?? null,
      name: "Concord",
      roles: [],
      permissions: [],
    },
    data: {
      discordInviteUrl: discordInviteUrl || "",
    },
  });

  broadcast(packet);
}

/**
 * Verifies RuneLite packet session credentials and returns the user id on success.
 * @param packet - The RuneLite packet carrying auth data that should be validated.
 * @returns The verified user id, or null when auth data is missing or invalid.
 */
async function verifyRunelitePacketAuth(packet: Packet): Promise<string | null> {
  const userId = packet.auth?.userId || packet.actor?.id;
  const sessionToken = packet.auth?.sessionToken;
  if (!userId || !sessionToken) {
    return null;
  }

  return auth.verifySession(sessionToken);
}

/**
 * Syncs the actor's RuneScape display name into the stored user profile.
 * @param packet - The RuneLite packet containing the latest actor/profile data.
 * @param userId - The verified user id whose stored profile should be updated.
 */
async function syncRuneliteProfile(packet: Packet, userId: string): Promise<void> {
  const actorName = packet.actor?.name;
  const osrsName = getPacketString(packet.data?.osrsName) || actorName;
  if (!osrsName) {
    return;
  }

  await updateUserOsrsName(userId, osrsName);
}

/**
 * Builds a short-lived deduplication fingerprint for RuneLite chat traffic.
 * @param packet - The RuneLite packet to fingerprint for short-term deduplication.
 * @returns A serialized fingerprint string derived from actor name and message body.
 */
function buildRuneliteFingerprint(packet: Packet): string {
  pruneRuneliteFingerprints();
  const actorName = packet.actor?.name || "Unknown";
  const body = packet.data?.body || "";
  return JSON.stringify({ actorName, body });
}

/**
 * Removes expired RuneLite deduplication fingerprints from memory.
 */
function pruneRuneliteFingerprints(): void {
  const cutoff = Date.now() - RUNELITE_DEDUPE_WINDOW_MS;
  for (const [fingerprint, seenAt] of recentRuneliteFingerprints.entries()) {
    if (seenAt < cutoff) {
      recentRuneliteFingerprints.delete(fingerprint);
    }
  }
}

/**
 * Checks whether a RuneLite chat packet should be suppressed from broadcast.
 * @param packet - The RuneLite packet whose message body should be checked against suppression rules.
 * @returns True when the message should be ignored, otherwise false.
 */
async function isSuppressedRuneliteMessage(packet: Packet): Promise<boolean> {
  const suppressedPrefixes = await permission.getSuppressedPrefixes();
  const body = getPacketString(packet.data?.body) || "";

  for (const prefix of suppressedPrefixes) {
    if (body.includes(prefix)) {
      return true;
    }
  }

  return false;
}

export {
  handleIncomingPacket,
  attachToServer,
  broadcast,
  broadcastSuppressedPrefixesUpdate,
  broadcastDiscordInviteUrlUpdate
};
