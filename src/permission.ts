import * as cache from "./cache.ts";

/**
 * Numeric role hierarchy used for authorization checks throughout the service.
 */
const Roles = Object.freeze({
  BLOCKED: 0,
  GUEST: 1,
  MEMBER: 2,
  MODERATOR: 3,
  ADMIN: 4,
  OWNER: 5,
  ROOT: 6
} as const);

/**
 * Union of all valid role values.
 */
type RoleType = typeof Roles[keyof typeof Roles];

/**
 * Mutable runtime configuration persisted for admin-controlled settings.
 */
interface RuntimeConfig {
  suppressedPrefixes?: string[];
  commandRoleRequirements?: Partial<Record<string, RoleType | null>>;
}

/**
 * Expanded command-role response returned to the admin UI for display.
 */
interface CommandRoleRequirementDetails {
  roleValue: RoleType | null;
  roleName: string;
  defaultRoleValue: RoleType | null;
  defaultRoleName: string;
  overridden: boolean;
}

/**
 * Key used to store runtime configuration in the datastore.
 */
const CONFIG_KEY = "config:runtime";

/**
 * Default suppressed strings for message filtering.
 * Messages containing any of these strings will not be broadcasted.
 */
const DEFAULT_SUPPRESSED_PREFIXES: string[] = [
  "To talk in your clan's channel, start each line of chat with // or /c.",
];

/**
 * Default role requirements for various commands.
 * Maps command names to required role levels or null for open access.
 */
const DEFAULT_COMMAND_ROLE_REQUIREMENTS: Record<string, RoleType | null> = Object.freeze({
  authenticate: null,
  verifySession: null,
  saveState: Roles.ROOT,
  loadState: Roles.ROOT,
  addPacket: Roles.ADMIN,
  getPackets: Roles.MODERATOR,
  deletePacket: Roles.MODERATOR,
  editPacket: Roles.MODERATOR,
  setEnvVar: Roles.ROOT,
  createUser: Roles.ADMIN,
  listUsers: Roles.MODERATOR,
  getUser: Roles.MODERATOR,
  setRole: Roles.ADMIN,
  getSuppressedPrefixes: null,
  setSuppressedPrefixes: Roles.ADMIN,
  getCommandRoleRequirements: null,
  setCommandRoleRequirement: Roles.ROOT,
  listFiles: Roles.MODERATOR,
  uploadFile: Roles.ADMIN,
  deleteFile: Roles.ADMIN,
  getCategories: null,
  createCategory: Roles.ADMIN,
  deleteCategory: Roles.ROOT,
  getAllowedMimeTypes: null,
  setAllowedMimeTypes: Roles.ROOT,
  // Discord
  getDiscordStatus: Roles.MODERATOR,
  updateDiscordConfig: Roles.ROOT,
  startDiscord: Roles.ROOT,
  stopDiscord: Roles.ROOT,
  // Limits (rate limiting, session TTL, etc.)
  getAllLimits: Roles.MODERATOR,
  updateLimits: Roles.ROOT,
});

/**
 * Retrieves the current runtime configuration from the datastore.
 * @returns A promise that resolves to the current mutable runtime config snapshot.
 */
async function getRuntimeConfig(): Promise<RuntimeConfig> {
  return (await cache.get(CONFIG_KEY)) || {};
}

/**
 * Saves the runtime configuration to the datastore.
 * @param config - The runtime config object to persist as the new active settings state.
 * @returns A promise that resolves to the saved configuration.
 */
async function saveRuntimeConfig(config: RuntimeConfig): Promise<RuntimeConfig> {
  await cache.set(CONFIG_KEY, config);
  return config;
}

/**
 * Normalizes an array of suppressed prefixes by trimming, filtering empty values, and removing duplicates.
 * @param prefixes - The array of prefixes to normalize.
 * @returns An array of normalized, unique prefixes.
 * @throws Error if the input is not an array.
 */
function normalizeSuppressedPrefixes(prefixes: readonly unknown[]): string[] {
  if (!Array.isArray(prefixes)) {
    throw new Error("Suppressed prefixes must be an array");
  }

  const normalized = prefixes
    .map(prefix => prefix == null ? "" : String(prefix).trim())
    .filter(Boolean);

  return [...new Set(normalized)];
}

/**
 * Parses a role requirement value into a valid RoleType or null.
 * Accepts numbers, strings, or null/empty values.
 * @param role - The role value to parse.
 * @returns The parsed RoleType or null for open access.
 * @throws Error if the role value is invalid.
 */
function parseRoleRequirement(role: unknown): RoleType | null {
  if (role == null || role === "") {
    return null;
  }

  if (typeof role === "number" && Object.values(Roles).includes(role as RoleType)) {
    return role as RoleType;
  }

  if (typeof role === "string") {
    const upper = role.trim().toUpperCase();
    if (upper === "NONE" || upper === "OPEN" || upper === "NULL") {
      return null;
    }

    const namedRole = upper as keyof typeof Roles;
    if (namedRole in Roles) {
      return Roles[namedRole];
    }
  }

  throw new Error("Invalid role requirement");
}

