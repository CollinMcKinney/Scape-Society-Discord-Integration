import { EventEmitter } from "node:events";

import "dotenv/config";
import { v4 as uuidv4 } from "uuid";

import * as cache from "./cache.ts";
import { getRootCredentials } from "./user.ts";

/**
 * Primitive JSON values allowed inside packet payloads and metadata.
 */
type PacketPrimitive = string | number | boolean | null;

/**
 * Event emitter used to fan out packet lifecycle updates across services.
 */
const packetEvents = new EventEmitter();

/**
 * Gets the ROOT user ID from credentials storage.
 */
function getRootId(): string | null {
  return getRootCredentials()?.userId ?? null;
}

/**
 * Identity details describing the actor that originated a packet.
 */
interface ActorInfo {
  id: string | null;
  name: string;
  roles: number[];
  permissions: string[];
}

/**
 * Authentication context attached to a packet when a session is available.
 */
interface AuthData {
  userId: string | null;
  sessionToken: string | null;
}

/**
 * Extensible packet payload map.
 */
interface PacketData extends PacketObject {
  body?: string;
}

/**
 * Serialized wire/storage representation of a packet.
 */
interface SerializedPacket {
  version: number;
  type: string;
  id: string;
  origin: string;
  timestamp: number;
  actor: ActorInfo;
  auth: AuthData;
  data: PacketData;
  meta: PacketObject;
  deleted: boolean;
  editedContent: string | null;
}

interface PacketInit {
  version?: number;
  type?: string;
  id?: string;
  origin?: string;
  timestamp?: number;
  actor?: Partial<ActorInfo> | null;
  auth?: Partial<AuthData> | null;
  data?: PacketData;
  meta?: PacketObject;
  deleted?: boolean;
  editedContent?: string | null;
}

/**
 * Normalizes partial actor data into the full actor shape stored on packets.
 * @param actor - Partial actor fields supplied at packet construction time.
 * @returns A fully populated actor object with safe defaults.
 */
function normalizeActorInfo(actor?: Partial<ActorInfo> | null): ActorInfo {
  return {
    id: actor?.id || null,
    name: actor?.name || "Unknown",
    roles: actor?.roles || [],
    permissions: actor?.permissions || [],
  };
}

/**
 * Normalizes partial auth data into the full auth shape stored on packets.
 * @param authData - Partial auth fields supplied at packet construction time.
 * @returns A fully populated auth object with safe defaults.
 */
function normalizeAuthData(authData?: Partial<AuthData> | null): AuthData {
  return {
    userId: authData?.userId || null,
    sessionToken: authData?.sessionToken || null,
  };
}

/**
 * Mutable packet model used for transport, storage, and broadcast workflows.
 */
class Packet {
  version: number;
  type: string;
  id: string;
  origin: string;
  timestamp: number;
  actor: ActorInfo;
  auth: AuthData;
  data: PacketData;
  meta: PacketObject;
  deleted: boolean;
  editedContent: string | null;

  constructor({
    version = 1,
    type = "chat.message",
    id = uuidv4(),
    origin = "server",
    timestamp = Date.now(),
    actor,
    auth: authData,
    data = {},
    meta = {},
    deleted = false,
    editedContent = null,
  }: PacketInit = {}) {
    this.version = version;
    this.type = type;
    this.id = id;
    this.origin = origin;
    this.timestamp = timestamp;
    this.actor = normalizeActorInfo(actor);
    this.auth = normalizeAuthData(authData);
    this.data = data || {};
    this.meta = meta || {};
    this.deleted = deleted;
    this.editedContent = editedContent;
  }

  markDeleted(): void {
    this.deleted = true;
  }

  edit(newContent: string): void {
    this.editedContent = newContent;
    this.data.body = newContent;
  }

  serialize(): SerializedPacket {
    return {
      version: this.version,
      type: this.type,
      id: this.id,
      origin: this.origin,
      timestamp: this.timestamp,
      actor: this.actor,
      auth: this.auth,
      data: this.data,
      meta: this.meta,
      deleted: this.deleted,
      editedContent: this.editedContent,
    };
  }

  async save(): Promise<void> {
    await cache.set(`packet:${this.id}`, this.serialize());
    await cache.zAdd("packets", { score: this.timestamp, value: this.id });
  }

  /**
   * Loads and rehydrates a packet from persistent storage.
   * @param id - The unique packet id to load.
   * @returns The rehydrated packet instance, or null when the packet is missing.
   */
  static async load(id: string): Promise<Packet | null> {
    const data = await cache.get<SerializedPacket>(`packet:${id}`);
    if (!data) return null;
    return Packet.fromJson(data);
  }

