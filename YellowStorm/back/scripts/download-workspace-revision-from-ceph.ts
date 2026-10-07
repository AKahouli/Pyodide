/**
 * Download a Conversation V2 workspace revision from Ceph into a local folder.
 *
 * Usage (from YellowStorm/back):
 *   npx ts-node scripts/download-workspace-revision-from-ceph.ts \
 *     --workspace 44c374dc2a6878384a47110a \
 *     --out "C:/Users/bader/Desktop/CEPH REVISION" \
 *     [--revision rev_15]
 *
 * If --revision is omitted, picks the highest rev_N under the workspace manifests.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

function env(name: string, fallback = ''): string {
  return (process.env[name] || fallback).trim();
}

function parseArgs(): { workspaceId: string; outDir: string; revisionId?: string } {
  const args = process.argv.slice(2);
  let workspaceId = '';
  let outDir = '';
  let revisionId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--workspace') workspaceId = args[++i] ?? '';
    else if (a === '--out') outDir = args[++i] ?? '';
    else if (a === '--revision') revisionId = args[++i];
  }
  if (!workspaceId || !outDir) {
    throw new Error('Usage: --workspace <id> --out <dir> [--revision rev_N]');
  }
  return { workspaceId, outDir, revisionId };
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === 'function') {
    return Buffer.from(await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray());
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  const { workspaceId, outDir, revisionId: requested } = parseArgs();

  const endpoint = env('CEPH_S3_ENDPOINT', env('CEPH_ENDPOINT', 'https://s3-v2.yellowsys.org'));
  const accessKeyId = env('CEPH_S3_ACCESS_KEY_ID', env('CEPH_ACCESS_KEY_ID'));
  const secretAccessKey = env('CEPH_S3_SECRET_ACCESS_KEY', env('CEPH_SECRET_ACCESS_KEY'));
  const bucket = env('CEPH_S3_BUCKET', env('CEPH_BUCKET_NAME', 'documents'));

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Missing Ceph credentials in .env');
  }

  const client = new S3Client({
    endpoint,
    region: env('CEPH_S3_REGION', 'us-east-1'),
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: env('CEPH_S3_FORCE_PATH_STYLE', 'true') !== 'false',
  });

  const prefix = `appbuilder/manifests/${workspaceId}/`;
  const listed = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
  );
  const keys = (listed.Contents ?? [])
    .map((o) => o.Key ?? '')
    .filter((k) => /\/rev_\d+\.json$/.test(k));

  if (!keys.length) {
    throw new Error(`No rev_*.json manifests under s3://${bucket}/${prefix}`);
  }

  const sorted = keys
    .map((k) => {
      const m = k.match(/\/(rev_(\d+))\.json$/);
      return { key: k, revisionId: m?.[1] ?? '', n: Number(m?.[2] ?? -1) };
    })
    .filter((x) => x.n >= 0)
    .sort((a, b) => a.n - b.n);

  console.log(
    'Available revisions:',
    sorted.map((s) => s.revisionId).join(', '),
  );

  let chosen = sorted[sorted.length - 1];
  if (requested) {
    const hit = sorted.find((s) => s.revisionId === requested);
    if (!hit) throw new Error(`Revision ${requested} not found`);
    chosen = hit;
  }

  console.log(`Downloading ${chosen.revisionId} → ${outDir}`);

  const manifestObj = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: chosen.key }),
  );
  const manifestBuf = await streamToBuffer(manifestObj.Body);
  const manifest = JSON.parse(manifestBuf.toString('utf8')) as {
    revisionId?: string;
    files?: Array<{ path: string; objectKey: string; sha256?: string; size?: number }>;
  };
  const files = manifest.files ?? [];
  if (!files.length) throw new Error('Manifest has no files[]');

  fs.mkdirSync(outDir, { recursive: true });
  // Clear previous download contents (keep the folder itself).
  for (const entry of fs.readdirSync(outDir)) {
    fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
  }

  fs.writeFileSync(path.join(outDir, '_manifest.json'), manifestBuf);
  fs.writeFileSync(
    path.join(outDir, '_meta.json'),
    JSON.stringify(
      {
        workspaceId,
        revisionId: chosen.revisionId,
        manifestKey: chosen.key,
        fileCount: files.length,
        downloadedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  let ok = 0;
  let failed = 0;
  for (const file of files) {
    const dest = path.join(outDir, file.path.replace(/\//g, path.sep));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      const obj = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: file.objectKey }),
      );
      const body = await streamToBuffer(obj.Body);
      fs.writeFileSync(dest, body);
      ok += 1;
      console.log('+', file.path, `(${body.length} bytes)`);
    } catch (err) {
      failed += 1;
      console.error('x', file.path, err instanceof Error ? err.message : err);
    }
  }

  console.log(`Done: ${ok} files ok, ${failed} failed, revision=${chosen.revisionId}`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
