import { createHash, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { SemanticAssetGrantService, type AssetExecutionProof } from './semantic-asset-grant.service';
import { WorkspaceAssetInternalController } from '@modules/workspace/workspace-asset-internal.controller';
import { Readable, Writable } from 'node:stream';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const actor = '6512f0a1c9e77a001234ccc3';
const source = { workspaceId: '6512f0a1c9e77a001234aaa1', assetId: '6512f0a1c9e77a001234bbb2' };
const proof: AssetExecutionProof = { jobId: '11111111-1111-1111-1111-111111111111', taskId: 7,
  leaseEpoch: 2, leaseOwner: 'worker', capability: 'a'.repeat(64) };

async function setup(purpose: 'discovery' | 'population' = 'discovery', scopes: Record<string, unknown>[] = [{}]) {
  const model = purpose === 'population' ? '22222222-2222-2222-2222-222222222222' : null;
  const documents = { findById: jest.fn().mockResolvedValue({ contentHash: 'original-hash', size: 4 }) };
  const shares = { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) };
  const users = { findById: jest.fn().mockResolvedValue({ status: 'active' }) };
  const models = { requireRole: jest.fn().mockResolvedValue({}), requireActiveRole: jest.fn().mockResolvedValue({}) };
  const access = { assertSourceReadable: jest.fn().mockResolvedValue(undefined) };
  const database = { query: jest.fn() };
  const service = new SemanticAssetGrantService({} as never, database as never, shares as never,
    documents as never, users as never, models as never, access as never);
  jest.spyOn(service as unknown as { key(): KeyObject }, 'key').mockReturnValue(privateKey);
  const command = { actorUserId: actor, modelId: model, workspaceId: source.workspaceId,
    payload: purpose === 'discovery' ? { source, options: scopes[0] } : { sources: scopes.map(options => ({ source, options })) } };
  const admission = await service.admit(actor, model, purpose, [source], 'canonical-admission-key', command);
  proof.jobId = JSON.parse(Buffer.from(admission.split('.')[1], 'base64url').toString()).body.nonce;
  const task = { actor, model, jobType: purpose === 'population' ? 'population.run' : 'datasource.discovery',
    createdAt: new Date(), command: { ...command, payload: { ...command.payload, assetAdmission: admission, assetCommand: JSON.stringify(command) } } };
  database.query.mockImplementation(async (_sql: string, values: unknown[]) => ({ rows:
    values[0] === proof.taskId && values[1] === proof.jobId && values[2] === proof.leaseEpoch
    && values[3] === proof.leaseOwner && values[4] === createHash('sha256').update(proof.capability).digest('hex') ? [task] : [] }));
  return { service, database, documents, shares, users, models, access, task, admission };
}

