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

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ============================================================================
// Environment Detection
// ============================================================================

function isRunningInContainer() {
  // Check for container environment variable (set in podman-compose.yaml)
  if (process.env.CONTAINER === 'true') {
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
  console.log('[bootstrap] Starting Concord in container mode...');
  console.log('=========================================');
  
  try {
    // Install dependencies
    console.log('[bootstrap] Installing dependencies...');
    execSync('yarn install', { stdio: 'inherit' });

    // Start nodemon with server.ts
    console.log('[bootstrap] Starting nodemon...');
    execSync('/app/node_modules/.bin/nodemon --legacy-watch /app/src/server.ts', {
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' }
    });

  } catch (err) {
    console.error('[bootstrap] Error starting services:', err);
    process.exit(1);
  }
}

// ============================================================================
// Host Mode (Development Workflow)
// ============================================================================

function runOnHost() {
  console.log('[bootstrap] Running on host (development mode)...');
  console.log('=========================================');
  
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    const examplePath = path.resolve(process.cwd(), ".env.example");

    // Handle .env file
    try {
      if (fs.existsSync(envPath)) {
        console.log('.env file found');
      } else {
        if (!fs.existsSync(examplePath)) {
          console.error("No .env.example found. Cannot create .env");
          process.exit(1);
        }
        fs.copyFileSync(examplePath, envPath);
        console.log("Created .env from .env.example");
      }
    } catch (err) {
      console.error("Error handling .env file:", err);
      process.exit(1);
    }

    // Clean everything
    console.log('[bootstrap] Cleaning up previous containers, networks, and volumes...');
    execSync('podman compose --file podman-compose.yaml down -v', { stdio: 'inherit' });

    // Start services with build
    console.log('[bootstrap] Starting services...');
    execSync('podman compose --file podman-compose.yaml up -d --build', { stdio: 'inherit' });

    // Commit the container as a local image
    console.log('[bootstrap] Committing Concord container to local image "concord:latest"...');
    execSync('podman commit concord concord:latest', { stdio: 'inherit' });

    // Stream logs
    console.log('[bootstrap] Streaming logs...');
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
  console.log('[bootstrap] Concord Bootstrap');
  console.log('==================');
  
  if (isRunningInContainer()) {
    runInContainer();
  } else {
    runOnHost();
  }
}

// Run the appropriate mode
main();
