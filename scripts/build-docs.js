#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  if (!exists) return;
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((child) => {
      copyRecursiveSync(path.join(src, child), path.join(dest, child));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

const repoRoot = path.join(__dirname, '..');
const src = path.join(repoRoot, 'docs');
const dest = path.join(repoRoot, 'web-build');

if (!fs.existsSync(src)) {
  console.error('Source docs/ directory not found:', src);
  process.exit(1);
}

// Clean destination
if (fs.existsSync(dest)) {
  fs.rmSync(dest, { recursive: true, force: true });
}

copyRecursiveSync(src, dest);
console.log('Docs copied to', dest);
