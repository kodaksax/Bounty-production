#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const bundleDir = path.join(process.cwd(), 'tmp_bundle');
const bundleOutput = path.join(bundleDir, 'ios.bundle');
const sourcemapOutput = path.join(bundleDir, 'ios.bundle.map');
const entryFile = 'index.js'; // Using index.js as it is the project main

// Ensure clean state
if (fs.existsSync(bundleDir)) {
  fs.rmSync(bundleDir, { recursive: true, force: true });
}
fs.mkdirSync(bundleDir, { recursive: true });

console.log('📦 Generating bundle...');

// 1. Generate Bundle manually using Expo CLI (this avoids the visualizer crashing on generation)
// We use 'expo export:embed' which is the standard command for native bundling
// We quote paths to handle spaces in directory names
const generateArgs = [
  'expo',
  'export:embed',
  '--platform', 'ios',
  '--entry-file', entryFile,
  '--bundle-output', `"${bundleOutput}"`,
  '--sourcemap-output', `"${sourcemapOutput}"`,
  '--dev', 'false',
  '--minify', 'true'
];

const genResult = spawnSync('npx', generateArgs, {
  stdio: 'inherit',
  encoding: 'utf8',
  shell: true,
  env: { ...process.env, CI: 'true' }
});

if (genResult.status !== 0) {
  console.error('❌ Bundle generation failed.');
  process.exit(genResult.status || 1);
}

// 2. Sanitize Sourcemap
console.log('🧹 Sanitizing sourcemap...');
const sanitizeResult = spawnSync('node', ['scripts/sanitize-sourcemap.js'], {
  stdio: 'inherit',
  encoding: 'utf8',
  shell: true
});

if (sanitizeResult.status !== 0) {
  console.error('❌ Sourcemap sanitization failed.');
  process.exit(sanitizeResult.status || 1);
}

// 3. Analyze Bundle using source-map-explorer
console.log('📊 Analyzing bundle...');

// We use source-map-explorer to generate the JSON output we need
// We parse the bundleOutput path to handle spaces safely in the args if needed, 
// though quotes usually work best with shell=true.
const analyzeArgs = [
  '--yes', // npx auto-install
  'source-map-explorer',
  `"${bundleOutput}"`,
  '--json',
  '--no-border-checks'
];

const analyzeResult = spawnSync('npx', analyzeArgs, {
  encoding: 'utf8',
  shell: true,
  maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large JSON
});

if (analyzeResult.status !== 0) {
  console.error('❌ Bundle analysis failed.');
  console.error(analyzeResult.stderr);
  process.exit(analyzeResult.status || 1);
}

// Parse and process the result
try {
  const resultParams = JSON.parse(analyzeResult.stdout);
  // source-map-explorer returns object with 'results' array usually, or just the object?
  // Let's inspect the output structure if needed, but assuming standard format.
  // Actually, source-map-explorer JSON output is usually: { results: [...], ... }

  // We need to match the expected output format if possible, or just dump it.
  // The original script wanted to "persistRepoResult".
  // We will simply write it to tmp_bundle/result.json.

  const resultJsonPath = path.join(bundleDir, 'result.json');
  fs.writeFileSync(resultJsonPath, analyzeResult.stdout);

  // Also print a summary if possible? 
  // For now, just printing the JSON to stdout as requested by the original goal (it returned stdout: JSON).
  // The original script printed the serialized JSON to stdout at the end.

  console.log(analyzeResult.stdout);

} catch (e) {
  console.error('❌ Failed to parse analysis output.');
  console.error(e);
  console.log('Raw output preview:', analyzeResult.stdout.substring(0, 500));
  process.exit(1);
}

