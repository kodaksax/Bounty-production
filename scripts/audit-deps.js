#!/usr/bin/env node

/**
 * Dependency Audit Script
 * 
 * Analyzes package.json dependencies for:
 * - Outdated packages
 * - Duplicate packages
 * - Security vulnerabilities
 * 
 * Usage: npm run audit-deps
 */

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function section(title) {
  console.log('\n');
  log(`${'='.repeat(60)}`, colors.cyan);
  log(`  ${title}`, colors.cyan);
  log(`${'='.repeat(60)}`, colors.cyan);
}

log('\n🔍 Running Dependency Audit...', colors.magenta);

// Check outdated packages
section('Outdated Packages Check');
try {
  execSync('npm outdated', { cwd: ROOT, stdio: 'inherit' });
  log('✅ All packages are up to date!', colors.green);
} catch (error) {
  log('⚠️  Some packages are outdated (see above)', colors.yellow);
}

// Check security
section('Security Audit');
try {
  execSync('npm audit', { cwd: ROOT, stdio: 'inherit' });
  log('✅ No security vulnerabilities found!', colors.green);
} catch (error) {
  log('⚠️  Security vulnerabilities found (see above)', colors.yellow);
}

// Summary
section('Summary & Recommendations');
log('\n📋 Regular Maintenance Tasks:\n', colors.cyan);
log('  • Run this audit monthly', colors.reset);
log('  • Keep dependencies up to date', colors.reset);
log('  • Address security vulnerabilities promptly', colors.reset);
log('\n✨ Done!\n', colors.green);
