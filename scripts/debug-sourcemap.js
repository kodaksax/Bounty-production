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
    let count = 0;
    consumer.eachMapping(m => {
      count++;
      // Non-finite generated columns/lines (NaN, Infinity, etc.) indicate that Metro
      // produced a malformed sourcemap entry. In check-bundle-size.js we filter these
      // mappings out before analyzing bundle size, so this debug script mirrors that
      // logic to help us detect and investigate broken mappings at their source.
      if (!isFinite(m.generatedColumn) || !isFinite(m.generatedLine)) {
        console.error('Found non-finite mapping:', m);
        found = true;
      }
    });
    console.log('Total mappings checked:', count);
  });

  if (!found) {
    console.log('No non-finite mapping columns found via source-map consumer.');
  }
})();
