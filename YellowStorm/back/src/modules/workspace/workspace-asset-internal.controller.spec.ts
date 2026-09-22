import { Readable, Writable } from 'stream';
import { ConflictException, PayloadTooLargeException } from '@nestjs/common';
import { WorkspaceAssetInternalController } from './workspace-asset-internal.controller';

const query = {
  actorUserId: '6512f0a1c9e77a001234aaa1',
  workspaceId: '6512f0a1c9e77a001234bbb2',
  documentId: '6512f0a1c9e77a001234ccc3',
};

const document = {
  id: query.documentId,
  workspaceId: query.workspaceId,
  path: 'owner/workspace/report.csv',
  mimeType: 'text/csv',
  size: 7,
  status: 'completed',
  isFolder: false,
  indexingStatus: 'ready',
  contentHash: '0123456789abcdef0123456789abcdef',
  uploadedAt: '2026-09-20T12:00:00.000Z',
  originalName: 'report.csv',
  createdBy: query.actorUserId,
};
const config = { get: jest.fn((_key: string, fallback: unknown) => fallback) };

function responseSink() {
  const chunks: Buffer[] = [];
  const response = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  }) as Writable & Record<string, any>;
  response.status = jest.fn().mockReturnValue(response);
  response.setHeader = jest.fn();
  response.on = Writable.prototype.on.bind(response);
  return { response, chunks };
}

