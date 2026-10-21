import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const textExtensions = new Set(['.json', '.js', '.cjs', '.mjs', '.ts', '.map', '.md', '.txt']);

function copyPackageFile(source, destination) {
  const info = statSync(source);
  if (info.isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const name of readdirSync(source).sort()) copyPackageFile(path.join(source, name), path.join(destination, name));
    chmodSync(destination, info.mode & 0o777);
    return;
  }
  let bytes = readFileSync(source);
  if (textExtensions.has(path.extname(source)) || /^(?:licen[cs]e|copying|notice)$/i.test(path.basename(source))) {
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('SDK text asset is not valid UTF-8');
    bytes = Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8');
  }
  writeFileSync(destination, bytes);
  chmodSync(destination, info.mode & 0o777);
}

/** Pack the existing published inventory, canonicalizing only disposable text copies. */
export function packCanonicalSdk(sdkDirectory, outputDirectory) {
  const metadata = JSON.parse(readFileSync(path.join(sdkDirectory, 'package.json'), 'utf8'));
  if (JSON.stringify(metadata.files) !== '["dist"]') throw new Error('SDK publish inventory changed; review canonical packaging inventory');
  mkdirSync(outputDirectory, { recursive: true });
  const temporary = mkdtempSync(path.join(outputDirectory, '.canonical-'));
  try {
    for (const name of readdirSync(sdkDirectory).sort()) {
      if (name === 'package.json' || name === 'dist' || /^(?:readme|licen[cs]e|copying|notice)(?:\.|$)/i.test(name)) {
        copyPackageFile(path.join(sdkDirectory, name), path.join(temporary, name));
      }
    }
    const packed = JSON.parse(execSync(`npm pack --ignore-scripts --json --pack-destination ${JSON.stringify(path.resolve(outputDirectory))}`, {
      cwd: temporary, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
    }));
    if (packed.length !== 1 || path.basename(packed[0].filename) !== packed[0].filename) throw new Error('Unexpected SDK pack output');
    const filename = packed[0].filename;
    const bytes = readFileSync(path.join(outputDirectory, filename));
    return { filename, sha256: createHash('sha256').update(bytes).digest('hex'),
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      files: packed[0].files.map(file => file.path) };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

/** Validate every consumer before writing any lock; updates are maintenance-only. */
export function verifyConsumerIntegrities(consumers, integrity, updateLocks = false) {
  const records = consumers.map(consumer => {
    const filename = path.join(consumer, 'package-lock.json');
    const lock = JSON.parse(readFileSync(filename, 'utf8'));
    const entry = lock.packages?.['node_modules/@yellowmind/observability'];
    if (!entry) throw new Error(`Missing SDK lock entry in ${filename}`);
    return { filename, lock, entry };
  });
  for (const record of records) {
    if (!updateLocks && record.entry.integrity !== integrity) {
      throw new Error(`SDK integrity mismatch in ${record.filename}; review SDK changes and run build-sdks.mjs --update-locks intentionally`);
    }
  }
  if (updateLocks) for (const record of records) {
    if (record.entry.integrity === integrity) continue;
    record.entry.integrity = integrity;
    writeFileSync(record.filename, JSON.stringify(record.lock, null, 2) + '\n');
  }
}
