import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectAgentWhatsApp,
  createAgent,
  deleteAgent,
  deleteAgentTelegramIntegration,
  deleteAgentWhatsAppIntegration,
  disconnectAgentWhatsAppSession,
  getActiveTools,
  getAgentTelegramIntegration,
  getAgentTypes,
  getAgentWhatsAppIntegration,
  getAgentWhatsAppPairing,
  getAllAgents,
  reconnectAgentWhatsApp,
  updateAgent,
  updateAgentWhatsAppEnabled,
  upsertAgentTelegramIntegration,
} from './api';

const getMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
const patchMock = vi.hoisted(() => vi.fn());
const putMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({
  default: {
    get: getMock,
    post: postMock,
    patch: patchMock,
    put: putMock,
    delete: deleteMock,
  },
}));

vi.mock('@/lib/api/config', () => ({
  API_ENDPOINTS: {
    agents: {
      all: '/agents/all',
      list: '/agents',
      byId: (id: string) => `/agents/${id}`,
      telegramIntegration: (id: string) => `/agents/${id}/telegram-integration`,
      whatsappIntegration: (id: string) => `/agents/${id}/whatsapp-integration`,
      whatsappEnabled: (id: string) => `/agents/${id}/whatsapp-integration/enabled`,
      whatsappConnect: (id: string) => `/agents/${id}/whatsapp-integration/connect`,
      whatsappPairing: (id: string, sessionId: string) =>
        `/agents/${id}/whatsapp-integration/${sessionId}/pairing`,
      whatsappReconnect: (id: string, sessionId: string) =>
        `/agents/${id}/whatsapp-integration/${sessionId}/reconnect`,
      whatsappSession: (id: string, sessionId: string) =>
        `/agents/${id}/whatsapp-integration/${sessionId}`,
    },
    agentTypes: {
      active: '/agent-types/active',
    },
    tools: {
      active: '/tools/active',
    },
  },
}));

