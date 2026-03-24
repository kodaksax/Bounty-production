#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { SourceMapConsumer } = require('source-map');

async function main() {
  const [,, mapPathArg, bundlePathArg, lineArg, colArg] = process.argv;
  if (!mapPathArg || !lineArg) {
    console.error('Usage: node map-bundle-coordinate.js <sourcemap> [bundle] <line> [column]');
    process.exit(2);
  }
  const mapPath = path.resolve(mapPathArg);
  const bundlePath = bundlePathArg ? path.resolve(bundlePathArg) : path.resolve('./android.bundle');
  const genLine = parseInt(lineArg, 10);
  const genCol = colArg ? parseInt(colArg, 10) : 0;

  if (!fs.existsSync(mapPath)) {
    console.error('Sourcemap not found at', mapPath);
    process.exit(2);
  }

  const raw = fs.readFileSync(mapPath, 'utf8');
  let map;
  try {
    map = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse sourcemap JSON:', err);
    process.exit(2);
  }

  await SourceMapConsumer.with(map, null, consumer => {
    const orig = consumer.originalPositionFor({ line: genLine, column: genCol });
    console.log('Generated coordinate:', `${genLine}:${genCol}`);
    console.log('Mapped to:', orig);

    if (orig && orig.source) {
      const srcPath = path.resolve(orig.source.replace(/^webpack:\/\//, '').replace(/^\./, '.'));
      console.log('Source (as reported in map):', orig.source);
      try {
        // The sourcemap may embed sourcesContent; try extracting from there first
        if (map.sourcesContent) {
          const idx = map.sources.indexOf(orig.source);
          if (idx !== -1 && map.sourcesContent && map.sourcesContent[idx]) {
            const content = map.sourcesContent[idx].split(/\r?\n/);
            const start = Math.max(0, (orig.line || 1) - 5);
            const end = Math.min(content.length, (orig.line || 1) + 5);
            console.log(`--- Source snippet ${orig.source} lines ${start+1}-${end} ---`);
            for (let i = start; i < end; i++) {
              const marker = (i+1 === orig.line) ? '>>' : '  ';
              console.log(`${marker} ${i+1}: ${content[i]}`);
            }
            return;
          }
        }
        // Fallback: try to read file relative to repo
        if (fs.existsSync(srcPath)) {
          const content = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/);
          const start = Math.max(0, (orig.line || 1) - 5);
          const end = Math.min(content.length, (orig.line || 1) + 5);
          console.log(`--- Source snippet ${srcPath} lines ${start+1}-${end} ---`);
          for (let i = start; i < end; i++) {
            const marker = (i+1 === orig.line) ? '>>' : '  ';
            console.log(`${marker} ${i+1}: ${content[i]}`);
          }
        } else {
          console.log('Source file not found on disk; it may be embedded in the sourcemap or have an altered path.');
        }
      } catch (e) {
        console.error('Failed to read source file for snippet:', e && e.stack ? e.stack : e);
      }
    } else {
      console.log('No original position found for that generated coordinate.');
    }
  });
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(2);
});
