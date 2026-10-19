import { S3Client } from '@aws-sdk/client-s3';
import { S3StorageBackend } from './s3.backend';

describe('S3 presigned create-only contract', () => {
  const config = { endpoint: 'https://storage.example.invalid', region: 'us-east-1', bucket: 'qa',
    accessKeyId: 'synthetic-qa-key', secretAccessKey: 'synthetic-qa-secret', forcePathStyle: true, publicUrl: '' };

  it('the actual SDK includes the precondition in signed headers', async () => {
    const client = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
    const backend = new S3StorageBackend(config, { warn: jest.fn(), log: jest.fn() });
    Object.assign(backend, { client });
    try {
      const protectedUrl = new URL(await backend.signedUrl('user/workspace/qa.png',
        { write: true, createOnly: true, expirySeconds: 60 }));
      expect(protectedUrl.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toContain('if-none-match');
      const ordinaryUrl = new URL(await backend.signedUrl('user/workspace/ordinary.png',
        { write: true, expirySeconds: 60 }));
      expect(ordinaryUrl.searchParams.get('X-Amz-SignedHeaders')?.split(';')).not.toContain('if-none-match');
      const readUrl = new URL(await backend.signedUrl('user/workspace/read.png',
        { write: false, createOnly: true, expirySeconds: 60 }));
      expect(readUrl.searchParams.get('X-Amz-SignedHeaders')?.split(';')).not.toContain('if-none-match');
    } finally { client.destroy(); }
  });
});
