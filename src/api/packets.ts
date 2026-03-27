import * as packets from "../packet.ts";
import type { ActorInfo, PacketData, PacketObject, SerializedPacket } from "../packet.ts";
import { broadcastSuppressedPrefixesUpdate } from "../runelite.ts";
import * as permission from "../permission.ts";
import type { CommandRoleRequirementDetails } from "../permission.ts";

/**
 * Returns the configured RuneLite message suppression prefixes.
 */
export async function getSuppressedPrefixes(
  actorSessionToken: string
): Promise<string[]> {
  return permission.getSuppressedPrefixes();
}

/**
 * Replaces the configured RuneLite message suppression prefixes.
 */
export async function setSuppressedPrefixes(
  actorSessionToken: string,
  prefixes: string[]
): Promise<string[]> {
  const updatedPrefixes = await permission.setSuppressedPrefixes(prefixes);
  broadcastSuppressedPrefixesUpdate(updatedPrefixes);
  return updatedPrefixes;
}

/**
 * Returns the effective role requirement for each admin command.
 */
export async function getCommandRoleRequirements(
  actorSessionToken: string
): Promise<Record<string, CommandRoleRequirementDetails>> {
  return permission.getCommandRoleRequirements();
}

/**
 * Overrides the configured role requirement for a specific admin command.
 */
export async function setCommandRoleRequirement(
  actorSessionToken: string,
  commandName: string,
  role: string | number | null
): Promise<{ commandName: string; roleValue: import("../permission.ts").RoleType | null; roleName: string }> {
  return permission.setCommandRoleRequirement(commandName, role);
}

/**
 * Creates and persists a chat packet through the API.
 */
export async function addPacket(
  actorSessionToken: string,
  body: string,
  actorDetails: Partial<ActorInfo> = {},
  origin = "Concord",
  data: PacketData = {},
  meta: PacketObject = {}
): Promise<boolean> {
  const packet = new packets.Packet({
    type: "chat.message",
    origin,
    actor: {
      id: null,
      name: actorDetails.name || "Concord",
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

  console.log(
    `[api.addPacket] ${new Date().toISOString()} packetId=${packet.id} origin=${packet.origin} body=${JSON.stringify(
      packet.data.body
    )}`
  );
  return packets.addPacket(packet);
}

/**
 * Returns recent packets for an authorized admin actor.
 */
export async function getPackets(
  actorSessionToken: string,
  limit = 50
): Promise<SerializedPacket[]> {
  return packets.getPackets(limit);
}

/**
 * Marks a packet as deleted through the admin API.
 */
export async function deletePacket(
  actorSessionToken: string,
  packetId: string
): Promise<boolean> {
  return packets.deletePacket(packetId);
}

/**
 * Updates an existing packet's content through the admin API.
 */
export async function editPacket(
  actorSessionToken: string,
  packetId: string,
  newContent: string
): Promise<boolean> {
  return packets.editPacket(packetId, newContent);
}