describe('SemanticAssetGrantService live execution authority', () => {
  it('binds a five-minute grant to exact operation, source and live claim digest', async () => {
    const f = await setup();
    const { token } = await f.service.issue(proof, source.workspaceId, source.assetId, 'read');
    expect(await f.service.check(token, source.workspaceId, source.assetId, 'read')).toBe(actor);
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    expect(header).toEqual({ alg: 'RS256', typ: 'semantic-asset-grant' });
    const body = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).body;
    expect(body.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(300);
    expect(f.database.query.mock.calls[0][0]).toContain("t.checkpoint->>'assetCapabilityDigest'=$5");
    expect(f.database.query.mock.calls[0][0]).toContain("j.state='running'");
    expect(f.database.query.mock.calls[0][0]).toContain('t.lease_expires_at>now()');
    expect(JSON.stringify(f.database.query.mock.calls)).not.toContain(proof.capability);
    await expect(f.service.check(token, source.workspaceId, source.assetId, 'metadata')).rejects.toThrow();
    await expect(f.service.check(token, source.workspaceId, 'another-source', 'read')).rejects.toThrow();
    await expect(f.service.check(f.admission, source.workspaceId, source.assetId, 'read')).rejects.toThrow();
  });

  it.each(['taskId', 'leaseEpoch', 'leaseOwner', 'jobId', 'capability'] as const)('rejects a forged or reclaimed %s even with valid admission', async field => {
    const f = await setup();
    const changed = { ...proof, [field]: field === 'taskId' ? 99 : field === 'leaseEpoch' ? 3 : field === 'jobId'
      ? '33333333-3333-3333-3333-333333333333' : field === 'capability' ? 'b'.repeat(64) : 'other-worker' };
    await expect(f.service.issue(changed, source.workspaceId, source.assetId, 'read')).rejects.toThrow();
  });

  it('reauthorizes existing grants after cancellation, content change and workspace revocation', async () => {
    const f = await setup();
    const { token } = await f.service.issue(proof, source.workspaceId, source.assetId, 'read');
    f.database.query.mockResolvedValueOnce({ rows: [] });
    await expect(f.service.check(token, source.workspaceId, source.assetId, 'read')).rejects.toThrow();
    f.documents.findById.mockResolvedValueOnce({ contentHash: 'replacement', size: 4 });
    await expect(f.service.check(token, source.workspaceId, source.assetId, 'read')).rejects.toThrow('content changed');
    f.shares.assertUserHasAccess.mockRejectedValueOnce(new Error('revoked'));
    await expect(f.service.check(token, source.workspaceId, source.assetId, 'read')).rejects.toThrow('revoked');
  });

  it('denies expired grants and suspended users independently of the service principal', async () => {
    const f = await setup();
    const { token } = await f.service.issue(proof, source.workspaceId, source.assetId, 'read');
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 301000);
    await expect(f.service.check(token, source.workspaceId, source.assetId, 'read')).rejects.toThrow();
    clock.mockRestore();
    f.users.findById.mockResolvedValueOnce({ status: 'suspended' });
    await expect(f.service.check(token, source.workspaceId, source.assetId, 'read')).rejects.toThrow();
  });

  it('does not trust unsigned actor, model, source or admission substitutions', async () => {
    const f = await setup();
    f.task.actor = 'forged-actor';
    await expect(f.service.issue(proof, source.workspaceId, source.assetId, 'read')).rejects.toThrow();
    f.task.actor = actor;
    f.task.model = 'forged-model';
    await expect(f.service.issue(proof, source.workspaceId, source.assetId, 'read')).rejects.toThrow();
    f.task.model = null;
    f.task.command.payload.assetAdmission = 'unsigned-createdBy-is-not-authority';
    await expect(f.service.issue(proof, source.workspaceId, source.assetId, 'read')).rejects.toThrow();
  });

  it('permits model-less profiling but not derived-document publication', async () => {
    const f = await setup();
    await expect(f.service.issue(proof, source.workspaceId, source.assetId, 'dataset-put', { datasetId: 'ds_' + 'a'.repeat(24) })).resolves.toHaveProperty('token');
    await expect(f.service.issue(proof, source.workspaceId, source.assetId, 'derived-put')).rejects.toThrow();
    expect(f.models.requireRole).not.toHaveBeenCalled();
    await expect(f.service.admit(actor, null, 'population', [source], 'key', {})).rejects.toThrow();
  });

  it('population refresh checks current model role and enabled source link again', async () => {
    const f = await setup('population');
    const { token } = await f.service.issue(proof, source.workspaceId, source.assetId, 'derived-put', { fileName: 'derived.txt' });
    f.access.assertSourceReadable.mockRejectedValueOnce(new Error('source link disabled'));
    await expect(f.service.check(token, source.workspaceId, source.assetId, 'derived-put', { fileName: 'derived.txt' })).rejects.toThrow('source link disabled');
    f.models.requireActiveRole.mockRejectedValueOnce(new Error('model membership revoked'));
    await expect(f.service.check(token, source.workspaceId, source.assetId, 'derived-put', { fileName: 'derived.txt' })).rejects.toThrow('model membership revoked');
  });

  it('denies archived models at admission, grant issuance and previously minted grant use', async () => {
    const f = await setup('population');
    const { token } = await f.service.issue(proof, source.workspaceId, source.assetId, 'read');
    f.models.requireActiveRole.mockRejectedValue(new Error('model archived'));
    await expect(f.service.admit(actor, f.task.model, 'population', [source], 'another-key', {})).rejects.toThrow('model archived');
    await expect(f.service.issue(proof, source.workspaceId, source.assetId, 'read')).rejects.toThrow('model archived');
    await expect(f.service.check(token, source.workspaceId, source.assetId, 'read')).rejects.toThrow('model archived');
  });

  it('rejects a copied admission in a fresh live job even after the original was cancelled', async () => {
    const f = await setup();
    // Model an independently admitted task with the same actor/source and a live
    // fresh capability: only its canonical UUID distinguishes the replay.
    const replay = { ...proof, jobId: '44444444-4444-4444-4444-444444444444' };
    f.database.query.mockResolvedValue({ rows: [f.task] });
    await expect(f.service.issue(replay, source.workspaceId, source.assetId, 'read')).rejects.toThrow('admission mismatch');
  });

  it('requires job creation inside the finite signed admission window', async () => {
    const f = await setup();
    f.task.createdAt = new Date(Date.now() + 301000);
    await expect(f.service.issue(proof, source.workspaceId, source.assetId, 'read')).rejects.toThrow('admission mismatch');
    f.task.createdAt = new Date(Date.now() - 10000);
    await expect(f.service.issue(proof, source.workspaceId, source.assetId, 'read')).rejects.toThrow('admission mismatch');
  });

  it('rejects altered signed command options and source scope', async () => {
    const f = await setup();
    f.task.command.payload.options = { sheetName: 'unsigned-sheet' };
    await expect(f.service.issue(proof, source.workspaceId, source.assetId, 'read')).rejects.toThrow('scope changed');
  });

  it('signs different UUIDs and exact command scopes for each mapped source-event sheet', async () => {
    const f = await setup();
    f.database.query.mockResolvedValueOnce({ rows: [{ sheet: 'one' }, { sheet: 'two' }] });
    const occurredAt = new Date('2026-10-18T12:00:00Z').toISOString();
    const admissions = await f.service.admitSourceEvent('event', occurredAt, {
      ...source, documentId: source.assetId, createdBy: actor, contentHash: 'original-hash', mimeType: 'text/csv' });
    const bodies = Object.values(admissions).map(token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).body);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].nonce).not.toBe(bodies[1].nonce);
    expect(bodies.map(body => JSON.parse(body.command).payload.options.sheetName)).toEqual(['one', 'two']);
    expect(bodies.map(body => JSON.parse(body.command).payload.source.uploadedAt))
      .toEqual(['2026-10-18T12:00:00.000Z', '2026-10-18T12:00:00.000Z']);
    expect(bodies.every(body => body.exp - body.iat === 300)).toBe(true);
  });

  it.each(['dataset-put', 'dataset-get', 'derived-put'] as const)('binds the exact %s selector and denies substitution before storage', async operation => {
    const f = await setup('population');
    const datasetId = 'ds_' + 'a'.repeat(24);
    const target = operation === 'derived-put' ? { fileName: 'allowed.txt' } : { datasetId };
    const { token } = await f.service.issue(proof, source.workspaceId, source.assetId, operation, target);
    await expect(f.service.check(token, source.workspaceId, source.assetId, operation, target)).resolves.toBe(actor);
    const storage = { putStream: jest.fn(), openReadStream: jest.fn() };
    const writer = { storeDerivedFile: jest.fn() };
    const documents = { findById: jest.fn().mockResolvedValue({ status: 'completed', isFolder: false }) };
    const controller = new WorkspaceAssetInternalController({} as never, documents as never, storage as never,
      { get: (_key: string, fallback: unknown) => fallback } as never, writer as never, f.service);
    const query = { actorUserId: actor, workspaceId: source.workspaceId, documentId: source.assetId,
      datasetId: 'ds_' + 'b'.repeat(24), fileName: 'not-allowed.txt' };
    const attempt = operation === 'dataset-put' ? controller.putDataset(query, '4', 'a'.repeat(64), Readable.from([]) as never, token)
      : operation === 'dataset-get' ? controller.dataset(query, {} as never, token)
      : controller.putDerivedFile(query, 'text/plain', '4', 'a'.repeat(64), Readable.from([]) as never, token);
    await expect(attempt).rejects.toThrow('target');
    expect(documents.findById).not.toHaveBeenCalled();
    expect(storage.putStream).not.toHaveBeenCalled();
    expect(storage.openReadStream).not.toHaveBeenCalled();
    expect(writer.storeDerivedFile).not.toHaveBeenCalled();
  });

  it('isolates identical logical dataset IDs by canonical job, attempt, source version and admitted options', async () => {
    const f = await setup('population', [{ sheetName: 'one' }, { sheetName: 'two' }]);
    const datasetId = 'ds_' + 'a'.repeat(24);
    await expect(f.service.issue(proof, source.workspaceId, source.assetId, 'dataset-put', { datasetId })).rejects.toThrow('Options');
    await expect(f.service.issue(proof, source.workspaceId, source.assetId, 'dataset-put', { datasetId, options: { sheetName: 'unsigned' } })).rejects.toThrow('Options');
    const first = await f.service.issue(proof, source.workspaceId, source.assetId, 'dataset-put', { datasetId, options: { sheetName: 'one' } });
    const second = await f.service.issue(proof, source.workspaceId, source.assetId, 'dataset-put', { datasetId, options: { sheetName: 'two' } });
    const namespace = f.service.storageNamespace(first.token);
    expect(namespace).not.toBe(f.service.storageNamespace(second.token));
    expect(namespace).toContain(`/${proof.jobId}/${proof.leaseEpoch}/`);
    expect(namespace).toContain(createHash('sha256').update('original-hash').digest('hex'));
    proof.leaseEpoch += 1;
    try {
      const reclaimed = await f.service.issue(proof, source.workspaceId, source.assetId, 'dataset-put', { datasetId, options: { sheetName: 'one' } });
      expect(namespace).not.toBe(f.service.storageNamespace(reclaimed.token));
      await expect(f.service.check(first.token, source.workspaceId, source.assetId, 'dataset-put', { datasetId })).rejects.toThrow();
    } finally { proof.leaseEpoch -= 1; }
    const other = await setup('population', [{ sheetName: 'one' }]);
    const otherGrant = await other.service.issue(proof, source.workspaceId, source.assetId, 'dataset-put', { datasetId });
    expect(namespace).not.toBe(other.service.storageNamespace(otherGrant.token));
  });

  it('requires storage targets at issuance and rejects path-like derived names', async () => {
    const f = await setup('population');
    await expect(f.service.issue(proof, source.workspaceId, source.assetId, 'dataset-put')).rejects.toThrow('target');
    await expect(f.service.issue(proof, source.workspaceId, source.assetId, 'dataset-get', { datasetId: 'arbitrary' })).rejects.toThrow('target');
    await expect(f.service.issue(proof, source.workspaceId, source.assetId, 'derived-put', { fileName: '../other.txt' })).rejects.toThrow('target');
  });

  it('writes and reads only the verified attempt namespace, with no legacy-key fallback on reclaim', async () => {
    const f = await setup();
    const datasetId = 'ds_' + 'a'.repeat(24);
    const target = { datasetId };
    const put = await f.service.issue(proof, source.workspaceId, source.assetId, 'dataset-put', target);
    const get = await f.service.issue(proof, source.workspaceId, source.assetId, 'dataset-get', target);
    const namespace = f.service.storageNamespace(put.token);
    const expectedKey = `semantic-model/datasets/${source.workspaceId}/${source.assetId}/${namespace}/${datasetId}.parquet`;
    const stored = new Map<string, Buffer>();
    const storage = {
      putStream: jest.fn(async (key: string) => { stored.set(key, Buffer.from('PAR1')); }),
      openReadStream: jest.fn(async (key: string) => {
        const bytes = stored.get(key);
        if (!bytes) throw new Error('scoped dataset missing');
        return { body: Readable.from([bytes]), contentType: 'application/vnd.apache.parquet', contentLength: 4,
          metadata: { sha256: 'a'.repeat(64), datasetid: datasetId } };
      }),
    };
    const documents = { findById: jest.fn().mockResolvedValue({ status: 'completed', isFolder: false }) };
    const controller = new WorkspaceAssetInternalController({} as never, documents as never, storage as never,
      { get: (_key: string, fallback: unknown) => fallback } as never, {} as never, f.service);
    const query = { actorUserId: actor, workspaceId: source.workspaceId, documentId: source.assetId, datasetId };
    await controller.putDataset(query, '4', 'a'.repeat(64), Readable.from(['PAR1']) as never, put.token);
    expect([...stored.keys()]).toEqual([expectedKey]);
    const chunks: Buffer[] = [];
    const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
    Object.assign(sink, { status: jest.fn().mockReturnValue(sink), setHeader: jest.fn() });
    await controller.dataset(query, sink as never, get.token);
    expect(Buffer.concat(chunks).toString()).toBe('PAR1');
    expect(storage.openReadStream).toHaveBeenLastCalledWith(expectedKey);
    proof.leaseEpoch += 1;
    try {
      const reclaimed = await f.service.issue(proof, source.workspaceId, source.assetId, 'dataset-get', target);
      storage.openReadStream.mockClear();
      await expect(controller.dataset(query, sink as never, reclaimed.token)).rejects.toThrow('scoped dataset missing');
      expect(storage.openReadStream).toHaveBeenCalledTimes(1);
      expect(storage.openReadStream.mock.calls[0][0]).not.toBe(expectedKey);
    } finally { proof.leaseEpoch -= 1; }
  });

  it('namespaces derived document names before the writer global-name deduplication boundary', async () => {
    const f = await setup('population');
    const fileName = 'message.txt';
    const { token } = await f.service.issue(proof, source.workspaceId, source.assetId, 'derived-put', { fileName });
    const namespace = f.service.storageNamespace(token);
    const namespaceHash = createHash('sha256').update(namespace).digest('hex');
    const writer = { storeDerivedFile: jest.fn().mockResolvedValue({ document: { id: 'derived-id', originalName: 'stored', indexingStatus: 'pending' }, created: true }) };
    const documents = { findById: jest.fn().mockResolvedValue({ id: source.assetId, status: 'completed', isFolder: false, mimeType: 'application/zip' }) };
    const controller = new WorkspaceAssetInternalController({} as never, documents as never, {} as never,
      { get: (_key: string, fallback: unknown) => fallback } as never, writer as never, f.service);
    const bytes = Buffer.from('text');
    await controller.putDerivedFile({ actorUserId: actor, workspaceId: source.workspaceId, documentId: source.assetId, fileName },
      'text/plain', String(bytes.length), createHash('sha256').update(bytes).digest('hex'), Readable.from([bytes]) as never, token);
    expect(writer.storeDerivedFile).toHaveBeenCalledWith(expect.objectContaining({ sourceDocumentId: source.assetId,
      sourceName: `${source.assetId}_${namespaceHash}`,
      fileName: `${namespaceHash}_${createHash('sha256').update(fileName).digest('hex').slice(0, 24)}_${fileName}` }));
  });
});
