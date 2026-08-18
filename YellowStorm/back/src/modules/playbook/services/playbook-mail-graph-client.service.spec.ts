import { PlaybookMailGraphClientService } from './playbook-mail-graph-client.service';

describe('PlaybookMailGraphClientService', () => {
  let service: PlaybookMailGraphClientService;
  const connectedAppTokenService = {
    getValidToken: jest.fn().mockResolvedValue('token-123'),
  };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PlaybookMailGraphClientService(connectedAppTokenService as any, logger);
  });

  it('creates a Graph subscription targeting inbox only', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'sub-1' }),
    } as any);

    const result = await service.createInboxSubscription('u1', 'microsoft', 'https://example.test/webhook', 'ys_p1');

    expect(connectedAppTokenService.getValidToken).toHaveBeenCalledWith('u1', 'microsoft');
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(requestInit.body as string)).toMatchObject({
      changeType: 'created',
      notificationUrl: 'https://example.test/webhook',
      resource: "me/mailFolders('inbox')/messages",
      clientState: 'ys_p1',
    });
    expect(requestInit.headers).not.toHaveProperty('Prefer');
    expect(result).toEqual({ id: 'sub-1' });

    fetchMock.mockRestore();
  });

  it('clamps subscription expiry to the user-selected auto-renew cutoff', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'sub-1' }),
    } as any);

    const autoRenewUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await service.createInboxSubscription('u1', 'microsoft', 'https://example.test/webhook', 'ys_p1', autoRenewUntil);

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.expirationDateTime).toBe(autoRenewUntil);

    fetchMock.mockRestore();
  });

  it('fetches a Graph message by message id', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg-1', subject: 'Hello' }),
    } as any);

    const result = await service.getMessage('u1', 'microsoft', 'msg-1');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/me/messages/msg-1?'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-123' }) }),
    );
    expect(result).toEqual({ id: 'msg-1', subject: 'Hello' });

    fetchMock.mockRestore();
  });

  it('renews a Graph subscription via PATCH', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'sub-1', expirationDateTime: '2026-04-18T07:00:00Z' }),
    } as any);

    const result = await service.renewSubscription('u1', 'microsoft', 'sub-1');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/subscriptions/sub-1'),
      expect.objectContaining({ method: 'PATCH' }),
    );
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.expirationDateTime).toBeDefined();

    fetchMock.mockRestore();
  });

  it('clamps renewal expiry to the user-selected auto-renew cutoff', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'sub-1', expirationDateTime: '2026-04-18T07:00:00Z' }),
    } as any);

    const autoRenewUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await service.renewSubscription('u1', 'microsoft', 'sub-1', autoRenewUntil);

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.expirationDateTime).toBe(autoRenewUntil);

    fetchMock.mockRestore();
  });

  it('deletes a Graph subscription via DELETE', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      status: 204,
    } as any);

    await service.deleteSubscription('u1', 'microsoft', 'sub-1');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/subscriptions/sub-1'),
      expect.objectContaining({ method: 'DELETE' }),
    );

    fetchMock.mockRestore();
  });

  it('deletes a Graph subscription tolerates 404', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not found',
    } as any);

    await expect(service.deleteSubscription('u1', 'microsoft', 'sub-1')).resolves.not.toThrow();

    fetchMock.mockRestore();
  });

  it('lists non-inline attachments for a message', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        value: [
          { id: 'att-1', name: 'file.pdf', contentType: 'application/pdf', size: 100, isInline: false },
          { id: 'att-2', name: 'logo.png', contentType: 'image/png', size: 50, isInline: true },
        ],
      }),
    } as any);

    const result = await service.listAttachments('u1', 'microsoft', 'msg-1');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('att-1');

    fetchMock.mockRestore();
  });

  it('downloads attachment content as buffer', async () => {
    const content = new Uint8Array([1, 2, 3]);
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => content.buffer,
    } as any);

    const result = await service.downloadAttachment('u1', 'microsoft', 'msg-1', 'att-1');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/messages/msg-1/attachments/att-1/$value'),
      expect.any(Object),
    );
    expect(Buffer.isBuffer(result)).toBe(true);

    fetchMock.mockRestore();
  });

  it('normalizes resource path casing (Users -> users, Messages -> messages)', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg-1' }),
    } as any);

    await service.getMessageByResource('u1', 'microsoft', 'Users/abc/Messages/xyz');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/users/abc/messages/xyz?'),
      expect.any(Object),
    );

    fetchMock.mockRestore();
  });

  it('falls back to listing recent messages when direct fetch and translation fail', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any);
    const nullTranslation = { ok: true, json: async () => ({ value: [{ sourceId: 'x', targetId: null }] }) };
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'Not found' })
      .mockResolvedValueOnce(nullTranslation)
      .mockResolvedValueOnce(nullTranslation)
      .mockResolvedValueOnce(nullTranslation)
      .mockResolvedValueOnce(nullTranslation)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ value: [{ id: 'msg-recent', subject: 'Fallback' }] }) });

    const result = await service.getMessageByResource('u1', 'microsoft', '/users/abc/messages/xyz');

    expect(result).toMatchObject({ subject: 'Fallback' });

    fetchMock.mockRestore();
  });

  it('throws when all fetch strategies fail', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any);
    const emptyTranslation = { ok: true, json: async () => ({ value: [] }) };
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'Not found' })
      .mockResolvedValueOnce(emptyTranslation)
      .mockResolvedValueOnce(emptyTranslation)
      .mockResolvedValueOnce(emptyTranslation)
      .mockResolvedValueOnce(emptyTranslation)
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'No recent' });

    await expect(
      service.getMessageByResource('u1', 'microsoft', '/users/abc/messages/xyz'),
    ).rejects.toThrow('all strategies exhausted');

    fetchMock.mockRestore();
  });
});
