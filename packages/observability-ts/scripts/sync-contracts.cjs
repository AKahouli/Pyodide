// Keeps both SDK packages self-contained for packaging: the normative contract
// JSON lives in /contracts/observability and is copied in before build and test.
const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '..', '..', '..', 'contracts', 'observability');
const names = ['log-events.v1.json', 'budgets.v1.json', 'severity.v1.json', 'redaction.v1.json'];

const out = path.join(__dirname, '..', 'src', 'generated');
fs.mkdirSync(out, { recursive: true });
for (const name of names) {
  fs.copyFileSync(path.join(src, name), path.join(out, name));
}

const pyOut = path.resolve(__dirname, '..', '..', 'observability-python', 'src', 'yellowmind_observability', '_contracts');
fs.mkdirSync(pyOut, { recursive: true });
for (const name of names) {
  fs.copyFileSync(path.join(src, name), path.join(pyOut, name));
}
console.log('[observability] contract JSON synced (ts + python)');
