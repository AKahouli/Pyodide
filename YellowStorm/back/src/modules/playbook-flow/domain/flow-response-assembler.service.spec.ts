import { FlowResponseAssemblerService, toFlowJson } from './flow-response-assembler.service';
import type { FlowRecord } from '../persistence/flow.repository';

const flowRecord = (over: Partial<FlowRecord> = {}): FlowRecord => ({
  id: 'flow-1',
  ownerId: 'user-1',
  assistantOperationId: null,
  generationProvenance: null,
  schemaVersion: 1,
  definitionRevision: 3,
  name: 'Alpha',
  description: null,
  triggerConfig: null,
  settings: { recursionLimit: 25, maxParallelism: 5 },
  hitlPolicy: { mode: 'auto' } as FlowRecord['hitlPolicy'],
  hitlBlockers: [],
  nodes: [],
  controlEdges: [],
  dataBindings: [],
  workspaces: ['w1'],
  designSettings: null,
  isFavorite: false,
  reflectionEnabled: false,
  advisorScoringMode: 'llm',
  advisorAutopilotEnabled: false,
  advisorAutopilotTargetScore: null,
  advisorAutopilotMaxTurns: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  ...over,
});

describe('FlowResponseAssemblerService', () => {
  it('builds the JSON the Mongo document produced: id, no unset fields, empty activeReplays', () => {
    const json = toFlowJson(flowRecord({ description: 'about', advisorAutopilotMaxTurns: 3 }));

    expect(JSON.parse(JSON.stringify(json))).toEqual({
      id: 'flow-1',
      ownerId: 'user-1',
      schemaVersion: 1,
      definitionRevision: 3,
      name: 'Alpha',
      description: 'about',
      settings: { recursionLimit: 25, maxParallelism: 5 },
      hitlPolicy: { mode: 'auto' },
      hitlBlockers: [],
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      workspaces: ['w1'],
      isFavorite: false,
      reflectionEnabled: false,
      advisorScoringMode: 'llm',
      advisorAutopilotEnabled: false,
      advisorAutopilotMaxTurns: 3,
      activeReplays: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('assembles base responses without replay metadata', () => {
    const replayService = { getActiveReplays: jest.fn() };
    const service = new FlowResponseAssemblerService(replayService as any, { findLatestScoresForReplays: jest.fn() } as any);

    expect(service.toBaseFlowResponse(flowRecord()).activeReplays).toEqual({});
    expect(replayService.getActiveReplays).not.toHaveBeenCalled();
  });

  it('assembles enriched replay metadata and latest scores', async () => {
    const replay = {
      id: 'replay-1',
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

    const result = await service.toEnrichedFlowResponse('flow-1', flowRecord({ nodes: [{ id: 'task-1' }] as any }));

    expect(result.activeReplays['task-1']).toMatchObject({
      id: 'replay-1',
      validationVersion: 2,
      latestOverallScore: 96,
    });
  });
});
