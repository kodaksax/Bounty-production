const fs = require('fs');
const { SourceMapConsumer } = require('source-map');

(async () => {
  const mapPath = './tmp_bundle/ios.bundle.map';
  if (!fs.existsSync(mapPath)) {
    console.error('Sourcemap not found at', mapPath);
    process.exit(2);
  }
  const raw = fs.readFileSync(mapPath, 'utf8');
  let map;
  try {
    map = JSON.parse(raw);
  } catch (err) {
    console.error(
      'Failed to parse sourcemap JSON:',
      err && err.stack ? err.stack : err
    );
    console.error(
      'Remediation: ensure the bundle and sourcemap are up to date (e.g., re-run bundle generation).'
    );
    process.exit(2);
  }

  let found = false;
  await SourceMapConsumer.with(map, null, consumer => {
    // Ensure column spans are computed so `lastGeneratedColumn` reflects mapping extents
    try {
      consumer.computeColumnSpans();
    } catch (e) {
      // Some source-map versions may not support this; ignore if absent.
    }
    let count = 0;
    consumer.eachMapping(m => {
      count++;
      // Non-finite generated columns/lines (NaN, Infinity, etc.) indicate that Metro
      // produced a malformed sourcemap entry. source-map's computeColumnSpans may
      // set `lastGeneratedColumn` to Infinity for mappings that span to EOF; this
      // can trip consumers that don't handle Infinity. Detect both the primary
      // generatedColumn and the lastGeneratedColumn here so we can report and
      // investigate problematic entries.
      const badGenerated = !Number.isFinite(m.generatedColumn) || !Number.isFinite(m.generatedLine);
      const badLast = m.lastGeneratedColumn !== null && !Number.isFinite(m.lastGeneratedColumn);
      if (badGenerated || badLast) {
        console.error('Found problematic mapping (line:', m.generatedLine, 'genCol:', m.generatedColumn, 'lastGenCol:', m.lastGeneratedColumn, 'source:', m.source, ')');
        console.error(m);
        // Also print the affected generated source line for context when available
        try {
          const codeLines = require('fs').readFileSync('./tmp_bundle/ios.bundle', 'utf8').split(/\r?\n/);
          const genLine = codeLines[m.generatedLine - 1] || '<no line available>';
          if (Number.isFinite(m.generatedColumn)) {
            console.error(
              'Generated line content (snippet):',
              genLine.slice(
                Math.max(0, m.generatedColumn - 40),
                m.generatedColumn + 40
              )
            );
          } else {
            console.error(
              'Generated line content (snippet) unavailable: non-finite generatedColumn',
              m.generatedColumn
            );
          }
        } catch (e) {
          // ignore
        }
        found = true;
      }
    });
    console.log('Total mappings checked:', count);
  });

  if (!found) {
    console.log('No non-finite mapping columns found via source-map consumer.');
  }
})();
