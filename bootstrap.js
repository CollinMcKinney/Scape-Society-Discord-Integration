#!/usr/bin/env node

/**
 * Concord Bootstrap & Runtime Script
 * 
 * This file serves dual purposes:
 * - On HOST: Manages Podman containers (dev workflow)
 * - In CONTAINER: Installs deps and starts server (runtime)
 * 
 * Usage:
 *   Host:      node bootstrap.js
 *   Container: node bootstrap.js (auto-detected)
 */

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ============================================================================
// Environment Detection
// ============================================================================

function isRunningInContainer() {
  // Check for container environment variable (set in podman-compose.yaml)
  if (process.env.IS_CONTAINER === 'true') {
    console.log('[bootstrap] Detected container environment');
    return true;
  }

  // Check for Docker/Podman container files
  if (fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv')) {
    console.log('[bootstrap] Detected container environment (via container files)');
    return true;
  }

  return false;
}

// ============================================================================
// Container Mode (Runtime)
// ============================================================================

function runInContainer() {
  try {
    // Enable corepack for yarn management.
    execSync('corepack enable', { stdio: 'inherit' });
    console.log('[bootstrap] corepack enabled...');

    // Install dependencies with Yarn PnP (generates yarn.lock, .pnp.cjs, etc.)
    execSync('yarn install', { stdio: 'inherit' });
    console.log('[bootstrap] Container dependencies installed...');

    // Run Yarn audit inside the container on every boot (non-fatal).
    try {
      execSync('yarn npm audit -R', { stdio: 'inherit' });
    } catch (auditErr) {
      console.warn('[bootstrap] yarn audit failed (continuing):', auditErr?.message ?? auditErr);
    }

    // Start nodemon with server.ts (PnP-aware) using spawn for proper signal handling
    const nodemon = spawn('yarn', ['nodemon', '--legacy-watch', '/app/src/server.ts'], {
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' }
    });
    console.log('[bootstrap] Nodemon started...');
    
    let shuttingDown = false;

    // Forward signals to nodemon with force-kill timeout
    function shutdown(signal) {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[bootstrap] Received ${signal}, stopping nodemon...`);
      nodemon.kill('SIGTERM');
      
      // Force kill after 3 seconds if nodemon doesn't exit
      setTimeout(() => {
        console.log('[bootstrap] Forcing nodemon exit...');
        nodemon.kill('SIGKILL');
      }, 3000);
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    nodemon.on('close', (code) => {
      process.exit(code ?? 0);
    });

  } catch (err) {
    console.error('[bootstrap] Error starting services:', err);
    process.exit(1);
  }
}

// ============================================================================
// Host Mode (Development Workflow)
// ============================================================================

function getPublicIp() {
  try {
    const ip = execSync('curl -s https://api.ipify.org', { encoding: 'utf8' }).trim();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
  } catch {
    // ignore
  }
  return null;
}

function generateSecret(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

function updateEnvPostgresCredentials() {
  const envPath = path.resolve(process.cwd(), '.env');
  const content = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf8')
    : '';
  const lines = content.split(/\r?\n/).filter(l => l.length > 0 || l === '');
  let changed = false;

  const keys = ['POSTGRES_USER', 'POSTGRES_PASSWORD'];
  const existingKeys = {};

  for (const line of lines) {
    for (const key of keys) {
      if (line.startsWith(`${key}=`)) {
        existingKeys[key] = line.split('=')[1]?.trim();
      }
    }
  }

  if (!existingKeys.POSTGRES_USER) {
    existingKeys.POSTGRES_USER = generateSecret(12);
    lines.push(`POSTGRES_USER=${existingKeys.POSTGRES_USER}`);
    changed = true;
    console.log(`[bootstrap] Generated POSTGRES_USER=${existingKeys.POSTGRES_USER}`);
  }

  if (!existingKeys.POSTGRES_PASSWORD) {
    existingKeys.POSTGRES_PASSWORD = generateSecret(32);
    lines.push(`POSTGRES_PASSWORD=${existingKeys.POSTGRES_PASSWORD}`);
    changed = true;
    console.log(`[bootstrap] Generated POSTGRES_PASSWORD (hidden)`);
  }

  if (changed) {
    fs.writeFileSync(envPath, `${lines.join('\n')}\n`, 'utf8');
  } else {
    console.log('[bootstrap] POSTGRES_USER and POSTGRES_PASSWORD already set');
  }

  return { user: existingKeys.POSTGRES_USER, password: existingKeys.POSTGRES_PASSWORD };
}

function updateEnvPublicIp(publicIp) {
  if (!publicIp) return { changed: false };
  const envPath = path.resolve(process.cwd(), '.env');
  const content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const lines = content.split(/\r?\n/);
  let found = false;
  let changed = false;

  const next = lines.map(line => {
    if (line.startsWith('PUBLIC_IP=')) {
      found = true;
      if (line !== `PUBLIC_IP=${publicIp}`) {
        changed = true;
        return `PUBLIC_IP=${publicIp}`;
      }
    }
    return line;
  });

  if (!found) {
    next.push(`PUBLIC_IP=${publicIp}`);
    changed = true;
  }

  while (next.length > 0 && next[next.length - 1] === '') {
    next.pop();
  }

  fs.writeFileSync(envPath, `${next.join('\n')}\n`, 'utf8');
  return { changed };
}

function runOnHost() {
  try {
    updateEnvPostgresCredentials();

    const publicIp = getPublicIp();
    if (publicIp) {
      const { changed } = updateEnvPublicIp(publicIp);
      if (changed) {
        console.log(`[bootstrap] Updated .env with PUBLIC_IP=${publicIp}`);
      } else {
        console.log(`[bootstrap] PUBLIC_IP already up to date: ${publicIp}`);
      }
    } else {
      console.log('[bootstrap] Unable to detect public IP; skipping .env update.');
    }

    // Clean everything
    execSync('podman compose --file podman-compose.yaml down -v', { stdio: 'inherit' });
    console.log('[bootstrap] Prior services terminated...');

    // Start services with build
    execSync('podman compose --file podman-compose.yaml up -d --build', { stdio: 'inherit' });
    console.log('[bootstrap] Container has booted...');

    // Commit the container as a local image (quiet mode)
    execSync('podman commit --quiet concord concord:latest');
    console.log('[bootstrap] Container committed to "concord:latest" local image...');

    // Stream logs
    execSync('podman compose --file podman-compose.yaml logs -f', { stdio: 'inherit' });

  } catch (err) {
    console.error('[bootstrap] Error during full rebuild:', err);
    process.exit(1);
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

function main() {
  if (isRunningInContainer()) {
    runInContainer();
  } else {
    runOnHost();
  }
}

// Run the appropriate mode
main();
