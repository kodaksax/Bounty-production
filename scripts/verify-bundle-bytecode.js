#!/usr/bin/env node
/**
 * scripts/verify-bundle-bytecode.js
 *
 * Verifies that a build artifact's JS bundle was compiled to Hermes bytecode
 * (HBC) by a compiler whose bytecode version the app's Hermes runtime can
 * actually load.
 *
 * Background: on 2026-08-18, production iOS build 85 (2.0.5, commit 30ad2697)
 * shipped a bundle compiled at HBC version 98 by the Hermes V1 compiler
 * (hermes-compiler@250829098.0.10, forced tree-wide by package.json
 * overrides/resolutions) into a binary linking the stable Hermes 0.14.1
 * runtime, which only loads HBC 96. The runtime rejected the bundle, React
 * Native never initialized, no JS ever ran, and the app hung on the native
 * splash screen forever with no crash and no Sentry event.
 *
 * Nothing in the toolchain catches this: the runtime is chosen by
 * `expo.useHermesV1` (app.json -> expo-build-properties -> hermes-engine.podspec
 * -> version.properties), while the compiler is chosen by a plain
 * `require.resolve('hermes-compiler')` (hermes-engine.podspec:76). They are
 * independent inputs, and expo-build-properties only validates that they agree
 * when `useHermesV1` is truthy -- setting it to false skips the check entirely.
 *
 * This script closes that gap by comparing the two empirically rather than by
 * reasoning about npm resolution:
 *
 *   expected = compile a probe file with the compiler this project resolves
 *              (the exact binary hermes-engine.podspec will put in
 *              HERMES_CLI_PATH), and read the HBC version it emits
 *   actual   = read the HBC version out of the shipped artifact's bundle
 *
 * Run it against the .ipa/.aab before submitting to the store.
 *
 * Usage:
 *   node scripts/verify-bundle-bytecode.js <artifact>
 *
 *   <artifact> may be an .ipa, .app bundle, .apk, .aab, or a raw
 *   main.jsbundle / index.android.bundle file.
 *
 * Exit codes:
 *   0  Bytecode versions match -- the bundle will load.
 *   1  Mismatch, non-Hermes bundle, or the bundle could not be located.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/** First 8 bytes of every Hermes bytecode file, little-endian. */
const HERMES_MAGIC = 0x1f1903c103bc1fc6n;

const PROJECT_ROOT = path.resolve(__dirname, '..');

function fail(msg) {
  console.error(`\n[verify-bundle-bytecode] ERROR: ${msg}`);
  process.exit(1);
}

/**
 * Reads the HBC header. Returns { hermes: false } for a plain-JS (non-bytecode)
 * bundle, which is itself worth reporting -- it means the Hermes bundling step
 * did not run.
 */
function readBytecodeVersion(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(12);
  const read = fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);
  if (read < 12) return { hermes: false };
  if (buf.readBigUInt64LE(0) !== HERMES_MAGIC) return { hermes: false };
  return { hermes: true, version: buf.readUInt32LE(8) };
}

/**
 * Resolves hermesc exactly the way sdks/hermes-engine/hermes-engine.podspec:76
 * does, so we measure the compiler the native build will actually invoke rather
 * than whatever happens to be hoisted.
 */
function resolveProjectHermesc() {
  const rnPath = path.join(PROJECT_ROOT, 'node_modules', 'react-native');
  let pkgDir;
  try {
    pkgDir = path.dirname(require.resolve('hermes-compiler', { paths: [rnPath] }));
  } catch {
    fail(
      'Could not resolve the "hermes-compiler" package from node_modules/react-native. ' +
        'Run `npm install` first.'
    );
  }
  const version = require(path.join(pkgDir, 'package.json')).version;
  // hermes-compiler ships osx-bin, linux64-bin and win64-bin. Windows has to be
  // handled explicitly: OTA updates are published from a developer machine as
  // well as from CI, and a check that can't run where the bundle is compiled is
  // no check at all.
  const BIN_DIRS = { darwin: 'osx-bin', win32: 'win64-bin' };
  const binDir = BIN_DIRS[process.platform] || 'linux64-bin';
  const exe = process.platform === 'win32' ? 'hermesc.exe' : 'hermesc';
  const hermesc = path.join(pkgDir, 'hermesc', binDir, exe);
  if (!fs.existsSync(hermesc)) {
    fail(`Resolved hermes-compiler@${version} but no hermesc binary at ${hermesc}`);
  }
  return { hermesc, version, pkgDir };
}

