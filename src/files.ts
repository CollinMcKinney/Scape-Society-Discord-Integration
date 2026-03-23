import fs from "fs";
import path from "path";
import { sAdd, sMembers, sRem, set, get, del, exists } from "./cache";

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

/**
 * File category type - can be any string
 */
export type FileCategory = string;

/**
 * Metadata stored in Redis for each file.
 */
export interface FileMeta {
  name: string;
  category: FileCategory;
  mimeType: string;
  size: number;
  uploadedAt: number;
}

/**
 * Redis key for storing the list of all categories
 */
const CATEGORIES_KEY = "files:categories";

/**
 * Default categories that are always available
 */
const DEFAULT_CATEGORIES: FileCategory[] = [
  "clan_icons", 
  "chat_badges",
  "branding"
];

/**
 * Gets the disk path for a file.
 * @param category - The file category.
 * @param name - The file name.
 */
function getFilePath(category: FileCategory, name: string): string {
  return path.join(__dirname, `../data/${category}/${name}`);
}

/**
 * Redis key helpers for file metadata.
 */
function getFileMetaKey(category: FileCategory, name: string): string {
  return `file:meta:${category}:${name}`;
}

function getFileSetKey(category: FileCategory): string {
  return `files:${category}`;
}

/**
 * Validates a category name (alphanumeric, dashes, underscores only)
 * @param name - The proposed category name
 * @returns True if valid
 */
function isValidCategoryName(name: string): boolean {
  return /^[a-z0-9_-]+$/.test(name);
}

/**
 * Gets all file categories from Redis
 */
export async function getCategories(): Promise<FileCategory[]> {
  const categories = await sMembers(CATEGORIES_KEY);
  
  // Always include default categories
  const allCategories = new Set([...DEFAULT_CATEGORIES, ...categories]);
  return Array.from(allCategories);
}

/**
 * Creates a new file category
 * @param name - The category name to create
 * @returns The created category name
 * @throws Error if category name is invalid or already exists
 */
export async function createCategory(name: string): Promise<FileCategory> {
  const normalizedName = name.toLowerCase().trim();
  
  if (!isValidCategoryName(normalizedName)) {
    throw new Error("Invalid category name. Use only lowercase letters, numbers, dashes, and underscores.");
  }
  
  const categories = await getCategories();
  if (categories.includes(normalizedName)) {
    throw new Error(`Category '${normalizedName}' already exists`);
  }
  
  // Create the directory
  const dir = path.join(__dirname, `../data/${normalizedName}`);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Add to Redis
  await sAdd(CATEGORIES_KEY, normalizedName);

  console.log(`${colors.green}[files]${colors.reset} Created category: ${colors.cyan}${normalizedName}${colors.reset}`);
  return normalizedName;
}

/**
 * Deletes a file category and all its files
 * @param name - The category name to delete
 * @returns True if deleted
 * @throws Error if trying to delete a default category
 */
export async function deleteCategory(name: string): Promise<boolean> {
  const normalizedName = name.toLowerCase().trim();

  if (DEFAULT_CATEGORIES.includes(normalizedName)) {
    throw new Error("Cannot delete default categories");
  }

  // Delete all files in the category
  const files = await listFiles(normalizedName);
  for (const file of files) {
    await deleteFile(normalizedName, file);
  }

  // Delete the category set
  await del(getFileSetKey(normalizedName));

  // Remove from categories list
  await sRem(CATEGORIES_KEY, normalizedName);

  // Delete the directory
  const dir = path.join(__dirname, `../data/${normalizedName}`);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(`${colors.green}[files]${colors.reset} Deleted category: ${colors.cyan}${normalizedName}${colors.reset}`);
  return true;
}

/**
 * Detects the MIME type from a file extension.
 * @param fileName - The file name to infer the MIME type from.
 */
export function getMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".json": "application/json",
  };
  return mimeMap[ext] || "application/octet-stream";
}

/**
 * Ensures the file directory exists for a category.
 * @param category - The file category.
 */
