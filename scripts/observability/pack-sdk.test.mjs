import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packCanonicalSdk, verifyConsumerIntegrities } from './pack-sdk.mjs';

const repo = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
function temporary() {
  const parent = path.join(repo, '.tmp'); mkdirSync(parent, { recursive: true });
  return mkdtempSync(path.join(parent, 'sdk-pack-regression-'));
}
function unpack(bytes) {
  const tar = gunzipSync(bytes), entries = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, '');
    if (!name) break;
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, '').trim() || '0', 8);
    if (header[156] === 0 || header[156] === 48) entries.set(name, Buffer.from(tar.subarray(offset + 512, offset + 512 + size)));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

test('complete tarball bytes are invariant to LF/CRLF/mixed inputs, with inputs and binary assets preserved', () => {
  const base = temporary();
  try {
    const metadata = { name: '@test/canonical-sdk', version: '1.0.0', private: true,
      main: 'dist/index.js', types: 'dist/index.d.ts', exports: { '.': './dist/index.js' }, files: ['dist'] };
    const content = {
      'package.json': JSON.stringify(metadata, null, 2) + '\n',
      'dist/index.js': 'exports.value = 1;\n// second line\n',
      'dist/index.d.ts': 'export declare const value: number;\n',
      'dist/generated/event.json': '{\n  "event": "safe"\n}\n',
      'dist/index.js.map': '{"version":3,"sources":["../src/index.ts"]}\n',
      'dist/worker.cjs': 'module.exports = {};\n// worker\n',
    };
    const binary = Buffer.from([0, 13, 10, 255]);
    const artifacts = [];
    let lastSdk;
    for (const mode of ['lf', 'crlf', 'mixed']) {
      const sdk = path.join(base, mode), output = path.join(base, `out-${mode}`);
      const inputs = new Map();
      for (const [name, text] of Object.entries(content)) {
        const bytes = Buffer.from(mode === 'lf' ? text : mode === 'crlf' ? text.replace(/\n/g, '\r\n') : text.split('\n').map((line, index, lines) => line + (index === lines.length - 1 ? '' : index % 2 ? '\n' : '\r\n')).join(''));
        mkdirSync(path.dirname(path.join(sdk, name)), { recursive: true });
        writeFileSync(path.join(sdk, name), bytes); inputs.set(name, bytes);
      }
      writeFileSync(path.join(sdk, 'dist/asset.bin'), binary); inputs.set('dist/asset.bin', binary);
      const result = packCanonicalSdk(sdk, output), bytes = readFileSync(path.join(output, result.filename));
      artifacts.push({ ...result, bytes }); lastSdk = sdk;
      for (const [name, original] of inputs) assert.deepEqual(readFileSync(path.join(sdk, name)), original, `input changed: ${name}`);
      assert.equal(readdirSync(output).some(name => name.startsWith('.canonical-')), false);
      const entries = unpack(bytes);
      assert.deepEqual([...entries.keys()].sort(), [...inputs.keys()].map(name => `package/${name}`).sort());
      assert.deepEqual(JSON.parse(entries.get('package/package.json')), metadata);
      assert.deepEqual(entries.get('package/dist/asset.bin'), binary);
      for (const [name, text] of Object.entries(content)) assert.deepEqual(entries.get(`package/${name}`), Buffer.from(text));
    }
    assert.deepEqual(artifacts[0].bytes, artifacts[1].bytes);
    assert.deepEqual(artifacts[0].bytes, artifacts[2].bytes);
    assert.equal(artifacts[0].integrity, artifacts[2].integrity);
    writeFileSync(path.join(lastSdk, 'dist/generated/event.json'), '{"event":"changed"}\n');
    assert.notEqual(packCanonicalSdk(lastSdk, path.join(base, 'changed')).integrity, artifacts[0].integrity);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('ordinary staging rejects drift without rewriting locks; maintenance updates are explicit', () => {
  const base = temporary();
  try {
    const consumers = ['one', 'two'].map(name => path.join(base, name));
    const initial = JSON.stringify({ packages: { 'node_modules/@yellowmind/observability': { integrity: 'sha512-original' } } }, null, 4) + '\n';
    for (const consumer of consumers) { mkdirSync(consumer); writeFileSync(path.join(consumer, 'package-lock.json'), initial); }
    verifyConsumerIntegrities(consumers, 'sha512-original');
    assert.throws(() => verifyConsumerIntegrities(consumers, 'sha512-new'), /integrity mismatch/);
    for (const consumer of consumers) assert.equal(readFileSync(path.join(consumer, 'package-lock.json'), 'utf8'), initial);
    verifyConsumerIntegrities(consumers, 'sha512-new', true);
    const updated = consumers.map(consumer => readFileSync(path.join(consumer, 'package-lock.json'), 'utf8'));
    verifyConsumerIntegrities(consumers, 'sha512-new');
    consumers.forEach((consumer, index) => assert.equal(readFileSync(path.join(consumer, 'package-lock.json'), 'utf8'), updated[index]));
  } finally { rmSync(base, { recursive: true, force: true }); }
});
