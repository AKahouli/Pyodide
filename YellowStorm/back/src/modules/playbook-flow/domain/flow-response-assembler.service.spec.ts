import { FlowResponseAssemblerService } from './flow-response-assembler.service';

describe('FlowResponseAssemblerService', () => {
  it('assembles base responses without replay metadata', () => {
    const service = new FlowResponseAssemblerService(
      { getActiveReplays: jest.fn() } as any,
      { findLatestScoresForReplays: jest.fn() } as any,
    );
    const flow = {
      toJSON: jest.fn().mockReturnValue({ id: 'flow-1', nodes: [], activeReplays: { stale: true } }),
    };

    expect(service.toBaseFlowResponse(flow as any).activeReplays).toEqual({});
  });

  it('assembles enriched replay metadata and latest scores', async () => {
    const replay = {
      _id: 'replay-1',
      taskId: 'task-1',
      validationVersion: 2,
      isStale: false,
      staleReasons: [],
      preserveOutputFormat: true,
      outputFormatGuide: 'guide',
      formatGuideStatus: 'ready',
      label: 'Baseline',
    };
    const service = new FlowResponseAssemblerService(
      { getActiveReplays: jest.fn().mockResolvedValue([replay]) } as any,
      { findLatestScoresForReplays: jest.fn().mockResolvedValue(new Map([['replay-1', 96]])) } as any,
    );
    const flow = {
      toJSON: jest.fn().mockReturnValue({ id: 'flow-1', nodes: [{ id: 'task-1' }] }),
    };

    const result = await service.toEnrichedFlowResponse('flow-1', flow as any);

    expect(result.activeReplays['task-1']).toMatchObject({
      id: 'replay-1',
      validationVersion: 2,
      latestOverallScore: 96,
    });
  });
});
