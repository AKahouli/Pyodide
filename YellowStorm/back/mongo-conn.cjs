const fs = require('fs');
const mongoose = require('mongoose');
const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
(async () => {
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  const db = mongoose.connection.db;
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  console.log('collections with connector/tool/skill:', collections.map((c) => c.name).filter((n) => /connector|tool|skill/.test(n)).join(', '));
  const conns = await db.collection('connectors').find({ _id: new mongoose.Types.ObjectId('6a8ee76d4db4ebc5565d11d6') }).toArray();
  if (conns.length) {
    const c = conns[0];
    const keys = Object.keys(c).filter((k) => !['auth', 'auth_config', 'credentials', 'secret'].some((s) => k.toLowerCase().includes(s)));
    const sanitized = {};
    for (const k of keys) {
      let v = c[k];
      if (typeof v === 'string' && v.length > 300) v = v.slice(0, 300) + '...';
      sanitized[k] = v;
    }
    console.log('connector:', JSON.stringify(sanitized, null, 1));
  } else {
    console.log('connector not found in mongo "connectors"');
  }
  await mongoose.disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });