import { MongoWorkspaceDocumentWriteAdapter } from './mongo-workspace-document-write.adapter';

describe('MongoWorkspaceDocumentWriteAdapter', () => {
  function makeModel(doc: Record<string, unknown> | null) {
    const save = jest.fn().mockResolvedValue(undefined);
    const hydrated = doc === null ? null : { ...doc, save };
    const model = {
      findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(hydrated) }),
    };
    return { model, save, hydrated: hydrated as Record<string, unknown> | null };
  }

  function makeAdapter(model: unknown): MongoWorkspaceDocumentWriteAdapter {
    return new MongoWorkspaceDocumentWriteAdapter(model as never);
  }

  it('assigns defined patch values and clears present-undefined keys, then saves', async () => {
    const { model, save, hydrated } = makeModel({ indexingStatus: 'processing', indexingError: 'old', metadata: { a: '1' } });
    const makeModel0 = { hydrated };
    const adapter = makeAdapter(model);

    await adapter.updateIndexingState('doc-1', {
      indexingStatus: 'ready',
      indexingError: undefined,
      lastIndexedAt: new Date(123),
      // metadata absent -> untouched
    });

    expect(save).toHaveBeenCalledTimes(1);
    const doc = makeModel0.hydrated!;
    expect(doc.indexingStatus).toBe('ready');
    expect(doc.indexingError).toBeUndefined(); // present-undefined cleared
    expect(doc.lastIndexedAt).toEqual(new Date(123));
    expect(doc.metadata).toEqual({ a: '1' }); // absent key untouched
  });

  it('replaces metadata wholesale when provided', async () => {
    const { model, save, hydrated } = makeModel({ metadata: { a: '1', b: '2' } });
    const adapter = makeAdapter(model);

    await adapter.updateIndexingState('doc-1', { metadata: { c: '3' } });

    expect(hydrated!.metadata).toEqual({ c: '3' });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the document is gone', async () => {
    const { model, save } = makeModel(null);
    const adapter = makeAdapter(model);

    await expect(
      adapter.updateIndexingState('doc-1', { indexingStatus: 'ready' }),
    ).resolves.toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });
});