describe('WorkspaceAssetInternalController', () => {
  it('reauthorizes and returns authoritative metadata without touching storage', async () => {
    const shares = { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) };
    const documents = { findById: jest.fn().mockResolvedValue(document) };
    const storage = { openReadStream: jest.fn() };
    const result = await new WorkspaceAssetInternalController(
      shares as any, documents as any, storage as any, config as any,
    ).metadata(query);

    expect(result).toMatchObject({
      workspaceId: query.workspaceId,
      assetId: query.documentId,
      originalName: 'report.csv',
      uploaderUserId: query.actorUserId,
      contentHash: document.contentHash,
    });
    expect(storage.openReadStream).not.toHaveBeenCalled();
  });

  it('authorizes and streams an identity-bound asset with authoritative headers', async () => {
    const shares = { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) };
    const documents = { findById: jest.fn().mockResolvedValue(document) };
    const storage = { openReadStream: jest.fn().mockResolvedValue({
      body: Readable.from(['a,b\n1,2']), contentType: 'text/csv', contentLength: 7,
    }) };
    const { response, chunks } = responseSink();

    await new WorkspaceAssetInternalController(shares as any, documents as any, storage as any, config as any)
      .content(query, response as any);

    expect(shares.assertUserHasAccess).toHaveBeenCalledWith(query.actorUserId, [query.workspaceId]);
    expect(documents.findById).toHaveBeenCalledWith(query.workspaceId, query.documentId);
    expect(storage.openReadStream).toHaveBeenCalledWith(document.path);
    expect(response.setHeader).toHaveBeenCalledWith('X-YellowStorm-Asset-Id', query.documentId);
    expect(response.setHeader).toHaveBeenCalledWith('X-YellowStorm-Content-Hash', document.contentHash);
    expect(Buffer.concat(chunks).toString()).toBe('a,b\n1,2');
  });

  it('does not touch storage when authorization fails', async () => {
    const denied = new Error('forbidden');
    const shares = { assertUserHasAccess: jest.fn().mockRejectedValue(denied) };
    const documents = { findById: jest.fn() };
    const storage = { openReadStream: jest.fn() };

    await expect(new WorkspaceAssetInternalController(shares as any, documents as any, storage as any, config as any)
      .content(query, responseSink().response as any)).rejects.toBe(denied);
    expect(documents.findById).not.toHaveBeenCalled();
    expect(storage.openReadStream).not.toHaveBeenCalled();
  });

  it('rejects oversized records before opening storage', async () => {
    const shares = { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) };
    const documents = { findById: jest.fn().mockResolvedValue({ ...document, size: 50 * 1024 * 1024 + 1 }) };
    const storage = { openReadStream: jest.fn() };

    await expect(new WorkspaceAssetInternalController(shares as any, documents as any, storage as any, config as any)
      .content(query, responseSink().response as any)).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(storage.openReadStream).not.toHaveBeenCalled();
  });

  it('rejects a storage length that no longer matches the Workspace record', async () => {
    const body = Readable.from(['changed']);
    const shares = { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) };
    const documents = { findById: jest.fn().mockResolvedValue(document) };
    const storage = { openReadStream: jest.fn().mockResolvedValue({ body, contentLength: 8 }) };

    await expect(new WorkspaceAssetInternalController(shares as any, documents as any, storage as any, config as any)
      .content(query, responseSink().response as any)).rejects.toBeInstanceOf(ConflictException);
    expect(body.destroyed).toBe(true);
  });

  it('streams a prepared dataset to the configured identity-derived prefix', async () => {
    const shares = { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) };
    const documents = { findById: jest.fn().mockResolvedValue(document) };
    const storage = { putStream: jest.fn().mockResolvedValue(undefined) };
    const configured = { get: jest.fn((key: string, fallback: unknown) =>
      key === 'storage.semanticDatasetPrefix' ? 'private/semantic-data' : fallback) };
    const request = Readable.from(['PAR1']) as any;
    const datasetId = 'ds_0123456789abcdef01234567';
    const hash = 'a'.repeat(64);

    const result = await new WorkspaceAssetInternalController(
      shares as any, documents as any, storage as any, configured as any,
    ).putDataset({ ...query, datasetId }, '4', hash, request);

    expect(storage.putStream).toHaveBeenCalledWith(
      `private/semantic-data/${query.workspaceId}/${query.documentId}/${datasetId}.parquet`,
      request,
      'application/vnd.apache.parquet',
      4,
      { sha256: hash, datasetid: datasetId },
    );
    expect(result).toEqual({ datasetId, sizeBytes: 4, contentHash: `sha256:${hash}` });
  });

  it('rejects a dataset without a valid size before storage', async () => {
    const shares = { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) };
    const documents = { findById: jest.fn().mockResolvedValue(document) };
    const storage = { putStream: jest.fn() };
    const controller = new WorkspaceAssetInternalController(
      shares as any, documents as any, storage as any, config as any,
    );
    await expect(controller.putDataset(
      { ...query, datasetId: 'ds_0123456789abcdef01234567' },
      undefined,
      'a'.repeat(64),
      Readable.from([]) as any,
    )).rejects.toThrow('Content-Length');
    expect(storage.putStream).not.toHaveBeenCalled();
  });

  it('authorizes and streams an identity-bound prepared dataset', async () => {
    const shares = { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) };
    const documents = { findById: jest.fn().mockResolvedValue(document) };
    const datasetId = 'ds_0123456789abcdef01234567';
    const hash = 'a'.repeat(64);
    const storage = { openReadStream: jest.fn().mockResolvedValue({
      body: Readable.from(['PAR1']),
      contentType: 'application/vnd.apache.parquet',
      contentLength: 4,
      metadata: { sha256: hash, datasetid: datasetId },
    }) };
    const { response, chunks } = responseSink();

    await new WorkspaceAssetInternalController(shares as any, documents as any, storage as any, config as any)
      .dataset({ ...query, datasetId }, response as any);

    expect(storage.openReadStream).toHaveBeenCalledWith(
      `semantic-model/datasets/${query.workspaceId}/${query.documentId}/${datasetId}.parquet`,
    );
    expect(response.setHeader).toHaveBeenCalledWith('X-YellowStorm-Dataset-Id', datasetId);
    expect(response.setHeader).toHaveBeenCalledWith('X-YellowStorm-Content-Hash', `sha256:${hash}`);
    expect(Buffer.concat(chunks).toString()).toBe('PAR1');
  });

  it('destroys a prepared dataset stream with invalid metadata', async () => {
    const body = Readable.from(['PAR1']);
    const shares = { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) };
    const documents = { findById: jest.fn().mockResolvedValue(document) };
    const storage = { openReadStream: jest.fn().mockResolvedValue({
      body, contentType: 'application/octet-stream', contentLength: 4, metadata: {},
    }) };
    const controller = new WorkspaceAssetInternalController(
      shares as any, documents as any, storage as any, config as any,
    );

    await expect(controller.dataset(
      { ...query, datasetId: 'ds_0123456789abcdef01234567' }, responseSink().response as any,
    )).rejects.toBeInstanceOf(ConflictException);
    expect(body.destroyed).toBe(true);
  });

  it('fails closed when the configured dataset size is invalid', () => {
    const invalid = { get: jest.fn((key: string, fallback: unknown) =>
      key === 'storage.semanticDatasetMaxSizeMb' ? Number.NaN : fallback) };
    expect(() => new WorkspaceAssetInternalController(
      {} as any, {} as any, {} as any, invalid as any,
    )).toThrow('SEMANTIC_DATASET_MAX_SIZE_MB');
  });
});
