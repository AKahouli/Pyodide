import { GUARDS_METADATA } from '@nestjs/common/constants';
import { InternalServiceGuard } from '@modules/auth/guards/internal-service.guard';
import { IS_PUBLIC_KEY } from '@modules/auth/decorators/public.decorator';
import { SKIP_RESPONSE_WRAP_KEY } from '@modules/response/decorators/skip-response-wrap.decorator';
import { WhatsAppInternalSendService } from '../services/whatsapp-internal-send.service';
import { WhatsAppInternalController } from './whatsapp-internal.controller';

describe('WhatsAppInternalController', () => {
  const send = jest.fn();
  const getStatus = jest.fn();
  const controller = new WhatsAppInternalController({
    send,
    getStatus,
  } as unknown as WhatsAppInternalSendService);

  beforeEach(() => jest.clearAllMocks());

  it('is service-authenticated and bypasses the user JWT guard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, WhatsAppInternalController) as unknown[];

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, WhatsAppInternalController)).toBe(true);
    expect(guards).toContain(InternalServiceGuard);
  });

  it('returns the raw body so the MCP façade reads messageId directly', () => {
    expect(
      Reflect.getMetadata(SKIP_RESPONSE_WRAP_KEY, WhatsAppInternalController),
    ).toBe(true);
  });

  it('delegates send with agentId, to and text', async () => {
    send.mockResolvedValueOnce({ messageId: '3EB0', status: 'SENT', to: 'j@s.whatsapp.net' });

    await expect(
      controller.send({ agentId: 'a'.repeat(24), to: 'j@s.whatsapp.net', text: 'hi' }),
    ).resolves.toEqual({ messageId: '3EB0', status: 'SENT', to: 'j@s.whatsapp.net' });
    expect(send).toHaveBeenCalledWith({
      agentId: 'a'.repeat(24),
      to: 'j@s.whatsapp.net',
      text: 'hi',
    });
  });

  it('delegates status lookups', async () => {
    getStatus.mockResolvedValueOnce({ enabled: true, status: 'CONNECTED' });

    await expect(controller.status({ agentId: 'a'.repeat(24) })).resolves.toEqual({
      enabled: true,
      status: 'CONNECTED',
    });
    expect(getStatus).toHaveBeenCalledWith('a'.repeat(24));
  });
});
