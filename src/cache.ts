import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient, type RedisClientType } from "redis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

// Type definitions
type RedisSetOptions = Parameters<RedisClientType["set"]>[2];
type RedisSetResult = Awaited<ReturnType<RedisClientType["set"]>>;
type BackupStringValue = Record<string, unknown>;
type BackupListValue = string[];
type BackupSetValue = string[];
type BackupZSetValue = Array<{ score: number; value: string }>;
type BackupHashValue = Record<string, string>;
type BackupEntry =
  | { type: "string"; value: BackupStringValue }
  | { type: "list"; value: BackupListValue }
  | { type: "set"; value: BackupSetValue }
  | { type: "zset"; value: BackupZSetValue }
  | { type: "hash"; value: BackupHashValue };

// =====================
// Config
// =====================
const BACKUP_DIR = path.join(__dirname, "../data");
const BACKUP_FILE = path.join(BACKUP_DIR, "backup.json");
const BACKUP_FILE_EXAMPLE = path.join(BACKUP_DIR, "backup.json.example");

// Track if cache has changed since last save
let cacheDirty = false;

function markCacheDirty(): void {
  cacheDirty = true;
}

// Auto-save configuration
const MIN_INTERVAL_MS = 5000;
const MAX_INTERVAL_MS = 5 * 60 * 1000;
const SIZE_THRESHOLD_MB = 50;

// Track auto-save timer for cleanup
let autoSaveTimerId: NodeJS.Timeout | null = null;

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// =====================
// Redis Client
// =====================
const redisHost = process.env.REDIS_HOST ?? 'redis';
const redisPort = parseInt(process.env.REDIS_PORT ?? '6379');

const client: RedisClientType = createClient({
  socket: {
    host: redisHost,
    port: redisPort
  }
});

client.on("error", (err: Error) => console.error(`${colors.red}[cache]${colors.reset} Redis Client Error:`, err));

/**
 * Connects the shared Redis client if it has not been opened yet.
 */
export async function initStorage(): Promise<void> {
  if (!client.isOpen) {
    await client.connect();
    console.log(`${colors.green}[cache]${colors.reset} Redis connected!`);
  }
}

// =====================
// Basic Redis Operations
// =====================
/**
 * Reads and deserializes a JSON value from Redis.
 * @param key - The Redis key to fetch and decode from JSON.
 */
async function get<T>(key: string): Promise<T | null> {
  const data = await client.get(key);
  return data ? (JSON.parse(data) as T) : null;
}

/**
 * Serializes and stores a JSON value in Redis.
 * @param key - The Redis key to write.
 * @param value - The JSON-serializable value to store under the key.
 * @param options - Optional Redis `SET` flags such as `NX` used to control write behavior.
 */
async function set<T>(key: string, value: T, options?: RedisSetOptions): Promise<RedisSetResult> {
  markCacheDirty();
  return client.set(key, JSON.stringify(value), options);
}

/**
 * Checks whether a Redis key exists.
 * @param key - The Redis key to test for existence.
 */
async function exists(key: string): Promise<number> {
  return client.exists(key);
}

/**
 * Adds a member to a Redis set.
 * @param key - The Redis set key to append to.
 * @param value - The member value to add to the set.
 */
async function sAdd(key: string, value: string): Promise<number> {
  markCacheDirty();
  return client.sAdd(key, value);
}

/**
 * Reads all members from a Redis set.
 * @param key - The Redis set key to read from.
 */
async function sMembers(key: string): Promise<string[]> {
  return client.sMembers(key);
}

/**
 * Removes a member from a Redis set.
 * @param key - The Redis set key to remove from.
 * @param value - The member value to remove from the set.
 */
async function sRem(key: string, value: string): Promise<number> {
  markCacheDirty();
  return client.sRem(key, value);
}

/**
 * Score/value pair accepted by Redis sorted-set writes in this module.
 */
interface ZAddOptions {
  score: number;
  value: string;
}

/**
 * Adds one or more score/value pairs to a Redis sorted set.
 * @param key - The sorted-set key to write to.
 * @param scoreValue - A single score/value pair or an array of pairs to insert.
 * @returns The number of new sorted-set members added.
 */
async function zAdd(key: string, scoreValue: ZAddOptions | ZAddOptions[]): Promise<number> {
  markCacheDirty();
  if (Array.isArray(scoreValue)) return client.zAdd(key, scoreValue);
  return client.zAdd(key, scoreValue);
}

/**
 * Reads a score-ordered range from a Redis sorted set.
 * @param key - The sorted-set key to read from.
 * @param start - The inclusive lower index in the sorted range.
 * @param end - The inclusive upper index in the sorted range.
 */
async function zRange(key: string, start: number, end: number): Promise<string[]> {
  return client.zRange(key, start, end);
}

/**
 * Removes a member from a Redis sorted set.
 * @param key - The sorted set key to remove from.
 * @param value - The member value to remove from the sorted set.
 */
async function zRem(key: string, value: string): Promise<number> {
  markCacheDirty();
  return client.zRem(key, value);
}

/**
 * Deletes a Redis key.
 * @param key - The Redis key to delete entirely.
 */
async function del(key: string): Promise<number> {
  markCacheDirty();
  return client.del(key);
}

// =====================
// JSON Backup / Restore
// =====================
/**
 * JSON backup object keyed by the original Redis key name.
 */
interface BackupData {
  [key: string]: BackupEntry;
}

