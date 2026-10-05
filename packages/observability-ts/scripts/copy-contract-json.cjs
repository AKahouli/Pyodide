// tsc emits require('./generated/*.json') but does not copy JSON (or the .cjs worker) to outDir.
const fs = require('fs');
const path = require('path');
const from = path.join(__dirname, '..', 'src');
const to = path.join(__dirname, '..', 'dist');
fs.mkdirSync(path.join(to, 'generated'), { recursive: true });
for (const name of fs.readdirSync(path.join(from, 'generated'))) {
  fs.copyFileSync(path.join(from, 'generated', name), path.join(to, 'generated', name));
}
fs.copyFileSync(path.join(from, 'worker.cjs'), path.join(to, 'worker.cjs'));
