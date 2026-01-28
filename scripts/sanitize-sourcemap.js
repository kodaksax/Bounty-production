const fs = require('fs');
const path = require('path');
const { SourceMapConsumer, SourceMapGenerator } = require('source-map');

// Run multiple sanitize passes until no problematic mappings remain or max passes reached.
(async () => {
  const mapPath = path.resolve('./tmp_bundle/ios.bundle.map');
  if (!fs.existsSync(mapPath)) {
    console.error('Sourcemap not found at', mapPath);
    process.exit(2);
  }

  // Empirically, most sourcemaps are fully cleaned within 2–3 passes; 8 is a conservative
  // upper bound that provides headroom for larger or more complex maps while preventing this
  // script from running indefinitely on pathological inputs. If problematic mappings still
  // remain after MAX_PASSES iterations, sanitization stops and any remaining invalid mappings
  // are left in place so the build can continue with a best-effort sourcemap.
  const MAX_PASSES = 8;
  let totalRemoved = 0;

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    const raw = fs.readFileSync(mapPath, 'utf8');
    let map;
    try {
      map = JSON.parse(raw);
    } catch (err) {
      console.error('Failed to parse sourcemap JSON:', err && err.stack ? err.stack : err);
      process.exit(2);
    }

    let removed = 0;
    const generator = new SourceMapGenerator({ file: map.file || 'sanitized.js' });
    await SourceMapConsumer.with(map, null, consumer => {
      try {
        consumer.computeColumnSpans();
      } catch (e) {
        // ignore
      }
      consumer.eachMapping(m => {
        const badGenerated = !Number.isFinite(m.generatedColumn) || !Number.isFinite(m.generatedLine);
        const badLast = m.lastGeneratedColumn !== null && !Number.isFinite(m.lastGeneratedColumn);
        if (badGenerated || badLast) {
          removed++;
          return; // drop this mapping
        }
        generator.addMapping({
          generated: { line: m.generatedLine, column: m.generatedColumn },
          source: m.source || undefined,
          original: (m.originalLine != null && m.originalColumn != null) ? { line: m.originalLine, column: m.originalColumn } : undefined,
          name: m.name || undefined
        });
      });

      if (Array.isArray(map.sources) && Array.isArray(map.sourcesContent)) {
        map.sources.forEach((src, i) => {
          if (map.sourcesContent && map.sourcesContent[i] != null) {
            generator.setSourceContent(src, map.sourcesContent[i]);
          }
        });
      }
    });

    if (removed > 0) {
      totalRemoved += removed;
      try {
        fs.writeFileSync(mapPath, generator.toString());
        console.log(`Pass ${pass}: removed ${removed} problematic mappings.`);
      } catch (err) {
        console.error('Failed to write sanitized sourcemap:', err);
        process.exit(2);
      }
    } else {
      console.log(`Pass ${pass}: no problematic mappings found.`);
      break;
    }
  }

  console.log(`Sanitization complete. Total mappings removed: ${totalRemoved}`);
})();
