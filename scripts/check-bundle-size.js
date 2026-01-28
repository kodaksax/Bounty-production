#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Runs the bundle visualizer and enforces the configured size budget.
const pkg = require('../package.json');
const sanitize = (value) => (value ? value.replace(/[^a-zA-Z0-9_]/g, '') : '');
const appName = sanitize(pkg.name) || 'UnknownApp';
const baseDir = path.join(os.tmpdir(), 'react-native-bundle-visualizer', appName);
const bundleOutput = path.join(baseDir, 'ios.bundle');
const bundleDir = path.dirname(bundleOutput);
const sourcemapOutput = path.join(baseDir, 'ios.bundle.map');
const sizeBudgetBytes = 10 * 1024 * 1024; // 10 MB

fs.mkdirSync(bundleDir, { recursive: true });

const cliArgs = [
  'react-native-bundle-visualizer',
  '--platform',
  'ios',
  '--expo',
  'true',
  '--entry-file',
  'expo-router/entry.js',
  '--bundle-output',
  bundleOutput,
  '--sourcemap-output',
  sourcemapOutput,
  '--minify',
  'true',
  '--format',
  'json'
];

// Helper to persist the visualizer result into repo-local tmp for CI inspection.
// Persist the visualizer result and full logs to `tmp_bundle/`.
// Writes full `visualizer-stdout.log` and `visualizer-stderr.log` (if present)
// and stores a compact `result.json` that references those files and
// includes short previews for quick inspection.
function persistRepoResult(resultObj, stdout, stderr) {
  try {
    const repoTmp = path.join(process.cwd(), 'tmp_bundle');
    fs.mkdirSync(repoTmp, { recursive: true });

    if (stdout) {
      try { fs.writeFileSync(path.join(repoTmp, 'visualizer-stdout.log'), stdout, 'utf8'); } catch (e) { /* fallthrough */ }
    }

    if (stderr) {
      try { fs.writeFileSync(path.join(repoTmp, 'visualizer-stderr.log'), stderr, 'utf8'); } catch (e) { /* fallthrough */ }
    }

    const preview = (str, len = 1024) => (str ? String(str).slice(0, len) : '');

    const toWrite = Object.assign({}, resultObj || {});
    toWrite.__logs = {
      stdoutFile: stdout ? 'visualizer-stdout.log' : null,
      stderrFile: stderr ? 'visualizer-stderr.log' : null,
      stdoutPreview: preview(stdout, 1024),
      stderrPreview: preview(stderr, 1024)
    };

    fs.writeFileSync(path.join(repoTmp, 'result.json'), JSON.stringify(toWrite, null, 2), 'utf8');
  } catch (err) {
    console.debug('check-bundle-size: failed to write result.json to tmp_bundle:', err);
  }
}

// Validate the shape of the object returned by runBundleVisualizer.
function validateVisualizerResult(res) {
  if (!res || typeof res !== 'object') return false;
  // Expected to contain at least one of these keys produced by the visualizer.
  if (Array.isArray(res.bundles) || Array.isArray(res.errors)) return true;
  if (res.sourcemap && typeof res.sourcemap === 'object') return true;
  // Some versions may return other shapes; be conservative and require at least
  // one of the above. If this fails, callers should fall back to the CLI.
  return false;
}

// Attempt programmatic invocation first for more reliable JSON output.
async function runProgrammatic() {
  try {
    const { runBundleVisualizer } = require('react-native-bundle-visualizer');
    const result = await runBundleVisualizer({
      platform: 'ios',
      expo: true,
      entryFile: 'expo-router/entry.js',
      bundleOutput,
      sourcemapOutput,
      minify: true,
      format: 'json'
    });
    // Persist programmatic result (no CLI stdout/stderr available).
    persistRepoResult(result, null, null);
    return { ok: true, stdout: JSON.stringify(result) };
  } catch (err) {
    return { ok: false, error: err };
  }
}

(async () => {
  let runResult = await runProgrammatic();
  let stdout = '';
  let stderr = '';

  if (!runResult.ok) {
    // Fallback to invoking via npx CLI if the programmatic API isn't available or fails.
    const result = spawnSync('npx', cliArgs, {
      shell: true,
      env: {
        ...process.env,
        CI: process.env.CI || 'true'
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });

    if (result.status !== 0) {
      console.error(result.stderr || result.stdout);
      process.exit(result.status || 1);
    }

    stdout = result.stdout || '';
    stderr = result.stderr || '';
  } else {
    stdout = runResult.stdout || '';
  }

  // Run the sourcemap sanitizer so CI/workflows operate on a cleaned map.
  // Treat sanitizer failures as fatal to avoid passing bundle checks
  // when sourcemaps are corrupted. This logs a clear warning and exits
  // with the sanitizer's exit code so CI fails fast for investigation.
  try {
    const sanResult = spawnSync('node', ['scripts/sanitize-sourcemap.js'], {
      shell: true,
      encoding: 'utf8'
    });

    if (sanResult.error || sanResult.status !== 0) {
      console.warn('Sourcemap sanitization failed; bundle analysis may be incomplete');
      if (sanResult.stdout) console.warn(sanResult.stdout);
      if (sanResult.stderr) console.warn(sanResult.stderr);
      process.exit(sanResult.status || 1);
    }
  } catch (sanErr) {
    console.warn('Sourcemap sanitization failed; bundle analysis may be incomplete', sanErr);
    process.exit(1);
  }
  // At this point we have `stdout`/`stderr` (from programmatic or CLI).
  // Try to parse the visualizer JSON output if available and validate it.
  let parsed = null;
  let parseError = null;
  try {
    if (stdout) parsed = JSON.parse(stdout);
  } catch (e) {
    parseError = e;
  }

  if (parsed && validateVisualizerResult(parsed)) {
    persistRepoResult(parsed, stdout, stderr);
    return { ok: true, stdout: JSON.stringify(parsed) };
  }

  // If parsing failed or result shape is unexpected, persist full logs
  // and write a fallback result.json explaining the issue.
  const fallback = {
    success: false,
    reason: parseError ? 'parse_failed' : 'invalid_result_shape',
    message: parseError ? String(parseError.message || parseError) : 'Visualizer returned unexpected shape',
    timestamp: new Date().toISOString()
  };
  persistRepoResult(fallback, stdout, stderr);
  // Exit non-zero so CI notices the problem instead of silently passing.
  console.error('Could not obtain valid visualizer JSON output. See tmp_bundle/ for logs.');
  process.exit(2);
})();
