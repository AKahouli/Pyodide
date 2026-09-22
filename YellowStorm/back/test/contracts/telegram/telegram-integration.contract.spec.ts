import 'reflect-metadata';
import { expectContract } from '../expect-contract';
import { toWire, callPrivate, expectNoMongoKeys, expectNoKeys } from '../wire-helpers';
import { TelegramIntegrationService } from '@modules/telegram/services/telegram-integration.service';

const integration = {
  enabled: true,
  encryptedBotToken: 'enc:SUPER-SECRET-BOT-TOKEN',
  webhookSecret: 'WEBHOOK-SECRET',
  botUsername: 'my_agent_bot',
  status: 'active',
  errorMessage: null,
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

describe('telegram integration response contract', () => {
  it('reports hasToken but never the bot token or webhook secret', () => {
    const body = toWire(
      callPrivate(TelegramIntegrationService, 'toResponse', [
        integration,
        { webhookRegistered: true, linkCode: 'ABC123', linkCodeExpiresAt: '2026-01-02T00:10:00.000Z' },
      ]),
    );
    expectContract('telegram/integration', body);
    expect(body.hasToken).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/SUPER-SECRET|WEBHOOK-SECRET/);
    expectNoMongoKeys(body);
    expectNoKeys(body, 'encryptedBotToken', 'botToken', 'webhookSecret', 'token');
  });

  it('a token-less integration reports hasToken=false', () => {
    const body = toWire(callPrivate(TelegramIntegrationService, 'toResponse', [{ ...integration, encryptedBotToken: '' }]));
    expect(body.hasToken).toBe(false);
  });
});
