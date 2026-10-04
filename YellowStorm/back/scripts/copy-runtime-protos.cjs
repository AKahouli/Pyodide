const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(path.join(root, 'package.json'), path.join(output, 'package.json'));
for (const moduleName of ['agent', 'conversation', 'conversation-v2', 'playbook-flow', 'worky']) {
  const relative = path.join('modules', moduleName, 'proto');
  const destination = path.join(output, 'src', relative);
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(path.join(root, 'src', relative), destination, { recursive: true });
}
