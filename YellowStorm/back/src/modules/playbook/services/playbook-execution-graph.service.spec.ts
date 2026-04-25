import { Test, TestingModule } from '@nestjs/testing';
import { PlaybookExecutionGraphService } from './playbook-execution-graph.service';
import { StepStatus } from '../schemas/playbook-execution.schema';
import { LoggerService } from '../../logger';

describe('PlaybookExecutionGraphService', () => {
  let service: PlaybookExecutionGraphService;
  let mockLoggerService: Partial<Record<keyof LoggerService, any>>;

  beforeEach(async () => {
    mockLoggerService = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybookExecutionGraphService,
        { provide: LoggerService, useValue: mockLoggerService },
      ],
    }).compile();

    service = module.get<PlaybookExecutionGraphService>(PlaybookExecutionGraphService);
  });

  describe('constructor', () => {
    it('sets logger context', () => {
      expect(mockLoggerService.setContext).toHaveBeenCalledWith('PlaybookExecutionGraphService');
    });
  });

  describe('normalizeEdgeId', () => {
    it('returns toString value for ObjectId-like', () => {
      const oid = { toString: () => 'abc123' };
      expect(service.normalizeEdgeId(oid)).toBe('abc123');
    });

    it('returns string as-is', () => {
      expect(service.normalizeEdgeId('task-1')).toBe('task-1');
    });

    it('returns empty string for null/undefined', () => {
      expect(service.normalizeEdgeId(null)).toBe('');
      expect(service.normalizeEdgeId(undefined)).toBe('');
    });
  });

  describe('buildEdgeKey', () => {
    it('builds key from camelCase edge fields', () => {
      const edge = { sourceId: 'a', targetId: 'b', sourceOutputPortId: 'p1', targetInputPortId: 'p2' };
      expect(service.buildEdgeKey(edge)).toBe('a:p1->b:p2');
    });

    it('builds key from snake_case edge fields', () => {
      const edge = { source_id: 'a', target_id: 'b', source_output_port_id: 'x', target_input_port_id: 'y' };
      expect(service.buildEdgeKey(edge)).toBe('a:x->b:y');
    });

    it('defaults port IDs to "default"', () => {
      const edge = { sourceId: 'a', targetId: 'b' };
      expect(service.buildEdgeKey(edge)).toBe('a:default->b:default');
    });
  });

  describe('buildTaskMapFromSnapshot', () => {
    it('returns map keyed by task id', () => {
      const snapshot = {
        tasks: [
          { id: 't1', title: 'Task 1' },
          { id: 't2', title: 'Task 2' },
        ],
      };
      const map = service.buildTaskMapFromSnapshot(snapshot);
      expect(map.size).toBe(2);
      expect(map.get('t1').title).toBe('Task 1');
    });

    it('returns empty map for null snapshot', () => {
      expect(service.buildTaskMapFromSnapshot(null).size).toBe(0);
    });
  });

  describe('findAncestorTaskIds', () => {
    it('finds transitive ancestors via edges', () => {
      const snapshot = {
        edges: [
          { sourceId: 'a', targetId: 'b' },
          { sourceId: 'b', targetId: 'c' },
        ],
      };
      const ancestors = service.findAncestorTaskIds(snapshot, 'c');
      expect(ancestors).toContain('a');
      expect(ancestors).toContain('b');
      expect(ancestors).not.toContain('c');
    });

    it('returns empty for task with no incoming edges', () => {
      const snapshot = { edges: [{ sourceId: 'a', targetId: 'b' }] };
      expect(service.findAncestorTaskIds(snapshot, 'a')).toEqual([]);
    });
  });

  describe('findDescendantTaskIds', () => {
    it('finds direct and transitive descendants', () => {
      const snapshot = {
        edges: [
          { sourceId: 'a', targetId: 'b' },
          { sourceId: 'b', targetId: 'c' },
        ],
      };
      const descendants = service.findDescendantTaskIds(snapshot, 'a');
      expect(descendants).toContain('b');
      expect(descendants).toContain('c');
      expect(descendants).not.toContain('a');
    });

    it('excludes the input taskId', () => {
      const snapshot = { edges: [] };
      expect(service.findDescendantTaskIds(snapshot, 'a')).toEqual([]);
    });
  });

  describe('seedTaskOutputsFromExecution', () => {
    it('seeds outputs from completed non-stale ancestor tasks', () => {
      const snapshot = {
        tasks: [{ id: 't1', outputKey: 'key1' }],
      };
      const execution = {
        taskResults: [
          { taskId: 't1', status: StepStatus.COMPLETED, output: 'hello', isStale: false },
        ],
      };
      const outputs = service.seedTaskOutputsFromExecution(execution, snapshot, ['t1']);
      expect(outputs.get('t1')).toBe('hello');
      expect(outputs.get('key1')).toBe('hello');
    });

    it('skips stale tasks', () => {
      const snapshot = { tasks: [{ id: 't1' }] };
      const execution = {
        taskResults: [
          { taskId: 't1', status: StepStatus.COMPLETED, output: 'hello', isStale: true },
        ],
      };
      const outputs = service.seedTaskOutputsFromExecution(execution, snapshot, ['t1']);
      expect(outputs.size).toBe(0);
    });

    it('skips non-ancestor tasks', () => {
      const snapshot = { tasks: [{ id: 't1' }] };
      const execution = {
        taskResults: [
          { taskId: 't1', status: StepStatus.COMPLETED, output: 'hello', isStale: false },
        ],
      };
      const outputs = service.seedTaskOutputsFromExecution(execution, snapshot, ['other']);
      expect(outputs.size).toBe(0);
    });
  });

  describe('mergeWorkspaceContexts', () => {
    it('merges docs from multiple workspace contexts by deduplicating on _id', () => {
      const base = [
        { workspace_id: 'ws1', workspace_documents: [{ _id: 'd1', content: 'A' }] },
      ];
      const extra = [
        { workspace_id: 'ws1', workspace_documents: [{ _id: 'd2', content: 'B' }] },
        { workspace_id: 'ws2', workspace_documents: [{ _id: 'd3', content: 'C' }] },
      ];
      const merged = service.mergeWorkspaceContexts(base, extra);
      const ws1 = merged.find((w) => w.workspace_id === 'ws1')!;
      expect(ws1.workspace_documents.length).toBe(2);
      const ws2 = merged.find((w) => w.workspace_id === 'ws2')!;
      expect(ws2.workspace_documents.length).toBe(1);
    });

    it('returns empty array for null inputs', () => {
      expect(service.mergeWorkspaceContexts(null as any, null as any)).toEqual([]);
    });
  });

  describe('resolveNodeInputs', () => {
    it('maps persisted artifact provenance into canonical payloads', () => {
      const execution = {
        taskResults: [
          {
            taskId: 'source',
            status: StepStatus.COMPLETED,
            isStale: false,
            artifacts: [
              {
                portId: 'out-1',
                artifactKind: 'data',
                data: { total: 3 },
                metadata: { documentId: 'doc-1', workspace_id: 'ws-1' },
                producedAt: '2026-04-20T00:00:00.000Z',
              },
            ],
          },
        ],
      };
      const snapshot = {
        edges: [
          {
            sourceId: 'source',
            targetId: 'target',
            sourceOutputPortId: 'out-1',
            targetInputPortId: 'in-1',
          },
        ],
      };

      const result = service.resolveNodeInputs(execution, snapshot, 'target');

      expect(result).toEqual([
        expect.objectContaining({
          port_id: 'in-1',
          artifact_kind: 'data',
          source_task_id: 'source',
          source_port_id: 'out-1',
          data: { total: 3 },
          ref: expect.objectContaining({
            document_id: 'doc-1',
            workspace_id: 'ws-1',
          }),
          produced_at: '2026-04-20T00:00:00.000Z',
        }),
      ]);
    });
  });

  describe('sanitizeEdgesForTasks', () => {
    it('filters edges with missing task references', () => {
      const tasks = [{ id: 't1', outputPorts: [], inputPorts: [] }];
      const edges = [
        { id: 'e1', sourceId: 't1', targetId: 't2' },
      ];
      const sanitized = service.sanitizeEdgesForTasks(tasks, edges);
      expect(sanitized.length).toBe(0);
      expect(mockLoggerService.warn).toHaveBeenCalled();
    });

    it('keeps valid edges', () => {
      const tasks = [
        { id: 't1', outputPorts: [], inputPorts: [] },
        { id: 't2', outputPorts: [], inputPorts: [] },
      ];
      const edges = [
        { id: 'e1', sourceId: 't1', targetId: 't2' },
      ];
      const sanitized = service.sanitizeEdgesForTasks(tasks, edges);
      expect(sanitized.length).toBe(1);
    });

    it('keeps __trigger__ edges', () => {
      const tasks = [{ id: 't1', outputPorts: [], inputPorts: [] }];
      const edges = [
        { id: 'e1', sourceId: '__trigger__', targetId: 't1', sourceOutputPortId: 'mail_data' },
      ];
      const sanitized = service.sanitizeEdgesForTasks(tasks, edges);
      expect(sanitized.length).toBe(1);
    });

    it('drops edges with stale port references', () => {
      const tasks = [
        { id: 't1', outputPorts: [{ id: 'p1' }], inputPorts: [{ id: 'p2' }] },
        { id: 't2', outputPorts: [], inputPorts: [{ id: 'p3' }] },
      ];
      const edges = [
        { id: 'e1', sourceId: 't1', targetId: 't2', sourceOutputPortId: 'p_invalid', targetInputPortId: 'p3' },
      ];
      const sanitized = service.sanitizeEdgesForTasks(tasks, edges);
      expect(sanitized.length).toBe(0);
      expect(mockLoggerService.warn).toHaveBeenCalled();
    });
  });

  describe('gatherContext', () => {
    it('gathers context from input ports via edges', () => {
      const task = { id: 't2', inputPorts: [{ id: 'default', name: 'Summary' }], inputKeys: [] };
      const taskOutputs = new Map<string, string>([['t1:default', 'output from t1']]);
      const snapshot = { edges: [{ sourceId: 't1', targetId: 't2', sourceOutputPortId: 'default', targetInputPortId: 'default' }] };
      const ctx = service.gatherContext(task, taskOutputs, snapshot);
      expect(ctx).toContain('[Summary]:');
      expect(ctx).toContain('output from t1');
    });

    it('gathers context from inputKeys', () => {
      const task = { id: 't2', inputPorts: [], inputKeys: ['key1'] };
      const taskOutputs = new Map<string, string>([['key1', 'value1']]);
      const snapshot = { edges: [] };
      const ctx = service.gatherContext(task, taskOutputs, snapshot);
      expect(ctx).toContain('[key1]: value1');
    });

    it('returns empty string when no outputs available', () => {
      const task = { id: 't2', inputPorts: [], inputKeys: [] };
      const ctx = service.gatherContext(task, new Map(), { edges: [] });
      expect(ctx).toBe('');
    });
  });

  describe('mergeSnapshotForNewTask', () => {
    it('merges a new task and its connected edges into existing snapshot', () => {
      const existingSnapshot = {
        tasks: [{ id: 't1' }],
        edges: [],
      };
      const playbook = {
        tasks: [{ id: 't1' }, { id: 't2' }],
        edges: [{ sourceId: 't1', targetId: 't2' }],
      };
      const merged = service.mergeSnapshotForNewTask(existingSnapshot, playbook, 't2');
      expect(merged.tasks.length).toBe(2);
      expect(merged.edges.length).toBe(1);
    });

    it('does not duplicate existing tasks', () => {
      const existingSnapshot = {
        tasks: [{ id: 't1' }],
        edges: [],
      };
      const playbook = {
        tasks: [{ id: 't1' }],
        edges: [],
      };
      const merged = service.mergeSnapshotForNewTask(existingSnapshot, playbook, 't1');
      expect(merged.tasks.length).toBe(1);
    });
  });

  describe('refreshSnapshotTask', () => {
    it('replaces the target task with the latest playbook version', () => {
      const existingSnapshot = {
        tasks: [{ id: 't1', title: 'Old Title' }],
        edges: [],
      };
      const playbook = {
        tasks: [{ id: 't1', title: 'New Title' }],
        edges: [],
      };
      const refreshed = service.refreshSnapshotTask(existingSnapshot, playbook, 't1');
      expect(refreshed.tasks[0].title).toBe('New Title');
    });
  });

  describe('buildWorkspaceContextFromUpstreamArtifacts', () => {
    it('returns empty when no completed upstream tasks have artifacts', () => {
      const execution = { taskResults: [] };
      const result = service.buildWorkspaceContextFromUpstreamArtifacts(execution, { edges: [] }, 't1');
      expect(result.workspaceContexts).toEqual([]);
      expect(result.inputFilesByPort).toEqual([]);
    });

    it('builds workspace contexts from document artifacts', () => {
      const execution = {
        taskResults: [
          {
            taskId: 't1',
            status: StepStatus.COMPLETED,
            isStale: false,
            artifacts: [
              {
                portId: 'default',
                artifactKind: 'document',
                url: '/files/doc.pdf',
                filename: 'doc.pdf',
                metadata: { workspaceId: 'ws1' },
              },
            ],
          },
        ],
      };
      const snapshot = {
        edges: [{ sourceId: 't1', targetId: 't2', sourceOutputPortId: 'default' }],
      };
      const result = service.buildWorkspaceContextFromUpstreamArtifacts(execution, snapshot, 't2');
      expect(result.workspaceContexts.length).toBe(1);
      expect(result.inputFilesByPort.length).toBe(1);
    });
  });

  describe('buildRunStepRoutingState', () => {
    it('returns edges and upstream results for a task', () => {
      const execution = {
        taskResults: [
          { taskId: 't1', status: StepStatus.COMPLETED, isStale: false, error: '', durationMs: 100, artifacts: [] },
        ],
      };
      const snapshot = {
        edges: [{ sourceId: 't1', targetId: 't2' }],
      };
      const result = service.buildRunStepRoutingState(execution, snapshot, 't2');
      expect(result.edges.length).toBe(1);
      expect(result.upstreamResults.length).toBe(1);
      expect(result.upstreamResults[0].task_id).toBe('t1');
    });

    it('synthesizes a default text artifact from prior output when artifacts are missing', () => {
      const execution = {
        taskResults: [
          {
            taskId: 't1',
            status: StepStatus.COMPLETED,
            isStale: false,
            error: '',
            durationMs: 100,
            output: 'previous result',
            artifacts: [],
          },
        ],
      };
      const snapshot = {
        edges: [{ sourceId: 't1', targetId: 't2', sourceOutputPortId: 'default', targetInputPortId: 'default' }],
      };

      const result = service.buildRunStepRoutingState(execution, snapshot, 't2');

      expect(result.upstreamResults).toHaveLength(1);
      expect(result.upstreamResults[0].artifacts).toEqual([
        expect.objectContaining({
          port_id: 'default',
          artifact_kind: 'text',
          content: 'previous result',
        }),
      ]);
    });

    it('does not synthesize artifacts for blank output', () => {
      const execution = {
        taskResults: [
          {
            taskId: 't1',
            status: StepStatus.COMPLETED,
            isStale: false,
            error: '',
            durationMs: 100,
            output: '   ',
            artifacts: [],
          },
        ],
      };
      const snapshot = {
        edges: [{ sourceId: 't1', targetId: 't2' }],
      };

      const result = service.buildRunStepRoutingState(execution, snapshot, 't2');

      expect(result.upstreamResults).toHaveLength(1);
      expect(result.upstreamResults[0].artifacts).toEqual([]);
    });

    it('preserves existing artifacts without adding synthetic duplicates', () => {
      const execution = {
        taskResults: [
          {
            taskId: 't1',
            status: StepStatus.COMPLETED,
            isStale: false,
            error: '',
            durationMs: 100,
            output: 'previous result',
            artifacts: [{ portId: 'default', artifactKind: 'text', content: 'artifact result' }],
          },
        ],
      };
      const snapshot = {
        edges: [{ sourceId: 't1', targetId: 't2' }],
      };

      const result = service.buildRunStepRoutingState(execution, snapshot, 't2');

      expect(result.upstreamResults).toHaveLength(1);
      expect(result.upstreamResults[0].artifacts).toEqual([
        expect.objectContaining({
          port_id: 'default',
          artifact_kind: 'text',
          content: 'artifact result',
        }),
      ]);
    });

    it('excludes stale upstream results', () => {
      const execution = {
        taskResults: [
          { taskId: 't1', status: StepStatus.COMPLETED, isStale: true, artifacts: [] },
        ],
      };
      const snapshot = { edges: [{ sourceId: 't1', targetId: 't2' }] };
      const result = service.buildRunStepRoutingState(execution, snapshot, 't2');
      expect(result.upstreamResults.length).toBe(0);
    });

    it('drops trigger edges for single-step routing replay', () => {
      const execution = { taskResults: [] };
      const snapshot = {
        edges: [
          {
            sourceId: '__trigger__',
            targetId: 't2',
            sourceOutputPortId: 'mail_attachments',
            targetInputPortId: 'default',
          },
        ],
      };

      const result = service.buildRunStepRoutingState(execution, snapshot, 't2');

      expect(result.edges).toEqual([]);
    });
  });
});
