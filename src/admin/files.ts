import * as files from "../files.ts";
import type { FileCategory, FileMeta } from "../files.ts";

/**
 * Lists all files across all categories.
 */
export async function listFiles(
  requireAuth: () => Promise<void>
): Promise<Record<FileCategory, FileMeta[]>> {
  await requireAuth();
  return files.listAllFiles();
}

/**
 * Lists all files in a specific category.
 */
export async function listFilesByCategory(
  requireAuth: () => Promise<void>,
  category: FileCategory
): Promise<FileMeta[]> {
  await requireAuth();
  const fileList = await files.listFiles(category);
  const metadata: FileMeta[] = [];

  for (const name of fileList) {
    const meta = await files.getFileMeta(category, name);
    if (meta) {
      metadata.push(meta);
    }
  }

  return metadata;
}

/**
 * Uploads a file to disk from base64-encoded data.
 */
export async function uploadFile(
  requireAuth: () => Promise<void>,
  category: FileCategory,
  name: string,
  base64Data: string,
  mimeType?: string
): Promise<FileMeta> {
  await requireAuth();

  // Validate category name format
  if (!/^[a-z0-9_-]+$/.test(category)) {
    throw new Error("Invalid category name. Use only lowercase letters, numbers, dashes, and underscores.");
  }

  // Validate and decode base64 data
  const buffer = Buffer.from(base64Data, "base64");
  if (buffer.length === 0) {
    throw new Error("Invalid or empty file data");
  }

  return await files.uploadFile(category, name, buffer, mimeType);
}

/**
 * Deletes a file from disk and cache.
 */
export async function deleteFile(
  requireAuth: () => Promise<void>,
  category: FileCategory,
  name: string
): Promise<boolean> {
  await requireAuth();

  // Validate category
  const validCategories: FileCategory[] = await files.getCategories();
  if (!validCategories.includes(category)) {
    throw new Error(`Invalid category. Must be one of: ${validCategories.join(", ")}`);
  }

  return await files.deleteFile(category, name);
}

/**
 * Lists all file categories.
 */
export async function getCategories(
  requireAuth: () => Promise<void>
): Promise<FileCategory[]> {
  await requireAuth();
  return files.getCategories();
}

/**
 * Creates a new file category.
 */
export async function createCategory(
  requireAuth: () => Promise<void>,
  name: string
): Promise<FileCategory> {
  await requireAuth();
  return files.createCategory(name);
}

/**
 * Deletes a file category.
 */
export async function deleteCategory(
  requireAuth: () => Promise<void>,
  name: string
): Promise<boolean> {
  await requireAuth();
  return files.deleteCategory(name);
}

/**
 * Gets the list of allowed MIME types for file uploads.
 */
export async function getAllowedMimeTypes(
  requireAuth: () => Promise<void>
): Promise<string[]> {
  await requireAuth();
  return files.getAllowedMimeTypes();
}

/**
 * Sets the list of allowed MIME types for file uploads (ROOT only).
 */
export async function setAllowedMimeTypes(
  requireAuth: () => Promise<void>,
  requireRoot: () => Promise<void>,
  ...mimeTypes: string[]
): Promise<void> {
  await requireAuth();
  await requireRoot();
  return files.setAllowedMimeTypes(mimeTypes);
}
