import { PlaybookFlowHitlPromptService } from './playbook-flow-hitl-prompt.service';

describe('PlaybookFlowHitlPromptService', () => {
  it('returns the stored node mode instead of defaulting back to auto', async () => {
    const flow = {
      nodes: [{
        id: 'node-1',
        hitlPolicy: {
          toObject: () => ({ mode: 'off', sensitivity: 'balanced' }),
        },
      }],
    };
    const flowModel = {
      findOne: jest.fn().mockResolvedValue(flow),
    };
    const configService = {
      get: jest.fn().mockReturnValue(true),
    };

    const service = new PlaybookFlowHitlPromptService(flowModel as any, configService as any);

    await expect(service.getNodePolicy('flow-1', 'user-1', 'node-1')).resolves.toEqual(
      expect.objectContaining({ mode: 'off' }),
    );
  });

  it('marks nodes modified when updating node HITL policy', async () => {
    const flow = {
      hitlPolicy: { mode: 'auto', sensitivity: 'balanced' },
      nodes: [{ id: 'node-1', hitlPolicy: { mode: 'auto', sensitivity: 'balanced' } }],
      set: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const flowModel = {
      findOne: jest.fn().mockResolvedValue(flow),
    };
    const configService = {
      get: jest.fn().mockReturnValue(true),
    };

    const service = new PlaybookFlowHitlPromptService(flowModel as any, configService as any);

    await expect(service.updateNodePolicy('flow-1', 'user-1', 'node-1', { mode: 'off' } as any)).resolves.toEqual(
      expect.objectContaining({ mode: 'off' }),
    );
    expect(flow.set).toHaveBeenCalledWith('nodes.0.hitlPolicy', expect.objectContaining({ mode: 'off' }));
    expect(flow.save).toHaveBeenCalledTimes(1);
  });
});
