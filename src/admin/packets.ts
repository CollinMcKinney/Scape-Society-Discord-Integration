import * as packets from "../packet.ts";
import type { ActorInfo, PacketData, PacketObject, SerializedPacket } from "../packet.ts";
import { broadcastSuppressedPrefixesUpdate } from "../runelite.ts";
import * as permission from "../permission.ts";
import type { CommandRoleRequirementDetails } from "../permission.ts";
import * as cache from "../cache.ts";
import type { UserData } from "../user.ts";

/**
 * Builds the admin-origin packet used by the `addPacket` command.
 */
async function buildAdminPacket(
  actorSessionToken: string,
  body: string,
  actorDetails: Partial<ActorInfo>,
  origin: string,
  data: PacketData,
  meta: PacketObject
): Promise<packets.Packet> {
  return new packets.Packet({
    type: "chat.message",
    origin,
    actor: {
      id: null,
      name: await resolveActorName(null, actorDetails),
      roles: actorDetails.roles || [],
      permissions: actorDetails.permissions || [],
    },
    auth: {
      userId: null,
      sessionToken: actorSessionToken,
    },
    data: {
      body,
      ...data,
    },
    meta,
  });
}

/**
 * Resolves the best display name for the actor attached to an admin-created packet.
 */
async function resolveActorName(actorId: string | null, actorDetails: Partial<ActorInfo>): Promise<string> {
  if (actorDetails.name) {
    return actorDetails.name;
  }

  const actorUser = actorId ? await cache.get<UserData>(`user:${actorId}`) : null;
  return actorUser?.osrs_name || actorUser?.disc_name || actorUser?.forum_name || "Unknown";
}

/**
 * Creates and persists a chat packet through the admin API.
 */
export async function addPacket(
  requireAuth: () => Promise<void>,
  actorSessionToken: string,
  body: string,
  actorDetails: Partial<ActorInfo> = {},
  origin = "admin",
  data: PacketData = {},
  meta: PacketObject = {}
): Promise<boolean> {
  await requireAuth();
  const packet = await buildAdminPacket(actorSessionToken, body, actorDetails, origin, data, meta);

  console.log(
    `[admin.addPacket] ${new Date().toISOString()} packetId=${packet.id} origin=${packet.origin} body=${JSON.stringify(
      packet.data.body
    )}`
  );
  return packets.addPacket(packet);
}

/**
 * Returns recent packets for an authorized admin actor.
 */
export async function getPackets(
  requireAuth: () => Promise<void>,
  limit = 50
): Promise<SerializedPacket[]> {
  await requireAuth();
  return packets.getPackets(limit);
}

/**
 * Marks a packet as deleted through the admin API.
 */
export async function deletePacket(
  requireAuth: () => Promise<void>,
  packetId: string
): Promise<boolean> {
  await requireAuth();
  return packets.deletePacket(packetId);
}

/**
 * Updates an existing packet's content through the admin API.
 */
export async function editPacket(
  requireAuth: () => Promise<void>,
  packetId: string,
  newContent: string
): Promise<boolean> {
  await requireAuth();
  return packets.editPacket(packetId, newContent);
}

/**
 * Returns the configured RuneLite message suppression prefixes.
 */
export async function getSuppressedPrefixes(
  requireAuth: () => Promise<void>
): Promise<string[]> {
  await requireAuth();
  return permission.getSuppressedPrefixes();
}

/**
 * Replaces the configured RuneLite message suppression prefixes.
 */
export async function setSuppressedPrefixes(
  requireAuth: () => Promise<void>,
  prefixes: string[]
): Promise<string[]> {
  await requireAuth();
  const updatedPrefixes = await permission.setSuppressedPrefixes(prefixes);
  broadcastSuppressedPrefixesUpdate(updatedPrefixes);
  return updatedPrefixes;
}

/**
 * Returns the effective role requirement for each admin command.
 */
export async function getCommandRoleRequirements(
  requireAuth: () => Promise<void>
): Promise<Record<string, CommandRoleRequirementDetails>> {
  await requireAuth();
  return permission.getCommandRoleRequirements();
}

/**
 * Overrides the configured role requirement for a specific admin command.
 */
export async function setCommandRoleRequirement(
  requireAuth: () => Promise<void>,
  commandName: string,
  role: string | number | null
): Promise<{ commandName: string; roleValue: import("../permission.ts").RoleType | null; roleName: string }> {
  await requireAuth();
  return permission.setCommandRoleRequirement(commandName, role);
}