describe('agent api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gets all agents from /agents/all', async () => {
    getMock.mockResolvedValue({ data: { data: [{ id: 'a1' }] } });

    const result = await getAllAgents();

    expect(getMock).toHaveBeenCalledWith('/agents/all');
    expect(result).toEqual([{ id: 'a1' }]);
  });

  it('gets active agent types', async () => {
    getMock.mockResolvedValue({ data: { data: [{ id: 't1' }] } });

    const result = await getAgentTypes();

    expect(getMock).toHaveBeenCalledWith('/agent-types/active');
    expect(result).toEqual([{ id: 't1' }]);
  });

  it('creates agent via POST /agents', async () => {
    postMock.mockResolvedValue({ data: { data: { id: 'new' } } });

    const result = await createAgent({ name: 'Agent', agentType: 'type', role: 'role' } as never);

    expect(postMock).toHaveBeenCalledWith('/agents', { name: 'Agent', agentType: 'type', role: 'role' });
    expect(result).toEqual({ id: 'new' });
  });

  it('updates agent via PATCH /agents/:id', async () => {
    patchMock.mockResolvedValue({ data: { data: { id: 'a1', name: 'Updated' } } });

    const result = await updateAgent('a1', { name: 'Updated' });

    expect(patchMock).toHaveBeenCalledWith('/agents/a1', { name: 'Updated' });
    expect(result).toEqual({ id: 'a1', name: 'Updated' });
  });

  it('deletes agent via DELETE /agents/:id', async () => {
    deleteMock.mockResolvedValue(undefined);

    await deleteAgent('a1');

    expect(deleteMock).toHaveBeenCalledWith('/agents/a1');
  });

  it('gets active tools list', async () => {
    getMock.mockResolvedValue({ data: { data: [{ id: 'tool-1' }] } });

    const result = await getActiveTools();

    expect(getMock).toHaveBeenCalledWith('/tools/active');
    expect(result).toEqual([{ id: 'tool-1' }]);
  });

  it('gets agent telegram integration via GET', async () => {
    getMock.mockResolvedValue({
      data: { data: { enabled: true, hasToken: true, botUsername: 'my_bot' } },
    });

    const result = await getAgentTelegramIntegration('a1');

    expect(getMock).toHaveBeenCalledWith('/agents/a1/telegram-integration');
    expect(result).toEqual({ enabled: true, hasToken: true, botUsername: 'my_bot' });
  });

  it('upserts agent telegram integration via PUT', async () => {
    putMock.mockResolvedValue({
      data: { data: { enabled: true, hasToken: true } },
    });

    const result = await upsertAgentTelegramIntegration('a1', {
      enabled: true,
      botToken: '123:abc',
    });

    expect(putMock).toHaveBeenCalledWith('/agents/a1/telegram-integration', {
      enabled: true,
      botToken: '123:abc',
    });
    expect(result).toEqual({ enabled: true, hasToken: true });
  });

  it('deletes agent telegram integration via DELETE', async () => {
    deleteMock.mockResolvedValue(undefined);

    await deleteAgentTelegramIntegration('a1');

    expect(deleteMock).toHaveBeenCalledWith('/agents/a1/telegram-integration');
  });

  it('gets agent whatsapp integration via GET', async () => {
    getMock.mockResolvedValue({
      data: { data: { status: 'CONNECTED', phoneNumber: '+1' } },
    });

    const result = await getAgentWhatsAppIntegration('a1');

    expect(getMock).toHaveBeenCalledWith('/agents/a1/whatsapp-integration');
    expect(result).toEqual({ status: 'CONNECTED', phoneNumber: '+1' });
  });

  it('connects agent whatsapp via POST', async () => {
    postMock.mockResolvedValue({
      data: { data: { sessionId: 's1', status: 'PAIRING' } },
    });

    const result = await connectAgentWhatsApp('a1');

    expect(postMock).toHaveBeenCalledWith('/agents/a1/whatsapp-integration/connect');
    expect(result).toEqual({ sessionId: 's1', status: 'PAIRING' });
  });

  it('updates agent whatsapp enabled via PATCH', async () => {
    patchMock.mockResolvedValue({
      data: { data: { enabled: false, status: 'CONNECTED' } },
    });

    const result = await updateAgentWhatsAppEnabled('a1', { enabled: false });

    expect(patchMock).toHaveBeenCalledWith('/agents/a1/whatsapp-integration/enabled', {
      enabled: false,
    });
    expect(result).toEqual({ enabled: false, status: 'CONNECTED' });
  });

  it('gets whatsapp pairing via GET', async () => {
    getMock.mockResolvedValue({
      data: { data: { qrCode: 'qr', pairingCode: '12345678' } },
    });

    const result = await getAgentWhatsAppPairing('a1', 's1');

    expect(getMock).toHaveBeenCalledWith('/agents/a1/whatsapp-integration/s1/pairing');
    expect(result).toEqual({ qrCode: 'qr', pairingCode: '12345678' });
  });

  it('reconnects whatsapp session via POST', async () => {
    postMock.mockResolvedValue({
      data: { data: { status: 'PAIRING', sessionId: 's1' } },
    });

    const result = await reconnectAgentWhatsApp('a1', 's1');

    expect(postMock).toHaveBeenCalledWith('/agents/a1/whatsapp-integration/s1/reconnect');
    expect(result).toEqual({ status: 'PAIRING', sessionId: 's1' });
  });

  it('disconnects whatsapp session via DELETE', async () => {
    deleteMock.mockResolvedValue(undefined);

    await disconnectAgentWhatsAppSession('a1', 's1');

    expect(deleteMock).toHaveBeenCalledWith('/agents/a1/whatsapp-integration/s1');
  });

  it('deletes agent whatsapp integration via DELETE', async () => {
    deleteMock.mockResolvedValue(undefined);

    await deleteAgentWhatsAppIntegration('a1');

    expect(deleteMock).toHaveBeenCalledWith('/agents/a1/whatsapp-integration');
  });
});
