const fs = require('fs');
const { S3Client, ListObjectsV2Command, HeadObjectCommand } = require('@aws-sdk/client-s3');
const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
(async () => {
  const client = new S3Client({
    endpoint: env.CEPH_S3_ENDPOINT,
    region: env.CEPH_S3_REGION,
    credentials: { accessKeyId: env.CEPH_S3_ACCESS_KEY_ID, secretAccessKey: env.CEPH_S3_SECRET_ACCESS_KEY },
    forcePathStyle: env.CEPH_S3_FORCE_PATH_STYLE === 'true',
  });
  const bucket = env.CEPH_S3_BUCKET;
  const prefix = '6a882923cf9dc9f83740e759/finbench';
  try {
    const list = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1000 }));
    console.log('KEY COUNT under prefix:', (list.Contents || []).length);
    for (const o of (list.Contents || [])) console.log('  ', o.Key, o.Size);
  } catch (e) {
    console.log('LIST ERR:', e.name, e.message);
  }
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: prefix + '/3M_2018_10K.pdf' }));
    console.log('HEAD 3M pdf OK, size', head.ContentLength);
  } catch (e) {
    console.log('HEAD ERR:', e.name, e.message);
  }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });