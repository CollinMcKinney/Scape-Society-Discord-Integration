// datastore.js
const Redis = require("redis");
const fs = require("fs");
const path = require("path");

// ======== Config ========
const redisHost = process.env.REDIS_HOST || "127.0.0.1";
const redisPort = process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379;
const BACKUP_DIR = path.join(__dirname, "backups");
const BACKUP_FILE = path.join(BACKUP_DIR, "redis.json");

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

console.log(`Initializing Redis client on ${redisHost}:${redisPort}...`);

// ======== Redis Client ========
const client = Redis.createClient({
  socket: { host: redisHost, port: redisPort },
});

client.on("error", (err) => console.error("Redis Client Error", err));

async function initStorage() {
  await client.connect();
  console.log("Redis connected!");
}

// ======== Basic Operations ========
async function get(key) {
  const data = await client.get(key);
  return data ? JSON.parse(data) : null;
}

async function set(key, value, options = {}) {
  return client.set(key, JSON.stringify(value), options);
}

async function exists(key) {
  return client.exists(key);
}

async function sAdd(key, value) {
  return client.sAdd(key, value);
}

async function sMembers(key) {
  return client.sMembers(key);
}

async function zAdd(key, { score, value }) {
  return client.zAdd(key, { score, value });
}

async function zRange(key, start, end) {
  return client.zRange(key, start, end);
}

async function del(key) {
  return client.del(key);
}

// ======== Persistence (JSON backup) ========

async function saveState() {
  try {
    const keys = await client.keys("*");
    const backupData = {};

    for (const key of keys) {
      const type = await client.type(key);

      switch (type) {
        case "string":
          backupData[key] = { type, value: JSON.parse(await client.get(key)) };
          break;
        case "list":
          backupData[key] = { type, value: await client.lRange(key, 0, -1) };
          break;
        case "set":
          backupData[key] = { type, value: await client.sMembers(key) };
          break;
        case "zset":
          backupData[key] = { type, value: await client.zRangeWithScores(key, 0, -1) };
          break;
        case "hash":
          backupData[key] = { type, value: await client.hGetAll(key) };
          break;
        default:
          console.warn(`Skipping unsupported key type for ${key}: ${type}`);
      }
    }

    fs.writeFileSync(BACKUP_FILE, JSON.stringify(backupData, null, 2));
    console.log(`Redis state saved to ${BACKUP_FILE}`);
    return { success: true, path: BACKUP_FILE };
  } catch (err) {
    console.error("Failed to save Redis state:", err);
    return { success: false, error: err.message };
  }
}

async function loadState() {
  try {
    if (!fs.existsSync(BACKUP_FILE)) {
      throw new Error(`Backup file not found: ${BACKUP_FILE}`);
    }

    const rawData = fs.readFileSync(BACKUP_FILE);
    const backupData = JSON.parse(rawData);

    await client.flushDb();

    for (const key of Object.keys(backupData)) {
      const { type, value } = backupData[key];

      switch (type) {
        case "string":
          await client.set(key, JSON.stringify(value));
          break;
        case "list":
          if (value.length) await client.rPush(key, value);
          break;
        case "set":
          if (value.length) await client.sAdd(key, value);
          break;
        case "zset":
          if (value.length) {
            const zItems = value.map((item) => ({ score: item.score, value: item.value }));
            await client.zAdd(key, zItems);
          }
          break;
        case "hash":
          if (Object.keys(value).length) await client.hSet(key, value);
          break;
      }
    }

    console.log(`Redis state loaded from ${BACKUP_FILE}`);
    return { success: true };
  } catch (err) {
    console.error("Failed to load Redis state:", err);
    return { success: false, error: err.message };
  }
}

// ======== Exports ========
module.exports = {
  client,
  initStorage,
  get,
  set,
  exists,
  sAdd,
  sMembers,
  zAdd,
  zRange,
  del,
  saveState,
  loadState,
};