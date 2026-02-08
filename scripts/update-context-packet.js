#!/usr/bin/env node
/**
 * Documentation Sync Helper
 * 
 * Syncs project metadata and status from ARCHITECTURE.md to CONTEXT_PACKET.md
 * 
 * Usage:
 *   node scripts/update-context-packet.js
 *   npm run docs:sync
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// File paths
const PACKAGE_JSON_PATH = path.join(__dirname, '..', 'package.json');
const ARCHITECTURE_PATH = path.join(__dirname, '..', 'docs', 'ARCHITECTURE.md');
const CONTEXT_PACKET_PATH = path.join(__dirname, '..', 'docs', 'CONTEXT_PACKET.md');

// Markers
const STATUS_START_MARKER = '<!-- STATUS_START -->';
const STATUS_END_MARKER = '<!-- STATUS_END -->';
const SYNC_STATUS_START_MARKER = '<!-- SYNC_STATUS_START -->';
const SYNC_STATUS_END_MARKER = '<!-- SYNC_STATUS_END -->';

/**
 * Get git short commit hash
 */
function getGitCommit() {
  try {
    const commit = execSync('git rev-parse --short HEAD', { 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    return commit || 'unknown';
  } catch (err) {
    return 'unknown';
  }
}

/**
 * Read package.json
 */
function readPackageJson() {
  try {
    const content = fs.readFileSync(PACKAGE_JSON_PATH, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`Warning: Could not read package.json: ${err.message}`);
    return { name: 'unknown', version: '0.0.0' };
  }
}

/**
 * Extract status block from ARCHITECTURE.md
 */
function extractStatusBlock(architectureContent) {
  const startIdx = architectureContent.indexOf(STATUS_START_MARKER);
  const endIdx = architectureContent.indexOf(STATUS_END_MARKER);
  
  if (startIdx === -1 || endIdx === -1) {
    console.log('Warning: Could not find status markers in ARCHITECTURE.md');
    console.log(`  Expected: ${STATUS_START_MARKER} ... ${STATUS_END_MARKER}`);
    return null;
  }
  
  // Extract content between markers (excluding markers themselves)
  const statusContent = architectureContent.substring(
    startIdx + STATUS_START_MARKER.length,
    endIdx
  ).trim();
  
  return statusContent;
}

/**
 * Update CONTEXT_PACKET.md with synced data
 */
function updateContextPacket(contextContent, statusBlock, pkg, commit) {
  let updated = contextContent;
  
  // Update Project Identity table
  const identityPattern = /(\| Name \|)[^\n]+/;
  const versionPattern = /(\| Version \|)[^\n]+/;
  const commitPattern = /(\| Commit \|)[^\n]+/;
  const syncPattern = /(\| Last Sync \|)[^\n]+/;
  
  const now = new Date().toISOString().split('T')[0];
  
  updated = updated.replace(identityPattern, `| Name | ${pkg.name} |`);
  updated = updated.replace(versionPattern, `| Version | ${pkg.version} |`);
  updated = updated.replace(commitPattern, `| Commit | ${commit} |`);
  updated = updated.replace(syncPattern, `| Last Sync | ${now} |`);
  
  // Update status block if we have one
  if (statusBlock) {
    const syncStartIdx = updated.indexOf(SYNC_STATUS_START_MARKER);
    const syncEndIdx = updated.indexOf(SYNC_STATUS_END_MARKER);
    
    if (syncStartIdx === -1 || syncEndIdx === -1) {
      console.log('Warning: Could not find sync status markers in CONTEXT_PACKET.md');
      console.log(`  Expected: ${SYNC_STATUS_START_MARKER} ... ${SYNC_STATUS_END_MARKER}`);
    } else {
      updated = updated.substring(0, syncStartIdx + SYNC_STATUS_START_MARKER.length) +
                '\n' + statusBlock + '\n' +
                updated.substring(syncEndIdx);
    }
  }
  
  return updated;
}

/**
 * Main function
 */
function main() {
  console.log('=== Documentation Sync ===\n');
  
  // Read package.json
  const pkg = readPackageJson();
  console.log(`Project: ${pkg.name}@${pkg.version}`);
  
  // Get git commit
  const commit = getGitCommit();
  console.log(`Commit: ${commit}`);
  
  // Check if ARCHITECTURE.md exists
  if (!fs.existsSync(ARCHITECTURE_PATH)) {
    console.error(`\nError: ${ARCHITECTURE_PATH} not found`);
    console.log('Please create docs/ARCHITECTURE.md first');
    process.exit(1);
  }
  
  // Check if CONTEXT_PACKET.md exists
  if (!fs.existsSync(CONTEXT_PACKET_PATH)) {
    console.error(`\nError: ${CONTEXT_PACKET_PATH} not found`);
    console.log('Please create docs/CONTEXT_PACKET.md first');
    process.exit(1);
  }
  
  // Read files
  const architectureContent = fs.readFileSync(ARCHITECTURE_PATH, 'utf8');
  const contextContent = fs.readFileSync(CONTEXT_PACKET_PATH, 'utf8');
  
  // Extract status block
  const statusBlock = extractStatusBlock(architectureContent);
  if (statusBlock) {
    console.log('\nStatus block found in ARCHITECTURE.md');
  }
  
  // Update CONTEXT_PACKET.md
  const updatedContext = updateContextPacket(contextContent, statusBlock, pkg, commit);
  
  // Check if anything changed
  if (updatedContext === contextContent) {
    console.log('\nNo changes detected in CONTEXT_PACKET.md');
    return;
  }
  
  // Write updated content
  fs.writeFileSync(CONTEXT_PACKET_PATH, updatedContext);
  console.log('\n✓ CONTEXT_PACKET.md updated successfully');
  console.log(`  - Project: ${pkg.name}@${pkg.version}`);
  console.log(`  - Commit: ${commit}`);
  if (statusBlock) {
    console.log('  - Status block synced from ARCHITECTURE.md');
  }
}

// Run
main();