  /**
   * Rehydrates a packet from a JSON string or already-parsed object.
   * @param jsonInput - Either a raw JSON packet payload or an already parsed serialized packet object.
   */
  static fromJson(jsonInput: string | SerializedPacket): Packet {
    const parsed = typeof jsonInput === "string" ? (JSON.parse(jsonInput) as SerializedPacket) : jsonInput;
    return new Packet(parsed);
  }
}

/**
 * Creates a chat packet with the provided actor and payload details.
 * @param actorId - The actor id to attach to the packet, or null for an anonymous/system actor.
 * @param body - The message body to place in `data.body`.
 * @param actorDetails - Optional actor fields used to enrich the packet's display identity.
 * @param origin - The source system name used to mark where the packet came from.
 * @param data - Additional structured packet payload fields to merge alongside the message body.
 * @param meta - Extra metadata stored separately from the user-facing packet payload.
 */
async function createPacket(
  actorId: string | null,
  body: string,
  actorDetails?: Partial<ActorInfo>,
  origin = "server",
  data: PacketData = {},
  meta: PacketObject = {}
): Promise<Packet> {
  return new Packet({
    type: "chat.message",
    origin,
    actor: {
      id: actorId || null,
      name: actorDetails?.name || "Unknown",
      roles: actorDetails?.roles || [],
      permissions: actorDetails?.permissions || [],
    },
    data: {
      body: body || "",
      ...data,
    },
    meta,
  });
}

/**
 * Routes a packet through origin-specific validation and persistence logic.
 * @param packet - The packet instance to validate and save.
 */
async function addPacket(packet: Packet): Promise<boolean> {
  if (!packet || !(packet instanceof Packet)) return false;

  const trustedOrigin = packet.origin === "admin" || packet.origin === "discord" || packet.origin === "server";
  const actorId = trustedOrigin ? packet.actor.id || getRootId() || null : packet.actor.id || null;
  return persistPacket(packet, actorId);
}

/**
 * Persists a packet, optionally overriding the stored actor identifier first.
 * @param packet - The packet instance to save and emit through packet events.
 * @param actorId - The actor id that should be persisted on the packet before saving.
 */
async function persistPacket(packet: Packet, actorId: string | null = packet.actor.id || null): Promise<boolean> {
  packet.actor.id = actorId;
  if (packet.auth.userId == null && actorId != null) {
    packet.auth.userId = actorId;
  }
  await packet.save();
  packetEvents.emit("packetAdded", packet);
  return true;
}

/**
 * Loads recent packets from the datastore in newest-first order.
 * @param limit - The maximum number of most-recent packets to return.
 */
async function getPackets(limit = 50): Promise<SerializedPacket[]> {
  const packetIds = await cache.zRange("packets", 0, -1);
  const limitedIds = packetIds.slice(-limit);

  const packets: SerializedPacket[] = [];
  for (const packetId of limitedIds) {
    const packetData = await cache.get<SerializedPacket>(`packet:${packetId}`);
    if (packetData && !packetData.deleted) {
      packets.push(packetData);
    }
  }

  return packets.reverse();
}

/**
 * Marks a stored packet as deleted.
 * @param packetId - The unique packet id to mark as deleted.
 */
async function deletePacket(packetId: string): Promise<boolean> {
  const packetData = await cache.get<SerializedPacket>(`packet:${packetId}`);
  if (!packetData) return false;

  // Remove from packet storage
  await cache.del(`packet:${packetId}`);
  
  // Remove from sorted set
  await cache.zRem("packets", packetId);

  packetEvents.emit("packetDeleted", packetId);
  return true;
}

/**
 * Replaces the message body of an existing packet and persists the edit.
 * @param packetId - The unique packet id to edit.
 * @param newContent - The replacement message body to store on the packet.
 */
async function editPacket(packetId: string, newContent: string): Promise<boolean> {
  const packet = await Packet.load(packetId);
  if (!packet) return false;

  packet.edit(newContent);
  await packet.save();

  packetEvents.emit("packetEdited", packetId);
  return true;
}

export {
  Packet,
  packetEvents,
  createPacket,
  addPacket,
  persistPacket,
  getPackets,
  deletePacket,
  editPacket,
  type ActorInfo,
  type AuthData,
  type PacketData,
  type SerializedPacket,
  type PacketObject,
  type PacketValue
};
