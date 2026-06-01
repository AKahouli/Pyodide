/**
 * Dedupe workspace_documents on (workspaceId, originalName) for files (isFolder: false).
 *
 * Why: the Ceph storage migration adds a UNIQUE partial index on
 * { workspaceId, originalName } filtered by { isFolder: false }. Existing
 * data may contain duplicates that would block index creation. This script
 * applies Windows-Explorer-style auto-rename to extras so the index can be
 * built afterwards.
 *
 * Usage:
 *   npx ts-node back/scripts/dedupe-document-original-names.ts            # dry-run (default)
 *   npx ts-node back/scripts/dedupe-document-original-names.ts --apply    # write changes
 *
 * Strategy: for each (workspaceId, originalName) group of files, keep the
 * oldest (by createdAt) untouched and rename the rest to "name (1).ext",
 * "name (2).ext", etc. — probing until a free slot is found.
 */

import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const APPLY = process.argv.includes('--apply');

const mongodbUri = process.env.MONGODB_URI;
if (!mongodbUri) {
  console.error('MONGODB_URI is required in .env');
  process.exit(1);
}

interface DocLite {
  _id: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  originalName: string;
  createdAt: Date;
}

function splitExt(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0 && dot < name.length - 1;
  return hasExt
    ? { base: name.slice(0, dot), ext: name.slice(dot) }
    : { base: name, ext: '' };
}

async function main(): Promise<void> {
  console.log(`Mode: ${APPLY ? 'APPLY (writing changes)' : 'DRY-RUN (no changes)'}`);
  await mongoose.connect(mongodbUri!);
  const db = mongoose.connection.db!;
  const collection = db.collection('workspace_documents');

  // Group files by (workspaceId, originalName) where there are 2+ matches.
  const duplicates = await collection
    .aggregate<{ _id: { workspaceId: mongoose.Types.ObjectId; originalName: string }; count: number; docs: DocLite[] }>([
      { $match: { isFolder: { $ne: true } } },
      {
        $group: {
          _id: { workspaceId: '$workspaceId', originalName: '$originalName' },
          count: { $sum: 1 },
          docs: { $push: { _id: '$_id', workspaceId: '$workspaceId', originalName: '$originalName', createdAt: '$createdAt' } },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  console.log(`Found ${duplicates.length} duplicate group(s).`);

  let renamedCount = 0;
  for (const group of duplicates) {
    const { workspaceId, originalName } = group._id;
    const sorted = [...group.docs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const [keeper, ...rest] = sorted;
    console.log(
      `\nworkspace=${workspaceId} name="${originalName}" (${group.count} duplicates)\n  KEEP   ${keeper._id} (createdAt=${keeper.createdAt.toISOString()})`,
    );

    const { base, ext } = splitExt(originalName);

    for (const doc of rest) {
      let candidate = '';
      for (let n = 1; n <= 9999; n++) {
        candidate = `${base} (${n})${ext}`;
        // Check candidate availability — must be free both in the DB AND not already
        // taken by a previously-renamed sibling in this same pass.
        const taken = await collection.findOne(
          { workspaceId, originalName: candidate, isFolder: { $ne: true } },
          { projection: { _id: 1 } },
        );
        if (!taken) break;
        candidate = '';
      }
      if (!candidate) {
        console.error(`  FAIL   ${doc._id}: could not find a free slot under 9999 attempts`);
        continue;
      }

      console.log(`  RENAME ${doc._id} -> "${candidate}"`);
      if (APPLY) {
        await collection.updateOne({ _id: doc._id }, { $set: { originalName: candidate } });
      }
      renamedCount++;
    }
  }

  console.log(
    `\nDone. ${renamedCount} document(s) ${APPLY ? 'renamed' : 'would be renamed'}.`,
  );
  if (!APPLY && renamedCount > 0) {
    console.log('Re-run with --apply to commit changes.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
