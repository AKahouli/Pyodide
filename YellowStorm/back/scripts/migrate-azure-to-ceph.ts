/**
 * Migrate document blobs from Azure Blob Storage to Ceph S3 and rewrite the
 * `path` / `url` fields of workspace_documents to the new layout.
 *
 * Old Azure path: {userId}/{workspaceId}/{documentId}/{filename}
 * New Ceph path:  {userId}/{workspaceId}/{filename}
 *                 (documentId removed — uniqueness now enforced by
 *                  resolveUniqueOriginalName + partial UNIQUE index)
 *
 * Prerequisites:
 *   - Run dedupe-document-original-names.ts --apply BEFORE this script.
 *   - Azure credentials must be present (temporarily) in env:
 *       AZURE_STORAGE_CONNECTION_STRING
 *       AZURE_STORAGE_CONTAINER_NAME
 *   - Ceph credentials present in env (already configured for runtime):
 *       CEPH_S3_ENDPOINT, CEPH_S3_REGION, CEPH_S3_BUCKET,
 *       CEPH_S3_ACCESS_KEY_ID, CEPH_S3_SECRET_ACCESS_KEY,
 *       CEPH_S3_FORCE_PATH_STYLE, CEPH_S3_PUBLIC_URL
 *
 * Usage:
 *   npx ts-node back/scripts/migrate-azure-to-ceph.ts                 # dry-run
 *   npx ts-node back/scripts/migrate-azure-to-ceph.ts --apply         # copy + DB update
 *   npx ts-node back/scripts/migrate-azure-to-ceph.ts --apply --limit=10
 *
 * Idempotency: if the Ceph object already exists at the new key AND the DB
 * `path` is already updated, the document is skipped. Safe to re-run.
 */

import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { BlobServiceClient } from '@azure/storage-blob';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number.parseInt(limitArg.split('=')[1], 10) : 0;

const mongodbUri = process.env.MONGODB_URI;
const azureConn = process.env.AZURE_STORAGE_CONNECTION_STRING;
const azureContainer = process.env.AZURE_STORAGE_CONTAINER_NAME;
const cephEndpoint = process.env.CEPH_S3_ENDPOINT;
const cephRegion = process.env.CEPH_S3_REGION || 'us-east-1';
const cephBucket = process.env.CEPH_S3_BUCKET;
const cephAccess = process.env.CEPH_S3_ACCESS_KEY_ID;
const cephSecret = process.env.CEPH_S3_SECRET_ACCESS_KEY;
const cephForcePath = process.env.CEPH_S3_FORCE_PATH_STYLE !== 'false';
const cephPublicUrl = process.env.CEPH_S3_PUBLIC_URL || cephEndpoint || '';

for (const [k, v] of Object.entries({
  MONGODB_URI: mongodbUri,
  AZURE_STORAGE_CONNECTION_STRING: azureConn,
  AZURE_STORAGE_CONTAINER_NAME: azureContainer,
  CEPH_S3_ENDPOINT: cephEndpoint,
  CEPH_S3_BUCKET: cephBucket,
  CEPH_S3_ACCESS_KEY_ID: cephAccess,
  CEPH_S3_SECRET_ACCESS_KEY: cephSecret,
})) {
  if (!v) {
    console.error(`Missing required env var: ${k}`);
    process.exit(1);
  }
}

interface DocRow {
  _id: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  originalName: string;
  path?: string;
  filename?: string;
  isFolder?: boolean;
}

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[/\\:\0]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .replace(/[_\s]+/g, '_')
    .substring(0, 255);
}

async function main(): Promise<void> {
  console.log(`Mode: ${APPLY ? 'APPLY (copy + DB update)' : 'DRY-RUN (no changes)'}`);
  if (LIMIT) console.log(`Limit: ${LIMIT} document(s)`);

  await mongoose.connect(mongodbUri!);
  const db = mongoose.connection.db!;
  const collection = db.collection<DocRow>('workspace_documents');

  const blobService = BlobServiceClient.fromConnectionString(azureConn!);
  const containerClient = blobService.getContainerClient(azureContainer!);

  const s3 = new S3Client({
    endpoint: cephEndpoint,
    region: cephRegion,
    credentials: { accessKeyId: cephAccess!, secretAccessKey: cephSecret! },
    forcePathStyle: cephForcePath,
  });

  const query: Record<string, unknown> = { isFolder: { $ne: true }, path: { $exists: true, $ne: null } };
  const cursor = collection.find(query);
  if (LIMIT) cursor.limit(LIMIT);

  let processed = 0;
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for await (const doc of cursor) {
    processed++;
    const oldPath = doc.path!;
    const newPath = `${doc.createdBy}/${doc.workspaceId}/${sanitizeFilename(doc.originalName)}`;

    // Skip if already migrated (DB path matches new layout)
    if (oldPath === newPath) {
      console.log(`SKIP   ${doc._id} already at new path: ${newPath}`);
      skipped++;
      continue;
    }

    try {
      // Idempotent check on Ceph side
      let cephExists = false;
      try {
        await s3.send(new HeadObjectCommand({ Bucket: cephBucket!, Key: newPath }));
        cephExists = true;
      } catch (e: unknown) {
        const err = e as { $metadata?: { httpStatusCode?: number }; name?: string };
        if (err.$metadata?.httpStatusCode !== 404 && err.name !== 'NotFound') {
          throw e;
        }
      }

      if (cephExists) {
        console.log(`COPY-SKIP ${doc._id} object already in Ceph at ${newPath} — will only update DB`);
      } else {
        console.log(`COPY      ${doc._id}: azure[${oldPath}] -> ceph[${newPath}]`);
        if (APPLY) {
          const blobClient = containerClient.getBlobClient(oldPath);
          const dl = await blobClient.download();
          const chunks: Buffer[] = [];
          for await (const chunk of dl.readableStreamBody as NodeJS.ReadableStream) {
            chunks.push(Buffer.from(chunk));
          }
          const body = Buffer.concat(chunks);

          await s3.send(
            new PutObjectCommand({
              Bucket: cephBucket!,
              Key: newPath,
              Body: body,
              ContentType: dl.contentType || 'application/octet-stream',
            }),
          );
        }
      }

      const newUrl = `${cephPublicUrl.replace(/\/+$/, '')}/${cephBucket}/${newPath}`;
      console.log(`DB-UPDATE ${doc._id}: path -> ${newPath}, url -> ${newUrl}`);
      if (APPLY) {
        await collection.updateOne(
          { _id: doc._id },
          { $set: { path: newPath, url: newUrl } },
        );
      }
      migrated++;
    } catch (err) {
      failed++;
      console.error(`FAIL   ${doc._id} (${oldPath}):`, (err as Error).message);
    }
  }

  console.log(
    `\nDone. processed=${processed} migrated=${migrated} skipped=${skipped} failed=${failed} mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`,
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
