#!/usr/bin/env node
/**
 * Qoo10 env gate: verify required env vars before network calls
 * Exits with error if required vars are missing
 */

const MODE = process.env.MODE || 'lookup';

const REQUIRED_VARS = {
  lookup: ['QOO10_SAK'],
  register: ['QOO10_SAK']
};

function checkEnv(mode) {
  const required = REQUIRED_VARS[mode];
  
  if (!required) {
    console.error(`Unknown MODE: ${mode}`);
    process.exit(1);
  }
  
  const missing = [];
  
  required.forEach(varName => {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  });
  
  if (missing.length > 0) {
    console.error(`Missing required env vars for MODE=${mode}: ${missing.join(', ')}`);
    process.exit(1);
  }
  
  console.log(`✓ Env check passed for MODE=${mode}`);
  process.exit(0);
}

checkEnv(MODE);
