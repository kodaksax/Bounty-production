const fs = require('fs');
const path = require('path');
const glob = require('glob');

const ROOT = process.cwd();
const PATTERN = '**/*.*';
const EXCLUDE = ['**/node_modules/**', '**/.git/**', '**/build-dsym/**', '**/android-backup-20260123-171108/**'];
const ALLOWED_EXT = new Set(['.ts','.tsx','.js','.jsx','.json','.env','.md','.txt','.yml','.yaml','.ps1','.cfg']);

const matches = glob.sync(PATTERN, { nodir: true, ignore: EXCLUDE });
let count = 0;
for (const f of matches) {
  const ext = path.extname(f);
  if (!ALLOWED_EXT.has(ext)) continue;
  try {
    const full = path.join(ROOT, f);
    const s = fs.readFileSync(full, 'utf8');
    if (s.indexOf('Bounty-production') !== -1) {
      const t = s.split('Bounty-production').join('Bounty-production');
      fs.writeFileSync(full, t, 'utf8');
      console.log('Patched', f);
      count++;
    }
  } catch (e) {
    // ignore read/write errors for strange files
  }
}
console.log('Done. Files patched:', count);