/** Compiles a trivial file to learn the HBC version this compiler emits. */
function expectedBytecodeVersion(hermesc, workDir) {
  const src = path.join(workDir, '__probe.js');
  const out = path.join(workDir, '__probe.hbc');
  fs.writeFileSync(src, 'var x = 1;\n');
  const r = spawnSync(hermesc, ['-emit-binary', '-out', out, src], { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(out)) {
    fail(`hermesc failed to compile the probe file: ${r.stderr || r.error || 'unknown error'}`);
  }
  const info = readBytecodeVersion(out);
  if (!info.hermes) fail('hermesc produced a file without a Hermes bytecode header.');
  return info.version;
}

/** The Hermes runtime version the native binary links, for reporting. */
function runtimeHermesVersion() {
  const f = path.join(
    PROJECT_ROOT,
    'node_modules',
    'react-native',
    'sdks',
    'hermes-engine',
    'version.properties'
  );
  try {
    const txt = fs.readFileSync(f, 'utf8');
    const stable = /HERMES_VERSION_NAME=(.+)/.exec(txt);
    const v1 = /HERMES_V1_VERSION_NAME=(.+)/.exec(txt);
    return {
      stable: stable && stable[1].trim(),
      v1: v1 && v1[1].trim(),
    };
  } catch {
    return {};
  }
}

function unzip(archive, dest) {
  const r = spawnSync('unzip', ['-q', '-o', archive, '-d', dest], { encoding: 'utf8' });
  if (r.status !== 0) fail(`Failed to unzip ${archive}: ${r.stderr || r.error}`);
}

/** Recursively finds the first file matching one of the known bundle names. */
function findBundle(root) {
  const NAMES = new Set(['main.jsbundle', 'index.android.bundle']);
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (NAMES.has(e.name)) return full;
    }
  }
  return null;
}

/** Extracts (if needed) and locates the JS bundle inside the artifact. */
function locateBundle(artifact, workDir) {
  const st = fs.statSync(artifact);
  const ext = path.extname(artifact).toLowerCase();

  if (st.isFile() && !['.ipa', '.apk', '.aab', '.zip'].includes(ext)) {
    return artifact; // raw bundle
  }
  if (st.isDirectory()) {
    const found = findBundle(artifact); // .app directory
    if (!found) fail(`No main.jsbundle / index.android.bundle found under ${artifact}`);
    return found;
  }

  const dest = path.join(workDir, 'extracted');
  fs.mkdirSync(dest, { recursive: true });
  unzip(artifact, dest);
  const found = findBundle(dest);
  if (!found) {
    fail(
      `No main.jsbundle / index.android.bundle found inside ${path.basename(artifact)}. ` +
        `If this is an .aab, the bundle may live under base/assets/.`
    );
  }
  return found;
}

function main() {
  const artifact = process.argv[2];
  if (!artifact) {
    console.error('Usage: node scripts/verify-bundle-bytecode.js <artifact.ipa|.aab|.apk|.app|bundle>');
    process.exit(1);
  }
  if (!fs.existsSync(artifact)) fail(`No such file: ${artifact}`);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-hbc-'));
  try {
    const { hermesc, version: compilerVersion } = resolveProjectHermesc();
    const expected = expectedBytecodeVersion(hermesc, workDir);
    const runtime = runtimeHermesVersion();

    const bundlePath = locateBundle(path.resolve(artifact), workDir);
    const actual = readBytecodeVersion(bundlePath);

    console.log('='.repeat(72));
    console.log('[verify-bundle-bytecode] Hermes bytecode compatibility check');
    console.log('='.repeat(72));
    console.log(`  artifact          : ${artifact}`);
    console.log(`  bundle            : ${path.basename(bundlePath)}`);
    console.log(`  resolved compiler : hermes-compiler@${compilerVersion}`);
    if (runtime.stable) {
      console.log(`  runtime (stable)  : Hermes ${runtime.stable}   [useHermesV1: false]`);
    }
    if (runtime.v1) {
      console.log(`  runtime (V1)      : Hermes ${runtime.v1}  [useHermesV1: true]`);
    }
    console.log('');

    if (!actual.hermes) {
      console.log('  shipped bundle    : NOT Hermes bytecode (plain JS)');
      console.log('');
      console.log('  ❌ FAIL — the bundle was never compiled by hermesc.');
      console.log('     A plain-JS bundle in a release artifact usually means the Xcode');
      console.log('     "Bundle React Native code and images" phase skipped Hermes.');
      process.exit(1);
    }

    console.log(`  expected HBC ver  : ${expected}  (from this project's resolved hermesc)`);
    console.log(`  shipped  HBC ver  : ${actual.version}`);
    console.log('');

    if (actual.version === expected) {
      console.log('  ✅ PASS — bytecode versions match. The runtime will load this bundle.');
      process.exit(0);
    }

    console.log('  ❌ FAIL — BYTECODE VERSION MISMATCH. DO NOT SUBMIT THIS BUILD.');
    console.log('');
    console.log('     The Hermes runtime in this binary cannot load this bundle. The app');
    console.log('     will hang on the native splash screen forever, with no crash and no');
    console.log('     error reported to Sentry (JS never starts, so nothing can report it).');
    console.log('');
    console.log('     Most likely cause: a `hermes-compiler` entry in package.json');
    console.log('     "overrides"/"resolutions"/"dependencies" is forcing a compiler that');
    console.log('     does not match the runtime selected by `useHermesV1` in app.json.');
    console.log('     Remove the override so react-native\'s own hermes-compiler is used.');
    process.exit(1);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main();
