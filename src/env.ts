import fs from "fs";
import path from "path";

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

const ENV_FILE = path.join(__dirname, "../.env");
const ENV_KEY_PATTERN = /^[A-Z0-9_]+$/i;

// Allowed environment variables that can be edited via admin panel
const ALLOWED_ENV_VARS = [
  'SESSION_TTL_HOURS',
  'REDIS_HOST',
  'REDIS_PORT',
  'API_PORT',
  'WEBHOOK_ID',
  'WEBHOOK_TOKEN',
  'CHANNEL_ID',
  'BOT_TOKEN',
  'PERMISSIONS_INTEGER',
  'CLIENT_ID',
  'CLIENT_SECRET',
  'REDIRECT_URI'
];

/**
 * Validates an environment variable value based on its key.
 * @param key - The variable name.
 * @param value - The value to validate.
 * @throws Error if value is invalid for the given key.
 */
function validateEnvValue(key: string, value: string): void {
  // Check for dangerous shell characters
  if (/[;&|`$(){}[\]]/.test(value)) {
    throw new Error(`Invalid value for ${key}: contains dangerous characters`);
  }
  
  // Type-specific validation
  if (key === 'SESSION_TTL_HOURS') {
    const num = parseInt(value);
    if (isNaN(num) || num < 1 || num > 720) {
      throw new Error('SESSION_TTL_HOURS must be between 1 and 720 hours');
    }
  }
  
  if (key === 'REDIS_PORT' || key === 'API_PORT') {
    const num = parseInt(value);
    if (isNaN(num) || num < 1 || num > 65535) {
      throw new Error(`${key} must be a valid port number (1-65535)`);
    }
  }
  
  if (key === 'PERMISSIONS_INTEGER') {
    const num = parseInt(value);
    if (isNaN(num) || num < 0) {
      throw new Error('PERMISSIONS_INTEGER must be a non-negative number');
    }
  }
}

/**
 * Reads the current .env file contents.
 * @returns Parsed environment variables as key-value pairs.
 */
export function readEnvFile(): Record<string, string> {
  if (!fs.existsSync(ENV_FILE)) {
    return {};
  }

  const content = fs.readFileSync(ENV_FILE, "utf8");
  const lines = content.split("\n");
  const envVars: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();
      envVars[key] = value;
    }
  }

  return envVars;
}

/**
 * Writes environment variables to the .env file.
 * @param envVars - Key-value pairs to write.
 */
export function writeEnvFile(envVars: Record<string, string>): void {
  // Create backup before writing
  if (fs.existsSync(ENV_FILE)) {
    const backupPath = ENV_FILE + '.backup';
    fs.copyFileSync(ENV_FILE, backupPath);
    console.log(`${colors.green}[env]${colors.reset} Created backup: ${colors.cyan}${backupPath}${colors.reset}`);
  }
  
  const content = Object.entries(envVars)
    .filter(([key]) => ENV_KEY_PATTERN.test(key))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  fs.writeFileSync(ENV_FILE, content + "\n", "utf8");
}

/**
 * Gets a single environment variable.
 * @param key - The variable name.
 * @returns The value or undefined if not found.
 */
export function getEnvVar(key: string): string | undefined {
  const envVars = readEnvFile();
  return envVars[key];
}

/**
 * Sets a single environment variable.
 * @param key - The variable name.
 * @param value - The value to set.
 * @throws Error if key is invalid or value fails validation.
 */
export function setEnvVar(key: string, value: string): void {
  if (!ENV_KEY_PATTERN.test(key)) {
    throw new Error("Invalid environment variable name");
  }
  
  // Check if variable is in allowed list (if list is provided)
  if (ALLOWED_ENV_VARS.length > 0 && !ALLOWED_ENV_VARS.includes(key)) {
    throw new Error(`Variable ${key} is not in the allowed list. Allowed: ${ALLOWED_ENV_VARS.join(', ')}`);
  }
  
  // Validate the value
  validateEnvValue(key, value);

  const envVars = readEnvFile();
  envVars[key] = value;
  writeEnvFile(envVars);

  // Update process.env for current runtime
  process.env[key] = value;

  console.log(`${colors.green}[env]${colors.reset} Updated ${colors.cyan}${key}${colors.reset}=${colors.yellow}${value}${colors.reset}`);
}
