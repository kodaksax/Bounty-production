const glob = require('glob');
const fs = require('fs');
const path = require('path');

const matches = glob.sync('**/*.*', { ignore: ['**/node_modules/**','**/.git/**'] });
let found = 0;
for (const f of matches) {
  try {
    const s = fs.readFileSync(f, 'utf8');
    if (s.indexOf('Bounty-Production') !== -1) {
      console.log(f);
      found++;
    }
  } catch (e) {}
}
console.log('Found:', found);
