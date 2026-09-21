import { GovernanceChannelReadinessService } from './governance-channel-readiness.service';

describe('GovernanceChannelReadinessService', () => {
  const widgetChatService = { hasActiveToken: jest.fn() };
  const telegramIntegrationService = { getByAgentForUser: jest.fn() };
  const service = new GovernanceChannelReadinessService(widgetChatService as never, telegramIntegrationService as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks enabled ready channels as passed', async () => {
    widgetChatService.hasActiveToken.mockResolvedValue(true);

    const checks = await service.buildChannelChecks('user-1', 'agent-1', { widget: { enabled: true } });

    expect(checks).toEqual([expect.objectContaining({ key: 'agent-1:widget_ready', status: 'passed' })]);
  });

  it('reports missing channel integrations as non-blocking warnings', async () => {
    telegramIntegrationService.getByAgentForUser.mockResolvedValue({ enabled: true, status: 'pending' });

    const checks = await service.buildChannelChecks('user-1', 'agent-1', { telegram: { enabled: true } });

    expect(checks).toEqual([expect.objectContaining({ key: 'agent-1:telegram_ready', status: 'warning', severity: 'warning' })]);
  });

  it('does not create readiness checks for disabled channels', async () => {
    await expect(service.buildChannelChecks('user-1', 'agent-1', { telegram: { enabled: false } })).resolves.toEqual([]);
  });

  it('groups legacy and agent-scoped channel configuration by agent', () => {
    expect(service.groupChannelsByAgent({ widget: { enabled: true }, 'agent-2:telegram': { enabled: true } }, 'agent-1')).toEqual({
      'agent-1': { widget: { enabled: true } },
      'agent-2': { telegram: { enabled: true } },
    });
  });
});
