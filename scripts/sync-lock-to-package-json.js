#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');

if (!fs.existsSync(pkgPath) || !fs.existsSync(lockPath)) {
  console.error('package.json or package-lock.json not found in repo root');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

const rootPackage = lock.packages && lock.packages[''] ? lock.packages[''] : null;
if (!rootPackage) {
  console.error('Unexpected lockfile format: root package not found under "packages[""]"');
  process.exit(1);
}

const lockDeps = rootPackage.dependencies || {};
const lockDev = rootPackage.devDependencies || {};

function syncSection(sectionName, from, to) {
  const changed = [];
  Object.keys(from).forEach((name) => {
    if (to && Object.prototype.hasOwnProperty.call(to, name)) {
      const lockVer = from[name];
      if (to[name] !== lockVer) {
        to[name] = lockVer;
        changed.push(name);
      }
    }
  });
  return changed;
}

const changedDeps = syncSection('dependencies', lockDeps, pkg.dependencies);
const changedDev = syncSection('devDependencies', lockDev, pkg.devDependencies);

if (changedDeps.length === 0 && changedDev.length === 0) {
  console.log('No top-level dependency versions needed updating.');
  process.exit(0);
}

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

console.log('Updated package.json to match versions from package-lock.json:');
if (changedDeps.length) console.log(' dependencies:', changedDeps.join(', '));
if (changedDev.length) console.log(' devDependencies:', changedDev.join(', '));
console.log('\nNext steps: run `npm ci` in CI or locally to verify clean install.');
