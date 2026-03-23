import express, { Router, Request, Response } from "express";
import * as files from "./files";
import * as auth from "./auth";
import type { FileCategory, FileMeta } from "./files";

const router: Router = express.Router();

/**
 * Middleware to require authentication for write operations
 */
async function requireAuth(req: Request, res: Response, next: Function): Promise<void> {
  // Try to get session token from header
  const sessionToken = req.headers['x-session-token'] as string || '';
  
  if (!sessionToken) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  
  try {
    const actor = await auth.getVerifiedActor(sessionToken);
    (req as any).actor = actor; // Attach actor to request for role checks
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid or expired session" });
  }
}

/**
 * Middleware to require minimum role
 */
function requireRole(minRole: number): (req: Request, res: Response, next: Function) => void {
  return (req: Request, res: Response, next: Function): void => {
    const actor = (req as any).actor;
    
    if (!actor) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    
    if (actor.role < minRole) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    
    next();
  };
}

// Role constants (should match permission.ts)
const Roles = {
  BLOCKED: 0,
  GUEST: 1,
  MEMBER: 2,
  MODERATOR: 3,
  ADMIN: 4,
  OWNER: 5,
  ROOT: 6
};

/**
 * Validates and normalizes a file category from URL params.
 * @param category - The raw category string from the URL.
 * @returns The validated FileCategory or null if invalid.
 */
function validateCategory(category: string): FileCategory | null {
  const normalizedName = category.toLowerCase().trim();
  if (!/^[a-z0-9_-]+$/.test(normalizedName)) {
    return null;
  }
  return normalizedName;
}

/**
 * Sanitizes a file name to prevent path traversal attacks.
 * @param name - The raw file name from the URL.
 * @returns The sanitized name or null if invalid.
 */
function sanitizeFileName(name: string): string | null {
  // Decode URL encoding
  const decoded = decodeURIComponent(name);
  
  // Reject if contains path separators or null bytes
  if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) {
    return null;
  }
  
  // Reject if starts with a dot (hidden files)
  if (decoded.startsWith(".")) {
    return null;
  }
  
  // Basic length check
  if (decoded.length === 0 || decoded.length > 255) {
    return null;
  }
  
  return decoded;
}

/**
 * GET /files - List all files across all categories
 */
router.get("/", async (_req: Request, res: Response): Promise<void> => {
  try {
    const allFiles = await files.listAllFiles();
    res.json(allFiles);
  } catch (err) {
    console.error("[files] Error listing files:", err);
    res.status(500).json({ error: "Failed to list files" });
  }
});

/**
 * GET /files/categories - List all available categories
 */
router.get("/categories", async (_req: Request, res: Response): Promise<void> => {
  try {
    const categories = await files.getCategories();
    res.json(categories);
  } catch (err) {
    console.error("[files] Error listing categories:", err);
    res.status(500).json({ error: "Failed to list categories" });
  }
});

/**
 * POST /files/categories - Create a new category (ADMIN+)
 */
router.post("/categories", requireAuth, requireRole(Roles.ADMIN), async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "Category name is required" });
      return;
    }
    
    const category = await files.createCategory(name);
    res.json({ category });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create category";
    res.status(400).json({ error: message });
  }
});

/**
 * DELETE /files/categories/:name - Delete a category (ADMIN+)
 */
router.delete("/categories/:name", requireAuth, requireRole(Roles.ADMIN), async (req: Request, res: Response): Promise<void> => {
  try {
    const category = validateCategory(req.params.name);
    if (!category) {
      res.status(400).json({ error: "Invalid category name" });
      return;
    }
    
    await files.deleteCategory(category);
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete category";
    res.status(400).json({ error: message });
  }
});

/**
 * GET /files/favicon - Get the current favicon path
 */
router.get("/favicon", async (_req: Request, res: Response): Promise<void> => {
  try {
    const favicon = await files.getFavicon();
    if (favicon) {
      res.json(favicon);
    } else {
      res.json({ category: "branding", name: "favicon.png" }); // Default
    }
  } catch (err) {
    res.json({ category: "branding", name: "favicon.png" }); // Default on error
  }
});

/**
 * POST /files/favicon - Set the favicon (ADMIN+)
 */
router.post("/favicon", requireAuth, requireRole(Roles.ADMIN), async (req: Request, res: Response): Promise<void> => {
  try {
    const { category, name } = req.body;
    if (!category || !name) {
      res.status(400).json({ error: "Category and name are required" });
      return;
    }
    
    await files.setFavicon(category, name);
    res.json({ success: true, category, name });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to set favicon";
    res.status(400).json({ error: message });
  }
});

/**
 * GET /files/:category - List all files in a category
 */
router.get("/:category", async (req: Request, res: Response): Promise<void> => {
  const category = validateCategory(req.params.category);

  if (!category) {
    res.status(400).json({ error: "Invalid category" });
    return;
  }

  try {
    const fileList = await files.listFiles(category);
    const metadata: FileMeta[] = [];

    for (const name of fileList) {
      const meta = await files.getFileMeta(category, name);
      if (meta) {
        metadata.push(meta);
      }
    }

    res.json(metadata);
  } catch (err) {
    console.error("[files] Error listing files:", err);
    res.status(500).json({ error: "Failed to list files" });
  }
});

/**
 * GET /files/:category/:name - Serve a single file
 */
router.get("/:category/:name", async (req: Request, res: Response): Promise<void> => {
  const category = validateCategory(req.params.category);

  if (!category) {
    res.status(400).json({ error: "Invalid category" });
    return;
  }

  const sanitizedName = sanitizeFileName(req.params.name);

  if (!sanitizedName) {
    res.status(400).json({ error: "Invalid file name" });
    return;
  }

  try {
    const fileBuffer = await files.getFile(category, sanitizedName);

    if (!fileBuffer) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const meta = await files.getFileMeta(category, sanitizedName);
    const mimeType = meta?.mimeType || "application/octet-stream";

    res.set("Content-Type", mimeType);
    res.set("Cache-Control", "public, max-age=31536000"); // Cache for 1 year
    res.send(fileBuffer);
  } catch (err) {
    console.error("[files] Error serving file:", err);
    res.status(500).json({ error: "Failed to serve file" });
  }
});

export default router;