function ensureFileDir(category: FileCategory): void {
  const dir = path.join(__dirname, `../data/${category}`);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Loads all files from a category folder into the Redis cache (metadata only).
 * @param category - The file category folder to load from.
 * @returns The number of files successfully loaded.
 */
async function loadFilesFromDisk(category: FileCategory): Promise<number> {
  const filesDir = path.join(__dirname, `../data/${category}`);

  if (!fs.existsSync(filesDir)) {
    console.warn(`${colors.yellow}[files]${colors.reset} Files directory not found: ${filesDir}`);
    return 0;
  }

  const files = fs.readdirSync(filesDir);
  let loaded = 0;

  for (const file of files) {
    const filePath = path.join(filesDir, file);
    const stat = fs.statSync(filePath);

    if (!stat.isFile()) continue;

    try {
      const mimeType = getMimeType(file);
      const size = stat.size;

      // Store metadata in Redis
      const meta: FileMeta = {
        name: file,
        category,
        mimeType,
        size,
        uploadedAt: stat.mtimeMs,
      };

      await set(getFileMetaKey(category, file), meta);
      await sAdd(getFileSetKey(category), file);
      loaded++;
    } catch (err) {
      console.error(`${colors.red}[files]${colors.reset} Failed to load ${file} from ${category}:`, err);
    }
  }

  console.log(`${colors.green}[files]${colors.reset} Loaded ${colors.cyan}${loaded}${colors.reset} files from ${colors.cyan}${category}${colors.reset}`);
  return loaded;
}

/**
 * Uploads a file from a buffer to disk and registers it in the cache.
 * @param category - The file category.
 * @param name - The file name.
 * @param buffer - The raw file data.
 */
export async function uploadFile(
  category: FileCategory,
  name: string,
  buffer: Buffer
): Promise<FileMeta> {
  ensureFileDir(category);
  
  const filePath = getFilePath(category, name);
  const mimeType = getMimeType(name);
  const size = buffer.length;
  
  // Write to disk
  fs.writeFileSync(filePath, buffer);
  
  // Store metadata in Redis
  const meta: FileMeta = {
    name,
    category,
    mimeType,
    size,
    uploadedAt: Date.now(),
  };
  
  await set(getFileMetaKey(category, name), meta);
  await sAdd(getFileSetKey(category), name);

  console.log(`${colors.green}[files]${colors.reset} Uploaded ${colors.cyan}${name}${colors.reset} to ${colors.cyan}${category}${colors.reset} (${colors.yellow}${size}${colors.reset} bytes)`);
  return meta;
}

/**
 * Reads a file from disk.
 * @param category - The file category.
 * @param name - The file name.
 * @returns The file buffer or null if not found.
 */
export async function getFile(
  category: FileCategory,
  name: string
): Promise<Buffer | null> {
  const filePath = getFilePath(category, name);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  return fs.readFileSync(filePath);
}

/**
 * Retrieves metadata for a file from Redis.
 * @param category - The file category.
 * @param name - The file name.
 * @returns The file metadata or null if not found.
 */
export async function getFileMeta(
  category: FileCategory,
  name: string
): Promise<FileMeta | null> {
  const metaKey = getFileMetaKey(category, name);
  return await get<FileMeta>(metaKey);
}

/**
 * Lists all files in a category from Redis.
 * @param category - The file category.
 * @returns Array of file names in the category.
 */
export async function listFiles(category: FileCategory): Promise<string[]> {
  const setKey = getFileSetKey(category);
  return await sMembers(setKey);
}

/**
 * Lists all files across all categories with their metadata.
 * @returns Object with category keys and arrays of file metadata.
 */
export async function listAllFiles(): Promise<Record<FileCategory, FileMeta[]>> {
  const result: Record<FileCategory, FileMeta[]> = {};
  const categories = await getCategories();
  
  for (const category of categories) {
    const names = await listFiles(category);
    const files: FileMeta[] = [];
    
    for (const name of names) {
      const meta = await getFileMeta(category, name);
      if (meta) {
        files.push(meta);
      }
    }
    
    result[category] = files;
  }
  
  return result;
}

/**
 * Deletes a file from disk and removes it from the cache.
 * @param category - The file category.
 * @param name - The file name.
 * @returns True if the file was deleted, false if not found.
 */
export async function deleteFile(
  category: FileCategory,
  name: string
): Promise<boolean> {
  const filePath = getFilePath(category, name);
  const metaKey = getFileMetaKey(category, name);
  const setKey = getFileSetKey(category);

  // Check if exists in cache
  const exists = await sMembers(setKey).then(members => members.includes(name));
  if (!exists) return false;

  // Delete from disk
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  
  // Remove from Redis
  await del(metaKey);
  await sRem(setKey, name);

  console.log(`${colors.green}[files]${colors.reset} Deleted ${colors.cyan}${name}${colors.reset} from ${colors.cyan}${category}${colors.reset}`);
  return true;
}

/**
 * Initializes the file service by loading files from disk into cache.
 */
export async function initFiles(): Promise<void> {
  // Initialize categories list with defaults
  for (const category of DEFAULT_CATEGORIES) {
    const categories = await sMembers(CATEGORIES_KEY);
    if (!categories.includes(category)) {
      await sAdd(CATEGORIES_KEY, category);
    }
    
    // Ensure directory exists
    const dir = path.join(__dirname, `../data/${category}`);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  
  let total = 0;
  const categories = await getCategories();
  for (const category of categories) {
    const count = await loadFilesFromDisk(category);
    total += count;
  }
  
  console.log(`${colors.green}[files]${colors.reset} File service initialized with ${colors.cyan}${total}${colors.reset} total files across ${colors.cyan}${categories.length}${colors.reset} categories`);
}

/**
 * Gets the current favicon path from cache
 */
export async function getFavicon(): Promise<{ category: string; name: string } | null> {
  return await get<{ category: string; name: string }>("config:favicon");
}

/**
 * Sets the favicon path in cache
 */
export async function setFavicon(category: string, name: string): Promise<void> {
  await set("config:favicon", { category, name });
  console.log(`${colors.green}[files]${colors.reset} Favicon set to ${colors.cyan}${category}/${name}${colors.reset}`);
}
