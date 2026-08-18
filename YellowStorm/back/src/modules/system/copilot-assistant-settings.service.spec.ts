import { CopilotAssistantSettingsService } from './copilot-assistant-settings.service';
import { DEFAULT_COPILOT_ASSISTANT_SETTINGS } from './interfaces/copilot-assistant-settings.interface';

describe('CopilotAssistantSettingsService', () => {
  const findOne = jest.fn();
  const findOneAndUpdate = jest.fn();
  const agents = {
    assertActiveDefaultAgent: jest.fn(),
    listActiveDefaultAgentOptions: jest.fn(),
  };
  const model = { findOne, findOneAndUpdate };

  beforeEach(() => jest.clearAllMocks());

  it('returns safe defaults when no setting is persisted', async () => {
    findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(null) }) });
    const service = new CopilotAssistantSettingsService(model as any, agents as any);

    await expect(service.getSettings()).resolves.toEqual({ agentId: DEFAULT_COPILOT_ASSISTANT_SETTINGS.agentId, updatedAt: undefined });
  });

  it('reads a persisted agent mapping and normalizes blank values to null', async () => {
    findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue({ value: { agentId: '  ' }, updatedAt: new Date('2026-07-20T00:00:00Z') }) }) });
    const service = new CopilotAssistantSettingsService(model as any, agents as any);

    await expect(service.getSettings()).resolves.toEqual({ agentId: null, updatedAt: expect.any(Date) });
  });

  it('lists active default agents eligible for the Copilot assistant', async () => {
    const options = [{ id: 'agent-1', name: 'Agent 1', model: 'model-1' }];
    agents.listActiveDefaultAgentOptions.mockResolvedValue(options);
    const service = new CopilotAssistantSettingsService(model as any, agents as any);

    await expect(service.listActiveAgentOptions()).resolves.toEqual(options);
  });

  it('validates and persists a mapped active default agent', async () => {
    const value = { agentId: '507f1f77bcf86cd799439011' };
    agents.assertActiveDefaultAgent.mockResolvedValue(undefined);
    findOneAndUpdate.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue({ updatedAt: new Date('2026-07-20T00:00:00Z') }) }) });
    const service = new CopilotAssistantSettingsService(model as any, agents as any);

    await expect(service.updateSettings(value)).resolves.toMatchObject(value);
    expect(agents.assertActiveDefaultAgent).toHaveBeenCalledWith(value.agentId);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { key: 'copilot_assistant_settings' },
      { key: 'copilot_assistant_settings', value },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  });

  it('allows un-mapping the Copilot assistant back to the default heuristic', async () => {
    const value = { agentId: null };
    findOneAndUpdate.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue({ updatedAt: new Date('2026-07-20T00:00:00Z') }) }) });
    const service = new CopilotAssistantSettingsService(model as any, agents as any);

    await expect(service.updateSettings(value)).resolves.toMatchObject({ agentId: null });
    expect(agents.assertActiveDefaultAgent).not.toHaveBeenCalled();
  });
});
