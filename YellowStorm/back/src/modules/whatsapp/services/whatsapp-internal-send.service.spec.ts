import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@modules/logger';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  TooManyRequestsException,
} from '@modules/exceptions';
import { WhatsAppIntegrationStatus } from '../schemas/agent-whatsapp-integration.schema';
import { WhatsAppInternalSendService } from './whatsapp-internal-send.service';

type Chainable = Record<string, jest.Mock> & { exec: jest.Mock; lean: jest.Mock; select: jest.Mock; sort: jest.Mock };

function chainableMock(result: unknown, methods: string[] = []): Chainable {
  const query: Chainable = {
    exec: jest.fn().mockResolvedValue(result),
    lean: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
  };
  for (const method of methods) {
    query[method] = jest.fn().mockReturnThis();
  }
  return query;
}

describe('WhatsAppInternalSendService', () => {
  let service: WhatsAppInternalSendService;
  let integrationFindOne: jest.Mock;
  let bindingFindOne: jest.Mock;
  let integrationUpdateOne: jest.Mock;
  let bindingUpdateOne: jest.Mock;
  let sendAgentMessage: jest.Mock;
  let configGet: jest.Mock;

  const integration = {
    _id: { toString: () => 'int-1' },
    enabled: true,
    status: WhatsAppIntegrationStatus.CONNECTED,
    phoneNumber: '+21612345678',
  };

  beforeEach(() => {
    integrationFindOne = jest.fn();
    bindingFindOne = jest.fn();
    integrationUpdateOne = jest.fn().mockResolvedValue({});
    bindingUpdateOne = jest.fn().mockResolvedValue({});
    sendAgentMessage = jest.fn().mockResolvedValue('3EB0ABC');
    configGet = jest.fn((key: string, fallback?: number) => {
      if (key === 'whatsapp.internalSendRateLimitPerMinute') return 30;
      if (key === 'whatsapp.maxReplyLength') return 100;
      return fallback;
    });

    service = new WhatsAppInternalSendService(
      {
        findOne: integrationFindOne,
        updateOne: integrationUpdateOne,
      } as never,
      {
        findOne: bindingFindOne,
        updateOne: bindingUpdateOne,
      } as never,
      { sendAgentMessage } as never,
      { get: configGet } as unknown as ConfigService,
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService,
    );
  });

  function mockIntegration(value: unknown): void {
    integrationFindOne.mockReturnValue(chainableMock(value));
  }

  it('sends to an explicit known binding and returns the message id', async () => {
    mockIntegration(integration);
    bindingFindOne.mockReturnValueOnce(
      chainableMock({ _id: 'b1' }, ['select']),
    );

    await expect(
      service.send({ agentId: 'a'.repeat(24), to: '+21612345678', text: 'hello' }),
    ).resolves.toEqual({
      messageId: '3EB0ABC',
      status: 'SENT',
      to: '21612345678@s.whatsapp.net',
    });
    expect(sendAgentMessage).toHaveBeenCalledWith(
      integration._id,
      '21612345678@s.whatsapp.net',
      'hello',
    );
  });

  it('rejects an explicit recipient that is not a known binding (403)', async () => {
    mockIntegration(integration);
    bindingFindOne.mockReturnValueOnce(chainableMock(null, ['select']));

    await expect(
      service.send({ agentId: 'a'.repeat(24), to: '999888777@s.whatsapp.net', text: 'cold' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  it('defaults to the most recently active binding when to is omitted', async () => {
    mockIntegration(integration);
    bindingFindOne.mockReturnValueOnce(
      chainableMock({ remoteJid: '216111222333@s.whatsapp.net' }, ['sort', 'select']),
    );

    await expect(service.send({ agentId: 'a'.repeat(24), text: 'reply' })).resolves.toMatchObject({
      to: '216111222333@s.whatsapp.net',
      status: 'SENT',
    });
  });

  it('403 when no to and the agent has no known binding', async () => {
    mockIntegration(integration);
    bindingFindOne.mockReturnValueOnce(chainableMock(null, ['sort', 'select']));

    await expect(service.send({ agentId: 'a'.repeat(24), text: 'hi' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('409 ERR_3210 when the agent has no integration', async () => {
    mockIntegration(null);

    await expect(service.send({ agentId: 'a'.repeat(24), text: 'hi' })).rejects.toMatchObject({
      code: ErrorCode.WHATSAPP_INTEGRATION_NOT_FOUND,
    });
  });

  it('409 when the integration is not CONNECTED (graceful disconnect)', async () => {
    mockIntegration({ ...integration, status: WhatsAppIntegrationStatus.DISCONNECTED });
    bindingFindOne.mockReturnValue(chainableMock(null, ['sort', 'select']));

    await expect(service.send({ agentId: 'a'.repeat(24), text: 'hi' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  it('503 ERR_3219 on transport errors', async () => {
    mockIntegration(integration);
    bindingFindOne.mockReturnValueOnce(chainableMock({ remoteJid: 'j@s.whatsapp.net' }, ['sort', 'select']));
    sendAgentMessage.mockRejectedValueOnce(new Error('connect ETIMEDOUT web.whatsapp.com'));

    await expect(service.send({ agentId: 'a'.repeat(24), text: 'hi' })).rejects.toMatchObject({
      code: ErrorCode.WHATSAPP_NETWORK_UNREACHABLE,
    });
  });

  it('502 ERR_3215 on generic Baileys send failures', async () => {
    mockIntegration(integration);
    bindingFindOne.mockReturnValueOnce(chainableMock({ remoteJid: 'j@s.whatsapp.net' }, ['sort', 'select']));
    sendAgentMessage.mockRejectedValueOnce(new Error('bad mac'));

    await expect(service.send({ agentId: 'a'.repeat(24), text: 'hi' })).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('rethrows AppExceptions from the session manager untouched', async () => {
    mockIntegration(integration);
    bindingFindOne.mockReturnValueOnce(chainableMock({ remoteJid: 'j@s.whatsapp.net' }, ['sort', 'select']));
    sendAgentMessage.mockRejectedValueOnce(
      new ConflictException(ErrorCode.WHATSAPP_SESSION_NOT_FOUND, 'not connected'),
    );

    await expect(service.send({ agentId: 'a'.repeat(24), text: 'hi' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('truncates text to whatsapp.maxReplyLength', async () => {
    mockIntegration(integration);
    bindingFindOne.mockReturnValueOnce(chainableMock({ remoteJid: 'j@s.whatsapp.net' }, ['sort', 'select']));

    await service.send({ agentId: 'a'.repeat(24), text: 'x'.repeat(150) });
    const sentText = sendAgentMessage.mock.calls[0][2] as string;
    expect(sentText.length).toBe(100);
    expect(sentText.endsWith('...')).toBe(true);
  });

  it('rate limits per agent (429 after the configured burst)', async () => {
    configGet = jest.fn((key: string, fallback?: number) => {
      if (key === 'whatsapp.internalSendRateLimitPerMinute') return 2;
      if (key === 'whatsapp.maxReplyLength') return 4000;
      return fallback;
    });
    service = new WhatsAppInternalSendService(
      { findOne: integrationFindOne, updateOne: integrationUpdateOne } as never,
      { findOne: bindingFindOne, updateOne: bindingUpdateOne } as never,
      { sendAgentMessage } as never,
      { get: configGet } as unknown as ConfigService,
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService,
    );
    mockIntegration(integration);
    bindingFindOne.mockReturnValue(chainableMock({ remoteJid: 'j@s.whatsapp.net' }, ['sort', 'select']));

    const agentId = 'b'.repeat(24);
    await service.send({ agentId, text: '1' });
    await service.send({ agentId, text: '2' });
    await expect(service.send({ agentId, text: '3' })).rejects.toBeInstanceOf(TooManyRequestsException);
  });

  it('returns integration status for getStatus', async () => {
    mockIntegration(integration);
    await expect(service.getStatus('a'.repeat(24))).resolves.toEqual({
      enabled: true,
      status: WhatsAppIntegrationStatus.CONNECTED,
      phoneNumber: '+21612345678',
    });
  });

  it('409 ERR_3210 from getStatus when no integration', async () => {
    mockIntegration(null);
    await expect(service.getStatus('a'.repeat(24))).rejects.toMatchObject({
      code: ErrorCode.WHATSAPP_INTEGRATION_NOT_FOUND,
    });
  });

  it('updates binding + integration activity after a successful send', async () => {
    mockIntegration(integration);
    bindingFindOne.mockReturnValueOnce(chainableMock({ remoteJid: 'j@s.whatsapp.net' }, ['sort', 'select']));

    await service.send({ agentId: 'a'.repeat(24), text: 'hi' });
    expect(bindingUpdateOne).toHaveBeenCalled();
    expect(integrationUpdateOne).toHaveBeenCalled();
  });
});
