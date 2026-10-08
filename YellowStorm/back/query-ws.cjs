const fs = require('fs');
const mongoose = require('mongoose');

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

(async () => {
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  const db = mongoose.connection.db;

  const ws = await db.collection('workspaces')
    .find({ _id: new mongoose.Types.ObjectId('6aad0864f796c89f0326f213') },
      { projection: { name: 1, ownerId: 1, createdAt: 1, syncStatus: 1 } })
    .toArray();
  console.log('== WORKSPACE ==', JSON.stringify(ws, null, 1));

  const docs = await db.collection('workspace_documents')
    .find({ workspaceId: new mongoose.Types.ObjectId('6aad0864f796c89f0326f213') },
      { projection: { filename: 1, mimeType: 1, status: 1, createdAt: 1, size: 1 } })
    .toArray();
  console.log('== DOCUMENTS ==', JSON.stringify(docs, null, 1));

  await mongoose.disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });