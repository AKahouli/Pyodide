import { SemanticDataConnectionService } from './semantic-data-connection.service';

const row = { id: 'c-1', kind: 'mail_archive', name: 'mails.zip', workspaceId: 'ws-1', documentId: 'doc-1', indexInWorkspace: false, createdAt: new Date('2026-10-07T00:00:00.000Z') };
const archive = { id: 'doc-1', workspaceId: 'ws-1', originalName: 'mails.zip', mimeType: 'application/zip', isFolder: false };

describe('SemanticDataConnectionService', () => {
  const setup = ({ rows = [row] as unknown[], access = true, document = archive as unknown, existing = [] as unknown[], count = 0 } = {}) => {
    const database = { query: jest.fn(async () => ({ rows, rowCount: rows.length })), transaction: jest.fn() };
    const client = { query: jest.fn(async (sql: string) => {
      if (sql.includes('FOR UPDATE')) return { rows: [] };
      if (sql.includes('count(*)')) return { rows: [{ count }] };
      if (sql.startsWith('SELECT')) return { rows: existing };
      return { rows: [row] };
    }) };
    database.transaction.mockImplementation(async (work: (c: typeof client) => unknown) => work(client));
    const models = { requireRole: jest.fn(async () => ({ id: 'model' })), requireActiveRole: jest.fn(async () => ({ id: 'model' })) };
    const documents = {
      findByIds: jest.fn(async () => document ? [document] : []),
      findByIdsInWorkspace: jest.fn(async () => document ? [document] : []),
    };
    const shares = { hasAccess: jest.fn(async () => access), filterAccessible: jest.fn(async (_user: string, ids: string[]) => access ? ids : []) };
    return { service: new SemanticDataConnectionService(database as never, models as never, documents as never, shares as never), database, client, models };
  };
  const dto = { kind: 'mail_archive' as const, workspaceId: 'ws-1', documentId: 'doc-1' };

  it('connects a mail archive of a workspace the editor can open, named after the file by default', async () => {
    const { service, client, models } = setup();
    await expect(service.create('user', 'model', dto)).resolves.toMatchObject({ id: 'c-1', available: true, createdAt: '2026-10-07T00:00:00.000Z' });
    expect(models.requireActiveRole).toHaveBeenCalledWith('user', 'model', ['owner', 'editor']);
    const insert = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT')) as unknown as [string, unknown[]];
    expect(insert[1]).toEqual(['model', 'mail_archive', 'mails.zip', 'ws-1', 'doc-1', '{"indexInWorkspace":false}', 'user']);
  });

  it('answers the connection a file already has instead of adding another', async () => {
    const { service, client } = setup({ existing: [{ ...row, id: 'c-0' }] });
    await expect(service.create('user', 'model', dto)).resolves.toMatchObject({ id: 'c-0' });
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT'))).toBe(false);
  });

  it('keeps a given name and the choice to index the archive in its workspace', async () => {
    const { service, client } = setup();
    await service.create('user', 'model', { ...dto, name: '  Legal mailbox ', indexInWorkspace: true });
    const insert = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT')) as unknown as [string, unknown[]];
    expect(insert[1][2]).toBe('Legal mailbox');
    expect(insert[1][5]).toBe('{"indexInWorkspace":true}');
  });

  it('changes whether a connection is indexed in its workspace, for editors and only within the model', async () => {
    const { service, database, models } = setup({ rows: [{ ...row, indexInWorkspace: true }] });
    await expect(service.update('user', 'model', 'c-1', { indexInWorkspace: true })).resolves.toMatchObject({ id: 'c-1', indexInWorkspace: true, available: true });
    expect(models.requireActiveRole).toHaveBeenCalledWith('user', 'model', ['owner', 'editor']);
    expect(database.query.mock.calls[0]).toEqual([expect.stringContaining('WHERE id=$1 AND model_id=$2'), ['c-1', 'model', true]]);
    await expect(setup({ rows: [] }).service.update('user', 'model', 'c-9', { indexInWorkspace: false })).rejects.toThrow('Data source not found');
  });

  it('refuses a workspace the editor cannot open, a missing file, a file that is not a mail archive and a full list', async () => {
    await expect(setup({ access: false }).service.create('user', 'model', dto)).rejects.toThrow();
    await expect(setup({ document: null }).service.create('user', 'model', dto)).rejects.toThrow('File not found');
    await expect(setup({ document: { ...archive, mimeType: 'application/pdf' } }).service.create('user', 'model', dto)).rejects.toThrow('mail archive');
    await expect(setup({ count: 100 }).service.create('user', 'model', dto)).rejects.toThrow('at most 100');
  });

  it('lists connections, marking those whose file is gone or whose workspace is no longer open to the person', async () => {
    await expect(setup().service.list('user', 'model')).resolves.toEqual([expect.objectContaining({ id: 'c-1', available: true })]);
    await expect(setup({ access: false }).service.list('user', 'model')).resolves.toEqual([expect.objectContaining({ available: false })]);
    await expect(setup({ document: null }).service.list('user', 'model')).resolves.toEqual([expect.objectContaining({ available: false })]);
    await expect(setup({ document: { ...archive, workspaceId: 'ws-2' } }).service.list('user', 'model')).resolves.toEqual([expect.objectContaining({ available: false })]);
  });

  it('deletes only a connection of the model', async () => {
    await expect(setup({ rows: [] }).service.delete('user', 'model', 'c-9')).rejects.toThrow('Data source not found');
    await expect(setup().service.delete('user', 'model', 'c-1')).resolves.toEqual({ deleted: true });
  });
});
