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
    // Enable corepack.
    execSync('corepack enable', { stdio: 'inherit' });
    console.log('[bootstrap] corepack enabled...');

    // Set Yarn 4.x version.
    execSync('yarn set version latest', { stdio: 'inherit' });
    console.log('[bootstrap] Set latest Yarn version...');

    // Install dependencies with Yarn PnP.
    execSync('yarn install', { stdio: 'inherit' });
    console.log('[bootstrap] Container dependencies installed...');

    // Start nodemon with server.ts (PnP-aware.)
    execSync('yarn nodemon --legacy-watch /app/src/server.ts', {
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' }
    });
    console.log('[bootstrap] nodemon now watching for changes...');

  } catch (err) {
    console.error('[bootstrap] Error starting services:', err);
    process.exit(1);
  }
}

// ============================================================================
// Host Mode (Development Workflow)
// ============================================================================

function runOnHost() {
  try {
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
