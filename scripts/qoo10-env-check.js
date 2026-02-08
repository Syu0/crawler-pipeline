#!/usr/bin/env node
/**
 * Qoo10 env gate: verify required env vars before network calls
 * Exits with error if required vars are missing
 * Cross-platform compatible (Windows/macOS/Linux)
 */

// Auto-load backend/.env
require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });

// Check required env var
if (!process.env.QOO10_SAK) {
  console.error('QOO10_SAK not set');
  process.exit(1);
}

// Silent success
process.exit(0);