/**
 * Persists the current Redis dataset to the JSON backup file.
 * @returns A result object describing whether the backup succeeded and where it was written.
 */
async function saveState(): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const keys = await client.keys("*");
    const backupData: BackupData = {};

    for (const key of keys) {
      const type = await client.type(key);
      switch (type) {
        case "string":
          backupData[key] = { type, value: JSON.parse(await client.get(key) || "{}") as BackupStringValue };
          break;
        case "list":
          backupData[key] = { type, value: await client.lRange(key, 0, -1) };
          break;
        case "set":
          backupData[key] = { type, value: await client.sMembers(key) };
          break;
        case "zset":
          const zItems = await client.zRangeWithScores(key, 0, -1);
          backupData[key] = { type, value: zItems };
          break;
        case "hash":
          backupData[key] = { type, value: await client.hGetAll(key) };
          break;
        default:
          console.warn(`${colors.yellow}[cache]${colors.reset} Skipping unsupported key type for ${key}: ${type}`);
      }
    }

    fs.writeFileSync(BACKUP_FILE, JSON.stringify(backupData, null, 2));
    cacheDirty = false; // Reset dirty flag after successful save
    return { success: true, path: BACKUP_FILE };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`${colors.red}[cache]${colors.reset} Failed to save Redis state:`, err);
    return { success: false, error };
  }
}

/**
 * Restores Redis state from the JSON backup file.
 * @returns A result object describing whether restore succeeded and, when relevant, why it failed.
 */
async function loadState(): Promise<{ success: boolean; error?: string }> {
  let backupFile = BACKUP_FILE;
  try {
    if (!fs.existsSync(BACKUP_FILE)) {
      if(fs.existsSync(BACKUP_FILE_EXAMPLE)) {
        backupFile = BACKUP_FILE_EXAMPLE;
      } else {
        console.warn(`${colors.yellow}[cache]${colors.reset} Backup file not found: ${BACKUP_FILE} OR ${BACKUP_FILE_EXAMPLE}`);
        return { success: false, error: "Backup file not found" };
      }
    }

    const rawData = fs.readFileSync(backupFile);
    const backupData: BackupData = JSON.parse(rawData.toString());

    await client.flushDb();

    for (const key of Object.keys(backupData)) {
      const entry = backupData[key];
      switch (entry.type) {
        case "string":
          await client.set(key, JSON.stringify(entry.value));
          break;
        case "list":
          if (entry.value.length) await client.rPush(key, entry.value);
          break;
        case "set":
          if (entry.value.length) await client.sAdd(key, entry.value);
          break;
        case "zset":
          if (entry.value.length) {
            const zItems = entry.value.map((item) => ({ score: item.score, value: item.value }));
            await client.zAdd(key, zItems);
          }
          break;
        case "hash":
          if (Object.keys(entry.value).length) await client.hSet(key, entry.value);
          break;
      }
    }

    console.log(`${colors.green}[cache]${colors.reset} Redis state loaded from ${backupFile}`);
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`${colors.red}[cache]${colors.reset} Failed to load Redis state:`, err);
    return { success: false, error };
  }
}

// =====================
// Auto-save interval
// =====================
/**
 * Computes the next backup interval based on the current backup file size.
 * @returns The next auto-save delay in milliseconds.
 */
function getDynamicInterval(): number {
  try {
    if (!fs.existsSync(BACKUP_FILE)) return MIN_INTERVAL_MS;
    const stats = fs.statSync(BACKUP_FILE);
    const sizeMB = stats.size / (1024 * 1024);
    return Math.min(
      MAX_INTERVAL_MS,
      Math.max(MIN_INTERVAL_MS, (sizeMB / SIZE_THRESHOLD_MB) * MAX_INTERVAL_MS)
    );
  } catch (err) {
    console.warn(`${colors.yellow}[cache]${colors.reset} Failed to calculate backup interval, using max.`, err);
    return MAX_INTERVAL_MS;
  }
}

/**
 * Starts the adaptive auto-save loop for Redis backups.
 * @returns A promise that resolves after the first timer has been scheduled.
 */
async function startAutoSaveDynamic(): Promise<void> {
  let interval = getDynamicInterval();
  console.log(`${colors.green}[cache]${colors.reset} Auto-save enabled. Initial interval: ${colors.cyan}${Math.round(interval / 1000)}s${colors.reset}. Only saves when cache changes.`);

  const saveAndSchedule = async (): Promise<void> => {
    try {
      if (cacheDirty) {
        await saveState();
      }
    } catch (err) {
      console.error(`${colors.red}[cache]${colors.reset} Auto-save failed:`, err);
    }

    interval = getDynamicInterval();
    autoSaveTimerId = setTimeout(saveAndSchedule, interval);
  };

  autoSaveTimerId = setTimeout(saveAndSchedule, interval);
}

/**
 * Stops the auto-save loop and clears any pending timers.
 */
function stopAutoSave(): void {
  if (autoSaveTimerId) {
    clearTimeout(autoSaveTimerId);
    autoSaveTimerId = null;
    console.log(`${colors.green}[cache]${colors.reset} Auto-save stopped`);
  }
}

export {
  client,
  get,
  set,
  exists,
  sAdd,
  sMembers,
  sRem,
  zAdd,
  zRange,
  zRem,
  del,
  saveState,
  loadState,
  startAutoSaveDynamic,
  stopAutoSave
};