/**
 * Converts a RoleType value to its string name.
 * @param roleValue - The role value to convert.
 * @returns The role name string, or the numeric value as string if not found.
 */
function roleRequirementToName(roleValue: RoleType | null): string {
  if (roleValue == null) {
    return "OPEN";
  }

  return Object.entries(Roles).find(([, value]) => value === roleValue)?.[0] || String(roleValue);
}

/**
 * Retrieves the current list of suppressed strings.
 * Falls back to default strings if none are configured.
 * @returns A promise that resolves to an array of suppressed strings.
 */
async function getSuppressedPrefixes(): Promise<string[]> {
  const config = await getRuntimeConfig();
  const stored = Array.isArray(config.suppressedPrefixes) ? config.suppressedPrefixes : null;
  return stored || [...DEFAULT_SUPPRESSED_PREFIXES];
}

/**
 * Sets the list of suppressed strings after normalization.
 * @param prefixes - The raw list of strings supplied by an admin before trimming and deduplication.
 * @returns A promise that resolves to the normalized strings.
 */
async function setSuppressedPrefixes(prefixes: string[]): Promise<string[]> {
  const config = await getRuntimeConfig();
  config.suppressedPrefixes = normalizeSuppressedPrefixes(prefixes);
  await saveRuntimeConfig(config);
  return config.suppressedPrefixes;
}

/**
 * Retrieves the current command role requirements, merging defaults with overrides.
 * @returns A promise that resolves to an object mapping command names to role requirement details.
 */
async function getCommandRoleRequirements(): Promise<Record<string, CommandRoleRequirementDetails>> {
  const config = await getRuntimeConfig();
  const overrides = config.commandRoleRequirements || {};

  return Object.fromEntries(
    Object.entries(DEFAULT_COMMAND_ROLE_REQUIREMENTS).map(([commandName, defaultRole]) => {
      const hasOverride = Object.prototype.hasOwnProperty.call(overrides, commandName);
      const effectiveRole: RoleType | null = hasOverride
        ? overrides[commandName] ?? null
        : defaultRole;

      return [
        commandName,
        {
          roleValue: effectiveRole,
          roleName: roleRequirementToName(effectiveRole),
          defaultRoleValue: defaultRole,
          defaultRoleName: roleRequirementToName(defaultRole),
          overridden: hasOverride,
        },
      ];
    })
  );
}

/**
 * Gets the required role for a specific command, checking overrides first then defaults.
 * @param commandName - The admin command identifier whose effective minimum role should be resolved.
 * @returns A promise that resolves to the required RoleType or null for open access.
 */
async function getRequiredRoleForCommand(commandName: string): Promise<RoleType | null> {
  const config = await getRuntimeConfig();
  const overrides = config.commandRoleRequirements || {};

  if (Object.prototype.hasOwnProperty.call(overrides, commandName)) {
    return overrides[commandName] ?? null;
  }

  return DEFAULT_COMMAND_ROLE_REQUIREMENTS[commandName] ?? null;
}

/**
 * Sets the role requirement for a specific command.
 * @param commandName - The admin command identifier whose access rule should be overridden.
 * @param role - The new role requirement expressed as a role name, numeric role, or null/open marker.
 * @returns A promise that resolves to an object with the updated role details.
 * @throws Error if commandName is invalid or unknown.
 */
async function setCommandRoleRequirement(
  commandName: string,
  role: string | number | null
): Promise<Pick<CommandRoleRequirementDetails, "roleName" | "roleValue"> & { commandName: string }> {
  if (!commandName || typeof commandName !== "string") {
    throw new Error("Command name is required");
  }

  if (!Object.prototype.hasOwnProperty.call(DEFAULT_COMMAND_ROLE_REQUIREMENTS, commandName)) {
    throw new Error("Unknown command");
  }

  const config = await getRuntimeConfig();
  const overrides = config.commandRoleRequirements || {};
  overrides[commandName] = parseRoleRequirement(role);
  config.commandRoleRequirements = overrides;
  await saveRuntimeConfig(config);

  return {
    commandName,
    roleValue: overrides[commandName] ?? null,
    roleName: roleRequirementToName(overrides[commandName] ?? null),
  };
}

export {
  Roles,
  getRuntimeConfig,
  saveRuntimeConfig,
  getSuppressedPrefixes,
  setSuppressedPrefixes,
  getCommandRoleRequirements,
  getRequiredRoleForCommand,
  setCommandRoleRequirement,
  DEFAULT_COMMAND_ROLE_REQUIREMENTS,
  type RoleType,
  type RuntimeConfig,
  type CommandRoleRequirementDetails
};
