import { describe, expect, it, vi } from 'vitest';
import {
  buildPlaybookDeltaPatch,
  buildPlaybookUpdateRequestBody,
  appendDesignMessage,
  clonePlaybook,
  executePlaybook,
  getFlowNodeTemplates,
  getPlaybookTriggers,
  getExecution,
  runAdvisorEvaluation,
  runPlaybookAssistantTurn,
  getPlaybookRepeatability,
  getTaskRepeatability,
  sanitizePlaybookUpdate,
  syncPlaybookTriggerMailSubscription,
  upsertPlaybookTriggerMail,
  upsertPlaybookTriggerSchedule,
  clearPlaybookTriggerSchedule,
  clearPlaybookTriggerMail,
  getPlaybook,
  getReplayReports,
  getTaskReplays,
  getPlaybookUpdateTelemetry,
  updatePlaybook,
  validateTaskReplay,
  buildPlaybookFromConversation,
} from './api';
import { makeTask } from './test-utils';

const apiClientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: apiClientMock,
}));

describe('sanitizePlaybookUpdate', () => {
  it('keeps iterator layout dimensions in task payloads', () => {
    const sanitized = sanitizePlaybookUpdate({
      tasks: [
        makeTask({
          id: 'iterator-1',
          taskType: 'iterator',
          iteratorLayout: { width: 720, height: 560 },
        }),
      ],
    });

    expect(sanitized.tasks).toEqual([
      expect.objectContaining({
        id: 'iterator-1',
        iteratorLayout: { width: 720, height: 560 },
      }),
    ]);
  });

  it('keeps router and human approval configs in task payloads', () => {
    const sanitized = sanitizePlaybookUpdate({
      tasks: [
        makeTask({
          id: 'router-1',
          nodeType: 'router',
          routerConfig: {
            outputLabels: ['retry', 'done', '__error__'],
            maxIterations: 3,
            defaultLabel: 'done',
            conditions: [{
              label: 'done',
              sourceNode: 'task-1',
              sourcePort: 'result',
              path: 'verdict',
              operator: 'equals',
              value: 'valid',
            }],
          },
        }),
        makeTask({
          id: 'approval-1',
          nodeType: 'human_approval',
          humanApprovalConfig: { promptTemplate: 'Please approve', timeoutSeconds: 900 },
        }),
      ],
    });

    expect(sanitized.tasks).toEqual([
      expect.objectContaining({
        id: 'router-1',
        routerConfig: {
          outputLabels: ['retry', 'done', '__error__'],
          maxIterations: 3,
          defaultLabel: 'done',
          conditions: [{
            label: 'done',
            sourceNode: 'task-1',
            sourcePort: 'result',
            path: 'verdict',
            operator: 'equals',
            value: 'valid',
          }],
        },
      }),
      expect.objectContaining({
        id: 'approval-1',
        humanApprovalConfig: { promptTemplate: 'Please approve', timeoutSeconds: 900 },
      }),
    ]);
  });

  it('preserves node-level hitlPolicy through sanitization', () => {
    const sanitized = sanitizePlaybookUpdate({
      tasks: [
        makeTask({
          id: 'task-1',
          hitlPolicy: { mode: 'off', sensitivity: 'minimal', clarificationEnabled: false, approvalEnabled: false, reviewEnabled: false, propagateFeedbackDefault: false, defaultFeedbackScope: 'downstream_run' },
        }),
        makeTask({ id: 'task-2' }),
      ],
    });

    expect(sanitized.tasks).toEqual([
      expect.objectContaining({
        id: 'task-1',
        hitlPolicy: { mode: 'off', sensitivity: 'minimal', clarificationEnabled: false, approvalEnabled: false, reviewEnabled: false, propagateFeedbackDefault: false, defaultFeedbackScope: 'downstream_run' },
      }),
      expect.objectContaining({
        id: 'task-2',
        hitlPolicy: null,
      }),
    ]);
  });

  it('preserves folderpath in input file metadata through sanitization', () => {
    const sanitized = sanitizePlaybookUpdate({
      tasks: [
        makeTask({
          id: 'task-1',
          inputFiles: [{
            type: 'folder',
            id: 'folder-1',
            name: 'Contracts',
            workspaceId: 'ws-1',
            metadata: {
              workspaceId: 'ws-1',
              folderpath: '/legal/contracts',
            },
          }],
        }),
      ],
    });

    expect(sanitized.tasks).toEqual([
      expect.objectContaining({
        inputFiles: [expect.objectContaining({
          metadata: expect.objectContaining({
            workspaceId: 'ws-1',
            folderpath: '/legal/contracts',
          }),
        })],
      }),
    ]);
  });
});

describe('getPlaybookUpdateTelemetry', () => {
  it('is deterministic across key-order differences', () => {
    const first = getPlaybookUpdateTelemetry({
      name: 'Playbook',
      description: 'Description',
      designSettings: { approvalSuggestionMode: 'manual', nodeSuggestionsMode: 'auto', inferenceModelId: 'model-1' },
      settings: { maxParallelism: 2, recursionLimit: 4 },
      workspaces: ['w1'],
    } as any);
    const second = getPlaybookUpdateTelemetry({
      name: 'Playbook',
      description: 'Description',
      designSettings: { inferenceModelId: 'model-1', nodeSuggestionsMode: 'auto', approvalSuggestionMode: 'manual' },
      settings: { recursionLimit: 4, maxParallelism: 2 },
      workspaces: ['w1'],
    } as any);

    expect(first.payloadHash).toBe(second.payloadHash);
    expect(first.payloadBytes).toBe(second.payloadBytes);
  });
});

describe('buildPlaybookUpdateRequestBody', () => {
  it('preserves first-class flow graph fields when callers send them directly', () => {
    const body = buildPlaybookUpdateRequestBody({
      nodes: [{ id: 'node-1', kind: 'step', label: 'Node' }],
      controlEdges: [{ id: 'edge-1', kind: 'sequential', source: 'node-1', target: 'node-2' }],
      expectedDefinitionRevision: 3,
    });

    expect(body).toMatchObject({
      nodes: [{ id: 'node-1', kind: 'step', label: 'Node' }],
      controlEdges: [{ id: 'edge-1', kind: 'sequential', source: 'node-1', target: 'node-2' }],
      expectedDefinitionRevision: 3,
    });
  });

  it('round-trips node-level hitlPolicy from tasks through compat mapping', () => {
    const body = buildPlaybookUpdateRequestBody({
      tasks: [
        makeTask({
          id: 'task-1',
        hitlPolicy: { mode: 'off', sensitivity: 'minimal', clarificationEnabled: false, approvalEnabled: false, reviewEnabled: false, propagateFeedbackDefault: false, defaultFeedbackScope: 'downstream_run' },
        }),
        makeTask({ id: 'task-2' }),
      ],
      expectedDefinitionRevision: 5,
    });

    const nodes = body.nodes as Record<string, unknown>[];
    expect(nodes).toBeDefined();
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({
      id: 'task-1',
      hitlPolicy: { mode: 'off', sensitivity: 'minimal', clarificationEnabled: false, approvalEnabled: false, reviewEnabled: false, propagateFeedbackDefault: false, defaultFeedbackScope: 'downstream_run' },
    });
    expect(nodes[1]).toMatchObject({ id: 'task-2' });
    expect((nodes[1] as Record<string, unknown>).hitlPolicy).toBeUndefined();
  });
});

describe('buildPlaybookDeltaPatch', () => {
  it('keeps omitted graph fields unchanged for partial scalar saves', () => {
    const patch = buildPlaybookDeltaPatch(
      {
        name: 'Old name',
        nodes: [{ id: 'task-1', kind: 'step', label: 'Task' }],
        controlEdges: [{ id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' }],
        dataBindings: [{ id: 'binding-1', targetNode: 'task-1', targetPort: 'default', sourceKind: 'constant' }],
      },
      {
        name: 'New name',
      },
      { expectedDefinitionRevision: 7 },
    );

    expect(patch).toEqual({
      expectedDefinitionRevision: 7,
      patch: {
        fields: { name: 'New name' },
      },
    });
  });

  it('builds structural node, edge, and binding delta patches', () => {
    const patch = buildPlaybookDeltaPatch(
      {
        name: 'Playbook',
        nodes: [
          {
            id: 'task-1',
            kind: 'step',
            label: 'Draft',
            metadata: { positionX: 10, positionY: 20, description: 'old' },
          },
          {
            id: 'task-2',
            kind: 'step',
            label: 'Keep',
            metadata: { positionX: 30, positionY: 40 },
          },
        ],
        controlEdges: [{ id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' }],
        dataBindings: [{
          id: 'binding-1',
          targetNode: 'task-2',
          targetPort: 'input',
          sourceKind: 'node-output',
          sourceNode: 'task-1',
          sourcePort: 'output',
        }],
      },
      {
        name: 'Playbook',
        nodes: [
          {
            id: 'task-1',
            kind: 'step',
            label: 'Draft revised',
            metadata: { positionX: 11, positionY: 21, description: 'new' },
          },
          {
            id: 'task-3',
            kind: 'step',
            label: 'Added',
            metadata: { positionX: 50, positionY: 60 },
          },
        ],
        controlEdges: [{ id: 'edge-2', kind: 'sequential', source: 'task-1', target: 'task-3' }],
        dataBindings: [{
          id: 'binding-2',
          targetNode: 'task-3',
          targetPort: 'input',
          sourceKind: 'constant',
          constantValue: 'hello',
        }],
      },
      { expectedDefinitionRevision: 7 },
    );

    expect(patch).toEqual({
      expectedDefinitionRevision: 7,
      patch: {
        nodes: {
          upserts: [
            {
              id: 'task-1',
              kind: 'step',
              label: 'Draft revised',
              metadata: { positionX: 11, positionY: 21, description: 'new' },
            },
            {
              id: 'task-3',
              kind: 'step',
              label: 'Added',
              metadata: { positionX: 50, positionY: 60 },
            },
          ],
          deleteIds: ['task-2'],
        },
        controlEdges: [{ id: 'edge-2', kind: 'sequential', source: 'task-1', target: 'task-3' }],
        dataBindings: [{
          id: 'binding-2',
          targetNode: 'task-3',
          targetPort: 'input',
          sourceKind: 'constant',
          constantValue: 'hello',
        }],
      },
    });
  });

  it('keeps pure node drags on the position-only path', () => {
    const patch = buildPlaybookDeltaPatch(
      {
        nodes: [{ id: 'task-1', kind: 'step', metadata: { positionX: 10, positionY: 20, description: 'same' } }],
      },
      {
        nodes: [{ id: 'task-1', kind: 'step', metadata: { positionX: 15, positionY: 25, description: 'same' } }],
      },
      { expectedDefinitionRevision: 7 },
    );

    expect(patch).toEqual({
      expectedDefinitionRevision: 7,
      patch: {
        nodes: {
          positionUpdates: [{ id: 'task-1', positionX: 15, positionY: 25 }],
        },
      },
    });
  });
});

describe('playbook repeatability routes', () => {
  it('uses playbook flow repeatability routes for summary and task detail', async () => {
    apiClientMock.get
      .mockResolvedValueOnce({ data: { data: { items: [] } } })
      .mockResolvedValueOnce({ data: { data: [] } });

    await getPlaybookRepeatability('playbook-1', 7, 3);
    await getTaskRepeatability('playbook-1', 'task-1', 9);

    expect(apiClientMock.get).toHaveBeenNthCalledWith(
      1,
      '/playbooks/playbook-1/repeatability',
      { params: { limit: 7, offset: 3 } },
    );
    expect(apiClientMock.get).toHaveBeenNthCalledWith(
      2,
      '/playbooks/playbook-1/repeatability/tasks/task-1',
      { params: { limit: 9 } },
    );
  });
});

describe('flow node template routes', () => {
  it('requests flow node templates from the flow template endpoint', async () => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: {
          items: [
            {
              id: 'router-default',
              nodeType: 'router',
              title: 'Router',
              description: 'Route work',
              icon: 'GitBranch',
              color: 'blue',
              category: 'analysis',
              inputPorts: [],
              outputPorts: [],
              promptTemplate: '',
              recommendedAgentTypeSlug: null,
              requiredToolNames: [],
              routerConfig: {
                outputLabels: ['retry', 'done', '__error__'],
                maxIterations: 3,
                defaultLabel: 'done',
                conditions: [{
                  label: 'done',
                  sourceNode: 'task-1',
                  sourcePort: 'result',
                  path: 'verdict',
                  operator: 'equals',
                  value: 'valid',
                }],
              },
            },
          ],
        },
      },
    });

    const result = await getFlowNodeTemplates();

    expect(apiClientMock.get).toHaveBeenCalledWith('/playbook-flow-templates');
    expect(result.items[0]).toMatchObject({
      id: 'router-default',
      nodeType: 'router',
      routerConfig: {
        outputLabels: ['retry', 'done', '__error__'],
        maxIterations: 3,
        defaultLabel: 'done',
        conditions: [{
          label: 'done',
          sourceNode: 'task-1',
          sourcePort: 'result',
          path: 'verdict',
          operator: 'equals',
          value: 'valid',
        }],
      },
    });
  });
});

describe('playbook trigger routes', () => {
  it('uses trigger routes and returns current trigger payloads', async () => {
    apiClientMock.get.mockReset();
    apiClientMock.put.mockReset();
    apiClientMock.delete.mockReset();
    apiClientMock.get.mockResolvedValueOnce({ data: { data: { triggerConfig: { kind: 'mail', params: { enabled: true, mailboxAppKey: 'm365' } } } } });
    apiClientMock.put.mockResolvedValueOnce({
      data: {
        data: {
          id: 'p1',
          triggerConfig: {
            kind: 'schedule',
            params: { enabled: true, timezone: 'UTC', type: 'daily', daily: { timesLocal: ['09:00'] } },
          },
        },
      },
    });
    apiClientMock.delete.mockResolvedValueOnce({
      data: {
        data: {
          id: 'p1',
          triggerConfig: { kind: 'mail', params: { enabled: false, mailboxAppKey: 'm365' } },
        },
      },
    });

    const triggers = await getPlaybookTriggers('p1');
    const schedule = await upsertPlaybookTriggerSchedule('p1', { enabled: true, timezone: 'UTC', type: 'daily', daily: { timesLocal: ['09:00'] } });
    const mail = await clearPlaybookTriggerMail('p1');

    expect(apiClientMock.get).toHaveBeenCalledWith('/playbooks/p1/triggers');
    expect(triggers).toEqual({
      triggerConfig: { kind: 'mail', params: { enabled: true, mailboxAppKey: 'm365' } },
    });

    expect(apiClientMock.put).toHaveBeenNthCalledWith(
      1,
      '/playbooks/p1/triggers/schedule',
      { enabled: true, timezone: 'UTC', type: 'daily', daily: { timesLocal: ['09:00'] } },
    );
    expect(apiClientMock.delete).toHaveBeenNthCalledWith(
      1,
      '/playbooks/p1/triggers/mail',
    );
    expect(schedule).toMatchObject({
      triggerConfig: {
        kind: 'schedule',
        params: { enabled: true, timezone: 'UTC', type: 'daily', daily: { timesLocal: ['09:00'] } },
      },
    });
    expect(mail).toMatchObject({
      triggerConfig: { kind: 'mail', params: { enabled: false, mailboxAppKey: 'm365' } },
      triggers: [
        expect.objectContaining({
          type: 'mail',
          enabled: false,
        }),
      ],
      automatedTriggerType: null,
    });
  });

  it('normalizes trigger mutation responses for schedule and mail compatibility flows', async () => {
    apiClientMock.put.mockReset();
    apiClientMock.delete.mockReset();

    apiClientMock.put
      .mockResolvedValueOnce({
        data: {
          data: {
            id: 'p3',
            name: 'PB',
            description: '',
            triggerConfig: {
              kind: 'schedule',
              params: { enabled: true, timezone: 'UTC', type: 'daily', daily: { timesLocal: ['08:00'] } },
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            id: 'p3',
            name: 'PB',
            description: '',
            triggerConfig: {
              kind: 'mail',
              params: { enabled: true, mailboxAppKey: 'm365' },
            },
          },
        },
      });

    apiClientMock.delete.mockResolvedValueOnce({
      data: {
        data: {
          id: 'p3',
          name: 'PB',
          description: '',
          triggerConfig: {
            kind: 'schedule',
            params: { enabled: false, timezone: 'UTC', type: 'daily' },
          },
        },
      },
    });

    const savedSchedule = await upsertPlaybookTriggerSchedule('p3', {
      enabled: true,
      timezone: 'UTC',
      type: 'daily',
      daily: { timesLocal: ['08:00'] },
    });
    const savedMail = await upsertPlaybookTriggerMail('p3', {
      enabled: true,
      mailboxAppKey: 'm365',
      filters: { from: [], subjectContains: [], bodyContains: [], hasAttachments: null },
    });
    const clearedSchedule = await clearPlaybookTriggerSchedule('p3');

    expect(savedSchedule.executionSchedule).toMatchObject({
      enabled: true,
      timezone: 'UTC',
      type: 'daily',
      daily: { timesLocal: ['08:00'] },
    });
    expect(savedSchedule.automatedTriggerType).toBe('schedule');
    expect(savedMail.triggers).toEqual([
      expect.objectContaining({
        type: 'mail',
        enabled: true,
        config: expect.objectContaining({ mailboxAppKey: 'm365' }),
      }),
    ]);
    expect(savedMail.automatedTriggerType).toBe('mail');
    expect(clearedSchedule.executionSchedule?.enabled).toBe(false);
    expect(clearedSchedule.automatedTriggerType).toBeNull();
  });

  it('uses the sync-subscription compatibility route', async () => {
    apiClientMock.post.mockReset();
    apiClientMock.post.mockResolvedValueOnce({ data: { data: { ok: true } } });

    const result = await syncPlaybookTriggerMailSubscription('p4', {
      notificationUrl: 'https://example.test/webhook',
      autoRenewUntil: '2026-05-17T00:00:00.000Z',
    });

    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/playbooks/p4/triggers/mail/sync-subscription',
      {
        notificationUrl: 'https://example.test/webhook',
        autoRenewUntil: '2026-05-17T00:00:00.000Z',
      },
    );
    expect(result).toEqual({ ok: true });
  });

  it('returns trigger payloads without legacy normalization', async () => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: {
          triggers: [],
          executionSchedule: null,
          automatedTriggerType: null,
          triggerConfig: {
            kind: 'schedule',
            params: { enabled: true, timezone: 'UTC', type: 'daily', daily: { timesLocal: ['10:00'] } },
          },
        },
      },
    });

    const triggers = await getPlaybookTriggers('p2');

    expect(triggers).toEqual({
      triggers: [],
      executionSchedule: null,
      automatedTriggerType: null,
      triggerConfig: {
        kind: 'schedule',
        params: { enabled: true, timezone: 'UTC', type: 'daily', daily: { timesLocal: ['10:00'] } },
      },
    });
  });
});

describe('validated replay routes', () => {
  it('normalizes replay baseline template fields from replay endpoints', async () => {
    apiClientMock.get.mockReset();
    apiClientMock.post.mockReset();

    apiClientMock.post.mockResolvedValueOnce({
      data: {
        data: {
          _id: 'replay-1',
          flowId: 'playbook-1',
          taskId: 'task-1',
          taskTitle: 'Review customer SLA',
          agentName: 'Agent',
          createdBy: 'user-1',
          referenceExecutionId: 'exec-1',
          referenceExecutionNumber: 2,
          validationVersion: 3,
          status: 'active',
          mode: 'strict_replay',
          toolCalls: [],
          reasoningOutline: [{ stageKey: 'analyze', stageType: 'analysis', label: 'Analyze', description: 'Inspect the request.' }],
          stableReasoningRules: ['Preserve analyze.'],
          contextVariableSchema: [{ key: 'query', label: 'query', source: 'input_context', valueType: 'string', required: true }],
          toolTraceTemplate: [{ stepIndex: 1, toolName: 'search', purpose: 'Find evidence.', argumentShape: { query: 'string' }, required: true }],
          driftPolicy: { requireSameIntent: true },
          acceptedExamples: [{ referenceExecutionId: 'exec-1', referenceExecutionNumber: 2, summary: 'Validated replay baseline for Review customer SLA.' }],
          createdAt: '2026-05-24T12:00:00.000Z',
          updatedAt: '2026-05-24T12:00:00.000Z',
        },
      },
    });
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: [{
          _id: 'replay-1',
          flowId: 'playbook-1',
          taskId: 'task-1',
          taskTitle: 'Review customer SLA',
          agentName: 'Agent',
          createdBy: 'user-1',
          referenceExecutionId: 'exec-1',
          referenceExecutionNumber: 2,
          validationVersion: 3,
          status: 'active',
          mode: 'strict_replay',
          toolCalls: [],
          createdAt: '2026-05-24T12:00:00.000Z',
          updatedAt: '2026-05-24T12:00:00.000Z',
        }],
      },
    });

    const created = await validateTaskReplay('playbook-1', 'task-1', {
      executionId: 'exec-1',
      iteration: 2,
      mode: 'replay_flex',
    });
    const listed = await getTaskReplays('playbook-1', 'task-1');

    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/playbooks/playbook-1/tasks/task-1/validate-replay',
      { executionId: 'exec-1', iteration: 2, mode: 'replay_flex', preserveOutputFormat: false },
    );

    expect(created).toMatchObject({
      id: 'replay-1',
      playbookId: 'playbook-1',
      intentKey: null,
      outputContract: null,
      reasoningOutline: [{ stageKey: 'analyze', stageType: 'analysis', label: 'Analyze', description: 'Inspect the request.' }],
      stableReasoningRules: ['Preserve analyze.'],
      contextVariableSchema: [{ key: 'query', label: 'query', source: 'input_context', valueType: 'string', required: true }],
      toolTraceTemplate: [{ stepIndex: 1, toolName: 'search', purpose: 'Find evidence.', argumentShape: { query: 'string' }, required: true }],
      acceptedExamples: [{ referenceExecutionId: 'exec-1', referenceExecutionNumber: 2, summary: 'Validated replay baseline for Review customer SLA.' }],
    });
    expect(listed[0]).toMatchObject({ id: 'replay-1', playbookId: 'playbook-1', reasoningOutline: [] });
  });

  it('passes iteration when fetching replay reports', async () => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: [],
      },
    });

    await getReplayReports('playbook-1', 'task-1', { executionId: 'exec-1', iteration: 2, limit: 1 });

    expect(apiClientMock.get).toHaveBeenCalledWith(
      '/playbooks/playbook-1/tasks/task-1/replay-reports',
      { params: { executionId: 'exec-1', iteration: 2, limit: 1 } },
    );
  });
});

describe('updatePlaybook', () => {
  it('uses the completed-operation commit endpoint for assistant construction saves', async () => {
    apiClientMock.post.mockReset();
    apiClientMock.patch.mockClear();
    apiClientMock.post.mockResolvedValueOnce({
      data: { data: { id: 'playbook-1', name: 'Generated', nodes: [], controlEdges: [], dataBindings: [], triggers: [], workspaces: [] } },
    });

    await updatePlaybook('playbook-1', {
      name: 'Generated',
      tasks: [],
      edges: [],
      dataBindings: [],
      expectedDefinitionRevision: 5,
      assistantOperationId: 'operation-1',
    });

    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/playbooks/playbook-1/intent-constructions/operation-1/commit',
      expect.objectContaining({ expectedDefinitionRevision: 5, nodes: [] }),
    );
    expect(apiClientMock.patch).not.toHaveBeenCalled();
  });

  it('uses the explicit apply endpoint for Advisor preview saves', async () => {
    apiClientMock.post.mockReset();
    apiClientMock.patch.mockClear();
    apiClientMock.post.mockResolvedValueOnce({
      data: { data: { id: 'playbook-1', name: 'Optimized', nodes: [], controlEdges: [], dataBindings: [], triggers: [], workspaces: [] } },
    });

    await updatePlaybook('playbook-1', {
      name: 'Optimized',
      tasks: [],
      edges: [],
      dataBindings: [],
      expectedDefinitionRevision: 5,
      assistantOperationId: 'advisor-1',
      assistantOperationTarget: 'advisor_preview',
    });

    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/playbooks/playbook-1/intent-constructions/advisor-1/apply',
      expect.objectContaining({ expectedDefinitionRevision: 5, nodes: [] }),
    );
    expect(apiClientMock.patch).not.toHaveBeenCalled();
  });

  it('sends empty flow arrays so the backend can clear persisted canvas state', async () => {
    apiClientMock.patch.mockReset();
    apiClientMock.patch.mockResolvedValueOnce({
      data: {
        data: {
          id: 'playbook-1',
          name: 'Playbook',
          description: 'Description',
          nodes: [],
          controlEdges: [],
          dataBindings: [],
          triggers: [],
          workspaces: [],
        },
      },
    });

    await updatePlaybook('playbook-1', {
      name: 'Playbook',
      description: 'Description',
      tasks: [],
      edges: [],
      dataBindings: [],
    });

    expect(apiClientMock.patch).toHaveBeenCalledWith('/playbooks/playbook-1', expect.objectContaining({
      nodes: [],
      controlEdges: [],
      dataBindings: [],
    }));
  });

  it('filters legacy trigger mirror edges out of persisted control edges', async () => {
    apiClientMock.patch.mockReset();
    apiClientMock.patch.mockResolvedValueOnce({
      data: {
        data: {
          id: 'playbook-1',
          name: 'Playbook',
          description: 'Description',
          nodes: [],
          controlEdges: [{
            id: 'router-edge',
            kind: 'conditional',
            source: 'router-1',
            target: 'task-2',
            routerLabel: 'approved',
            sourceOutputPortId: 'approved',
            targetInputPortId: 'prompt',
          }],
          dataBindings: [{
            id: 'binding-1',
            targetNode: 'task-2',
            targetPort: 'prompt',
            sourceKind: 'trigger',
            triggerPath: 'mail_data',
          }],
          triggers: [],
          workspaces: [],
        },
      },
    });

    await updatePlaybook('playbook-1', {
      name: 'Playbook',
      description: 'Description',
      tasks: [
        makeTask({ id: 'router-1', nodeType: 'router', outputPorts: [{ id: 'approved', name: 'Approved', artifactKind: 'text' }] }),
        makeTask({ id: 'task-2', inputPorts: [{ id: 'prompt', name: 'Prompt', artifactKind: 'text', required: false }] }),
      ],
      edges: [
        {
          id: 'binding-edge',
          sourceId: '__trigger__',
          targetId: 'task-2',
          sourceOutputPortId: 'mail_data',
          targetInputPortId: 'prompt',
        },
        {
          id: 'router-edge',
          sourceId: 'router-1',
          targetId: 'task-2',
          sourceOutputPortId: 'approved',
          targetInputPortId: 'prompt',
        },
      ],
      dataBindings: [{
        id: 'binding-1',
        targetNode: 'task-2',
        targetPort: 'prompt',
        sourceKind: 'trigger',
        triggerPath: 'mail_data',
      }],
    });

    expect(apiClientMock.patch).toHaveBeenCalledWith('/playbooks/playbook-1', expect.objectContaining({
      controlEdges: [{
        id: 'router-edge',
        kind: 'conditional',
        source: 'router-1',
        target: 'task-2',
        routerLabel: 'approved',
        sourceOutputPortId: 'approved',
        targetInputPortId: 'prompt',
      }],
    }));
  });

  it('omits flow arrays when they were not part of the update payload', async () => {
    apiClientMock.patch.mockReset();
    apiClientMock.patch.mockResolvedValueOnce({
      data: {
        data: {
          id: 'playbook-1',
          name: 'Renamed',
          description: 'Description',
          triggers: [],
          workspaces: [],
        },
      },
    });

    await updatePlaybook('playbook-1', {
      name: 'Renamed',
      description: 'Description',
    });

    expect(apiClientMock.patch).toHaveBeenCalledWith('/playbooks/playbook-1', {
      name: 'Renamed',
      description: 'Description',
      workspaces: undefined,
    });
  });

  it('passes suggestion save metadata through the patch payload', async () => {
    apiClientMock.patch.mockReset();
    apiClientMock.patch.mockResolvedValueOnce({
      data: {
        data: {
          id: 'playbook-1',
          name: 'Playbook',
          description: 'Description',
          nodes: [],
          controlEdges: [],
          dataBindings: [],
          triggers: [],
          workspaces: [],
        },
      },
    });

    await updatePlaybook('playbook-1', {
      name: 'Playbook',
      description: 'Description',
      expectedDefinitionRevision: 5,
      clientMutationId: 'intent-abc123',
    });

    expect(apiClientMock.patch).toHaveBeenCalledWith('/playbooks/playbook-1', expect.objectContaining({
      expectedDefinitionRevision: 5,
      clientMutationId: 'intent-abc123',
    }));
  });

  it('preserves router and human approval configs when saving flow nodes', async () => {
    apiClientMock.patch.mockReset();
    apiClientMock.patch.mockResolvedValueOnce({
      data: {
        data: {
          id: 'playbook-1',
          name: 'Playbook',
          description: 'Description',
          nodes: [],
          controlEdges: [],
          dataBindings: [],
          triggers: [],
          workspaces: [],
        },
      },
    });

    await updatePlaybook('playbook-1', {
      name: 'Playbook',
      description: 'Description',
      tasks: [
        makeTask({
          id: 'router-1',
          nodeType: 'router',
          routerConfig: {
            outputLabels: ['retry', 'done', '__error__'],
            maxIterations: 3,
            defaultLabel: 'done',
            conditions: [{
              label: 'done',
              sourceNode: 'task-1',
              sourcePort: 'result',
              path: 'verdict',
              operator: 'equals',
              value: 'valid',
            }],
          },
        }),
        makeTask({
          id: 'approval-1',
          nodeType: 'human_approval',
          humanApprovalConfig: { promptTemplate: 'Please approve', timeoutSeconds: 900 },
        }),
      ],
      edges: [],
      dataBindings: [],
    });

    expect(apiClientMock.patch).toHaveBeenCalledWith(
      '/playbooks/playbook-1',
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: 'router-1',
            kind: 'router',
            routerConfig: {
              outputLabels: ['retry', 'done', '__error__'],
              maxIterations: 3,
              defaultLabel: 'done',
              conditions: [{
                label: 'done',
                sourceNode: 'task-1',
                sourcePort: 'result',
                path: 'verdict',
                operator: 'equals',
                value: 'valid',
              }],
            },
          }),
          expect.objectContaining({
            id: 'approval-1',
            kind: 'human_approval',
            humanApprovalConfig: { promptTemplate: 'Please approve', timeoutSeconds: 900 },
          }),
        ]),
      }),
    );
  });

  it('preserves explicit source and target port ids when saving and normalizing edges', async () => {
    apiClientMock.patch.mockReset();
    apiClientMock.patch.mockResolvedValueOnce({
      data: {
        data: {
          id: 'playbook-1',
          name: 'Playbook',
          description: 'Description',
          nodes: [
            {
              id: 'router-1',
              kind: 'router',
              label: 'Router',
              metadata: {},
              output: { ports: [{ id: 'approved', label: 'Approved', type: 'text' }] },
            },
            {
              id: 'task-2',
              kind: 'step',
              label: 'Task 2',
              metadata: {},
              input: { ports: [{ id: 'input-doc', label: 'Input', type: 'text', required: false }] },
            },
          ],
          controlEdges: [{
            id: 'edge-1',
            kind: 'conditional',
            source: 'router-1',
            target: 'task-2',
            routerLabel: 'approved',
            sourceOutputPortId: 'approved',
            targetInputPortId: 'input-doc',
          }],
          dataBindings: [],
          triggers: [],
          workspaces: [],
        },
      },
    });

    const playbook = await updatePlaybook('playbook-1', {
      name: 'Playbook',
      description: 'Description',
      tasks: [
        makeTask({ id: 'router-1', nodeType: 'router', outputPorts: [{ id: 'approved', name: 'Approved', artifactKind: 'text' }] }),
        makeTask({ id: 'task-2', inputPorts: [{ id: 'input-doc', name: 'Input', artifactKind: 'text', required: false }] }),
      ],
      edges: [{
        id: 'edge-1',
        sourceId: 'router-1',
        targetId: 'task-2',
        sourceOutputPortId: 'approved',
        targetInputPortId: 'input-doc',
      }],
    });

    expect(apiClientMock.patch).toHaveBeenCalledWith('/playbooks/playbook-1', expect.objectContaining({
      controlEdges: [{
        id: 'edge-1',
        kind: 'conditional',
        source: 'router-1',
        target: 'task-2',
        routerLabel: 'approved',
        sourceOutputPortId: 'approved',
        targetInputPortId: 'input-doc',
      }],
    }));
    expect(playbook.edges).toEqual([{
      id: 'edge-1',
      sourceId: 'router-1',
      targetId: 'task-2',
      sourceOutputPortId: 'approved',
      targetInputPortId: 'input-doc',
    }]);
  });
});

describe('getPlaybook', () => {
  it('normalizes flow-shaped tasks from the backend into legacy playbook tasks', async () => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: {
          id: 'playbook-1',
          name: 'Playbook',
          description: 'Description',
          tasks: [{
            id: 'node-1',
            kind: 'step',
            label: 'Flow node',
            metadata: {
              description: 'Flow description',
              executionOrder: 2,
              positionX: 10,
              positionY: 20,
              nodeType: 'agent',
            },
          }],
          controlEdges: [],
          dataBindings: [],
          triggers: [],
          workspaces: [],
        },
      },
    });

    const playbook = await getPlaybook('playbook-1');

    expect(playbook.tasks).toEqual([
      expect.objectContaining({
        id: 'node-1',
        title: 'Flow node',
        description: 'Flow description',
        executionOrder: 2,
        positionX: 10,
        positionY: 20,
      }),
    ]);
  });

  it('restores saved control-edge port ids into legacy edge handles', async () => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: {
          id: 'playbook-1',
          name: 'Playbook',
          description: 'Description',
          nodes: [],
          controlEdges: [{
            id: 'edge-1',
            kind: 'sequential',
            source: 'task-1',
            target: 'task-2',
            sourceOutputPortId: 'out-2',
            targetInputPortId: 'in-3',
          }],
          dataBindings: [],
          triggers: [],
          workspaces: [],
        },
      },
    });

    const playbook = await getPlaybook('playbook-1');

    expect(playbook.edges).toEqual([{
      id: 'edge-1',
      sourceId: 'task-1',
      targetId: 'task-2',
      sourceOutputPortId: 'out-2',
      targetInputPortId: 'in-3',
    }]);
  });
});

describe('executePlaybook', () => {
  it('drops unsupported full-workflow execution fields before calling the flow API', async () => {
    apiClientMock.post.mockReset();
    apiClientMock.post.mockResolvedValueOnce({
      data: {
        data: {
          executionId: 'exec-1',
        },
      },
    });

    await executePlaybook('playbook-1', {
      executionMode: 'inherit',
      stepExecutionModes: { 'task-1': 'replay_flex' },
      streaming: true,
      runNodeReflection: true,
      advisorAutopilotEnabled: true,
      advisorAutopilotTargetScore: 92,
      advisorAutopilotMaxTurns: 4,
    });

    expect(apiClientMock.post).toHaveBeenCalledWith('/playbooks/playbook-1/executions', {
      executionMode: 'inherit',
      stepExecutionModes: { 'task-1': 'replay_flex' },
      reflectionEnabled: true,
      advisorAutopilotEnabled: true,
      advisorAutopilotTargetScore: 92,
      advisorAutopilotMaxTurns: 4,
    });
  });

  it('keeps the single-step target when starting a standalone node execution', async () => {
    apiClientMock.post.mockReset();
    apiClientMock.post.mockResolvedValueOnce({
      data: {
        data: {
          executionId: 'exec-2',
        },
      },
    });

    await executePlaybook('playbook-1', {
      singleStepTaskId: 'task-7',
      executionMode: 'live',
      stepExecutionModes: { 'task-7': 'replay_strict' },
    });

    expect(apiClientMock.post).toHaveBeenCalledWith('/playbooks/playbook-1/executions', {
      singleStepTaskId: 'task-7',
      executionMode: 'live',
      stepExecutionModes: { 'task-7': 'replay_strict' },
    });
  });
});

describe('design message API', () => {
  it('runs a dedicated Playbook assistant turn with revision context', async () => {
    apiClientMock.post.mockReset();
    apiClientMock.post.mockResolvedValueOnce({
      data: { data: { answer: 'Two tasks.', operation: null } },
    });

    const result = await runPlaybookAssistantTurn('playbook-1', {
      message: 'How many tasks?',
      expectedDefinitionRevision: 7,
      selectedTaskId: 'task-1',
    });

    expect(apiClientMock.post).toHaveBeenCalledWith('/playbooks/playbook-1/assistant/turns', {
      message: 'How many tasks?',
      expectedDefinitionRevision: 7,
      selectedTaskId: 'task-1',
    }, { timeout: 180000 });
    expect(result).toEqual({ answer: 'Two tasks.', operation: null });
  });

  it('appends a designer sidebar interaction', async () => {
    apiClientMock.post.mockReset();
    apiClientMock.post.mockResolvedValueOnce({
      data: {
        data: {
          id: 'message-1',
          playbookId: 'playbook-1',
          userQuery: 'Add scoring',
          aiSummary: 'Assistant processed the request.',
          snapshotBefore: { tasks: [], edges: [] },
          status: 'completed',
          revertedFromMessageId: null,
          error: null,
          createdAt: '2026-06-22T08:00:00Z',
          updatedAt: '2026-06-22T08:00:00Z',
        },
      },
    });

    const result = await appendDesignMessage('playbook-1', {
      userQuery: 'Add scoring',
      aiSummary: 'Assistant processed the request.',
    });

    expect(apiClientMock.post).toHaveBeenCalledWith('/playbooks/playbook-1/design-messages', {
      userQuery: 'Add scoring',
      aiSummary: 'Assistant processed the request.',
    });
    expect(result.userQuery).toBe('Add scoring');
  });
});

describe('clonePlaybook', () => {
  it('normalizes flow-shaped clone responses into playbooks', async () => {
    apiClientMock.post.mockReset();
    apiClientMock.post.mockResolvedValueOnce({
      data: {
        data: {
          id: 'playbook-2',
          name: 'Playbook (copy)',
          description: 'Cloned',
          nodes: [
            {
              id: 'task-1',
              label: 'Task 1',
              kind: 'step',
              metadata: {},
            },
          ],
          controlEdges: [
            {
              id: 'edge-1',
              kind: 'sequential',
              source: 'task-1',
              target: 'task-2',
            },
          ],
          workspaces: [],
          reflectionEnabled: true,
          advisorAutopilotEnabled: true,
        },
      },
    });

    const cloned = await clonePlaybook('playbook-1');

    expect(apiClientMock.post).toHaveBeenCalledWith('/playbooks/playbook-1/clone');
    expect(cloned.tasks).toHaveLength(1);
    expect(cloned.edges).toHaveLength(1);
    expect(cloned.reflectionEnabled).toBe(true);
    expect(cloned.advisorAutopilotEnabled).toBe(true);
    expect(cloned.isFavorite).toBe(false);
  });
});

describe('getExecution', () => {
  it('normalizes persisted HITL events into execution and task feedback history', async () => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: {
          id: 'exec-hitl',
          flowId: 'playbook-1',
          ownerId: 'user-1',
          status: 'completed',
          pendingApproval: null,
          recursionLimit: 25,
          maxParallelism: 1,
          taskResults: [{
            taskId: 'task-1',
            status: 'completed',
            output: 'Result',
            iteration: 0,
          }],
          hitlEvents: [{
            id: 'event-1',
            nodeId: 'task-1',
            iteration: 0,
            interruptId: 'interrupt-1',
            type: 'clarification',
            reasonCode: 'missing_required_input',
            riskLevel: 'medium',
            prompt: 'Which region should I search?',
            payload: { taskTitle: 'Lead search' },
            status: 'answered',
            response: { action: 'reply', message: 'France', scope: 'downstream_run', remember: false },
            downstreamNodeIds: [],
            createdAt: '2026-06-02T08:46:00.000Z',
            respondedAt: '2026-06-02T08:47:00.000Z',
          }],
          routerDecisions: [],
          createdAt: '2026-06-02T08:45:00.000Z',
          updatedAt: '2026-06-02T08:48:00.000Z',
        },
      },
    });

    const execution = await getExecution('playbook-1', 'exec-hitl');

    expect(execution.hitlHistory).toEqual([
      expect.objectContaining({
        interruptId: 'interrupt-1',
        taskId: 'task-1',
        message: 'Which region should I search?',
        responseMessage: 'France',
      }),
    ]);
    expect(execution.taskResults[0].hitlHistory).toEqual(execution.hitlHistory);
  });

  it('normalizes displayText and snake_case artifacts from flow execution details', async () => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: {
          id: 'exec-1',
          flowId: 'playbook-1',
          ownerId: 'user-1',
          status: 'completed',
          pendingApproval: null,
          recursionLimit: 25,
          maxParallelism: 1,
          taskResults: [{
            taskId: 'task-1',
            status: 'completed',
            output: '{"display_text":"raw"}',
            displayText: 'Readable answer',
            artifacts: [{
              port_id: 'report',
              artifact_kind: 'document',
              filename: 'report.pdf',
              url: 'https://example.com/report.pdf',
              mime_type: 'application/pdf',
            }],
          }],
          routerDecisions: [],
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:01.000Z',
        },
      },
    });

    const execution = await getExecution('playbook-1', 'exec-1');

    expect(execution.taskResults[0]).toMatchObject({
      displayText: 'Readable answer',
      artifacts: [{
        portId: 'report',
        artifactKind: 'document',
        filename: 'report.pdf',
        url: 'https://example.com/report.pdf',
        mimeType: 'application/pdf',
      }],
    });
  });

  it('normalizes judge result metrics from execution task results', async () => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: {
          id: 'exec-judge',
          flowId: 'playbook-1',
          ownerId: 'user-1',
          status: 'completed',
          pendingApproval: null,
          recursionLimit: 25,
          maxParallelism: 1,
          taskResults: [{
            taskId: 'task-1',
            status: 'completed',
            output: 'Result',
            judge_result: {
              accuracy_score: 96,
              completeness_score: 92,
              result_matching_score: 98,
              overall_score: 95,
              confidence: 94,
              tool_usage_score: 90,
              relevance_score: 99,
              specificity_score: 93,
              format_compliance_score: 88,
              evidence_grounding_score: 97,
              handoff_readiness_score: 94,
              hitl_appropriateness_score: 98,
              determinism_score: 96,
              cost_efficiency_score: 84,
              step_optimization_priority: 28,
              playbook_optimization_priority: 41,
              cost_optimization_priority: 22,
            },
          }],
          routerDecisions: [],
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:01.000Z',
        },
      },
    });

    const execution = await getExecution('playbook-1', 'exec-judge');

    expect(execution.taskResults[0].judgeResult).toMatchObject({
      relevanceScore: 99,
      specificityScore: 93,
      formatComplianceScore: 88,
      evidenceGroundingScore: 97,
      handoffReadinessScore: 94,
      hitlAppropriatenessScore: 98,
      determinismScore: 96,
      stepOptimizationPriority: 28,
      playbookOptimizationPriority: 41,
      costOptimizationPriority: 22,
      costEfficiencyScore: 84,
    });
  });

  it('normalizes snake_case judge history result metrics from execution task results', async () => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: {
          id: 'exec-judge-history',
          flowId: 'playbook-1',
          ownerId: 'user-1',
          status: 'completed',
          pendingApproval: null,
          recursionLimit: 25,
          maxParallelism: 1,
          taskResults: [{
            taskId: 'task-1',
            status: 'completed',
            output: 'Result',
            judge_history: [{
              id: 'judge-1',
              created_at: '2025-01-01T00:00:01.000Z',
              attempt_number: 1,
              scoring_mode: 'llm',
              judge_result: {
                accuracy_score: 96,
                completeness_score: 92,
                result_matching_score: 90,
                overall_score: 93,
                confidence: 95,
                tool_usage_score: 98,
                relevance_score: 99,
                specificity_score: 93,
                format_compliance_score: 88,
                evidence_grounding_score: 97,
                handoff_readiness_score: 94,
                hitl_appropriateness_score: 98,
                determinism_score: 96,
                cost_efficiency_score: 91,
                step_optimization_priority: 28,
                playbook_optimization_priority: 41,
                cost_optimization_priority: 24,
              },
            }],
          }],
          routerDecisions: [],
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:01.000Z',
        },
      },
    });

    const execution = await getExecution('playbook-1', 'exec-judge-history');

    expect(execution.taskResults[0].judgeHistory?.[0]).toMatchObject({
      createdAt: '2025-01-01T00:00:01.000Z',
      attemptNumber: 1,
      scoringMode: 'llm',
      judgeResult: {
        overallScore: 93,
        relevanceScore: 99,
        specificityScore: 93,
        formatComplianceScore: 88,
        evidenceGroundingScore: 97,
        handoffReadinessScore: 94,
        hitlAppropriatenessScore: 98,
        determinismScore: 96,
        costEfficiencyScore: 91,
        stepOptimizationPriority: 28,
        playbookOptimizationPriority: 41,
        costOptimizationPriority: 24,
      },
    });
  });

  it('restores iterator iterations from snake_case fields and serialized output payloads', async () => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: {
          id: 'exec-iterator',
          flowId: 'playbook-1',
          ownerId: 'user-1',
          status: 'completed',
          pendingApproval: null,
          recursionLimit: 25,
          maxParallelism: 1,
          taskResults: [{
            taskId: 'iterator-1',
            status: 'completed',
            output: JSON.stringify({
              iterator_iterations: [{
                index: 0,
                status: 'completed',
                item_preview: 'product a',
                output: 'raw child aggregate',
                child_results: [{
                  task_id: 'child-1',
                  task_title: 'Fetch account',
                  status: 'completed',
                  output: 'Child output',
                  tool_trace: [],
                  llm_prompt_trace: [],
                }],
              }],
              count: 1,
            }),
          }],
          routerDecisions: [],
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:01.000Z',
        },
      },
    });

    const execution = await getExecution('playbook-1', 'exec-iterator');

    expect(execution.taskResults[0].iteratorIterations).toEqual([
      expect.objectContaining({
        index: 0,
        status: 'completed',
        itemPreview: 'product a',
        output: 'raw child aggregate',
        childResults: [
          expect.objectContaining({
            taskId: 'child-1',
            taskTitle: 'Fetch account',
            status: 'completed',
            output: 'Child output',
          }),
        ],
      }),
    ]);
  });

  it('prefers serialized iterator payloads when the top-level iterator array is empty', async () => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: {
          id: 'exec-iterator-empty',
          flowId: 'playbook-1',
          ownerId: 'user-1',
          status: 'completed',
          pendingApproval: null,
          recursionLimit: 25,
          maxParallelism: 1,
          taskResults: [{
            taskId: 'iterator-1',
            status: 'completed',
            iteratorIterations: [],
            output: JSON.stringify({
              iterator_iterations: [{
                index: 0,
                status: 'completed',
                item_preview: 'product a',
                output: 'raw child aggregate',
              }],
              count: 1,
            }),
          }],
          routerDecisions: [],
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:01.000Z',
        },
      },
    });

    const execution = await getExecution('playbook-1', 'exec-iterator-empty');

    expect(execution.taskResults[0].iteratorIterations).toEqual([
      expect.objectContaining({
        index: 0,
        status: 'completed',
        itemPreview: 'product a',
        output: 'raw child aggregate',
      }),
    ]);
  });

  it('preserves advisor task and execution fields when loading historical execution data', async () => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: {
          id: 'exec-2',
          flowId: 'playbook-1',
          ownerId: 'user-1',
          status: 'completed',
          advisorAutopilotEnabled: true,
          advisorAutopilotStatus: 'completed',
          judgeSummaryStatus: 'evaluated',
          judgeSummary: {
            overallScore: 88,
            confidence: 0.8,
            structuralIssues: [],
            promptIssues: [],
            contractIssues: [],
            handoffIssues: [],
            toolUsageIssues: [],
            crossStepToolPatterns: [],
            rootCauseTaskIds: [],
            highImpactRecommendations: [],
            recommendation: 'update_current_playbook',
            reason: 'Looks good.',
          },
          pendingApproval: null,
          recursionLimit: 25,
          maxParallelism: 1,
          taskResults: [{
            taskId: 'task-1',
            status: 'completed',
            output: 'advisor output',
            judgeStatus: 'evaluated',
            judgeError: null,
            judgeResult: { overallScore: 91, confidence: 0.87 },
            judgeHistory: [{
              id: 'judge-1',
              createdAt: '2025-01-01T00:00:01.000Z',
              attemptNumber: 1,
              model: 'advisor-v1',
              judgeResult: { overallScore: 91, confidence: 0.87 },
            }],
          }],
          routerDecisions: [],
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:02.000Z',
        },
      },
    });

    const execution = await getExecution('playbook-1', 'exec-2');

    expect(execution).toMatchObject({
      advisorAutopilotEnabled: true,
      advisorAutopilotStatus: 'completed',
      judgeSummaryStatus: 'evaluated',
      judgeSummary: expect.objectContaining({ overallScore: 88 }),
    });
    expect(execution.taskResults[0]).toMatchObject({
      judgeStatus: 'evaluated',
      judgeError: null,
      judgeResult: expect.objectContaining({ overallScore: 91, confidence: 0.87 }),
      judgeHistory: [expect.objectContaining({ id: 'judge-1' })],
    });
  });

  it('normalizes step execution modes from execution details', async () => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: {
          id: 'exec-3',
          flowId: 'playbook-1',
          ownerId: 'user-1',
          status: 'running',
          executionMode: 'inherit',
          stepExecutionModes: {
            'task-1': 'replay_flex',
            'task-2': 'live',
          },
          pendingApproval: null,
          recursionLimit: 25,
          maxParallelism: 1,
          taskResults: [],
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:01.000Z',
        },
      },
    });

    const execution = await getExecution('playbook-1', 'exec-3');

    expect(execution.executionMode).toBe('inherit');
    expect(execution.stepExecutionModes).toEqual({
      'task-1': 'replay_flex',
      'task-2': 'live',
    });
  });

  it('normalizes replay source from execution details', async () => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: {
          id: 'exec-replay',
          flowId: 'playbook-1',
          ownerId: 'user-1',
          status: 'running',
          replaySource: {
            executionId: 'source-exec',
            taskId: 'task-9',
            iteration: 2,
          },
          pendingApproval: null,
          recursionLimit: 25,
          maxParallelism: 1,
          taskResults: [],
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:01.000Z',
        },
      },
    });

    const execution = await getExecution('playbook-1', 'exec-replay');

    expect(execution.replaySource).toEqual({
      executionId: 'source-exec',
      taskId: 'task-9',
      iteration: 2,
    });
  });

  it('hydrates clarification interrupt payloads from pendingApproval', async () => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: {
          id: 'exec-clarification',
          flowId: 'playbook-1',
          ownerId: 'user-1',
          status: 'pending_approval',
          threadId: 'thread-1',
          pendingApproval: {
            nodeId: 'task-1',
            iteration: 2,
            prompt: 'Which country did you mean?',
            interruptType: 'clarification',
            interruptId: 'task-1:clarification:2',
            taskTitle: 'GDP Analysis',
            taskDescription: 'Need a target country',
            result: '',
            payloadJson: '[]',
            resumableActions: ['reply', 'skip'],
          },
          recursionLimit: 25,
          maxParallelism: 1,
          taskResults: [],
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:01.000Z',
        },
      },
    });

    const execution = await getExecution('playbook-1', 'exec-clarification');

    expect(execution.interruptPayload).toEqual(expect.objectContaining({
      type: 'clarification',
      taskId: 'task-1',
      taskTitle: 'GDP Analysis',
      message: 'Which country did you mean?',
      threadId: 'thread-1',
      interruptId: 'task-1:clarification:2',
      round: 2,
      taskDescription: 'Need a target country',
      payloadJson: '[]',
      resumableActions: ['reply', 'skip'],
    }));
    expect(execution.waitingForHumanInput).toBe(true);
  });

  it('maps legacy human_approval pendingApproval type to approval_request', async () => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: {
          id: 'exec-approval',
          flowId: 'playbook-1',
          ownerId: 'user-1',
          status: 'pending_approval',
          threadId: 'thread-1',
          pendingApproval: {
            nodeId: 'task-1',
            iteration: 0,
            prompt: 'Approve?',
            interruptType: 'human_approval',
          },
          recursionLimit: 25,
          maxParallelism: 1,
          taskResults: [],
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:01.000Z',
        },
      },
    });

    const execution = await getExecution('playbook-1', 'exec-approval');

    expect(execution.interruptPayload?.type).toBe('approval_request');
  });

  it('uses the execution advisor endpoint and normalizes the returned task result', async () => {
    apiClientMock.post.mockReset();
    apiClientMock.post.mockResolvedValueOnce({
      data: {
        data: {
          executionId: 'exec-3',
          taskId: 'task-9',
          taskResult: {
            taskId: 'task-9',
            iteration: 2,
            status: 'completed',
            output: 'advisor output',
            judgeStatus: 'evaluated',
            judgeResult: { overallScore: 77, confidence: 0.65 },
            judgeHistory: [{
              id: 'judge-2',
              createdAt: '2025-01-01T00:00:01.000Z',
              attemptNumber: 2,
              model: 'advisor-v2',
              judgeResult: { overallScore: 77, confidence: 0.65 },
            }],
          },
          judgeSummaryStatus: 'evaluated',
          judgeSummary: { overallScore: 77, confidence: 0.65 },
        },
      },
    });

    const result = await runAdvisorEvaluation('exec-3', 'task-9', 2, 'heuristic');

    expect(apiClientMock.post).toHaveBeenCalledWith('/executions/exec-3/tasks/task-9/advisor-evaluation', {
      iteration: 2,
      advisorScoringMode: 'heuristic',
    });
    expect(result).toMatchObject({
      executionId: 'exec-3',
      taskId: 'task-9',
      judgeSummaryStatus: 'evaluated',
      judgeSummary: expect.objectContaining({ overallScore: 77 }),
      taskResult: expect.objectContaining({
        taskId: 'task-9',
        iteration: 2,
        judgeStatus: 'evaluated',
        judgeResult: expect.objectContaining({ overallScore: 77 }),
        judgeHistory: [expect.objectContaining({ id: 'judge-2' })],
      }),
    });
  });

  it('preserves Dynamic Reasoning topology and generated task titles from execution details', async () => {
    apiClientMock.get.mockReset();
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: {
          id: 'exec-dynamic',
          flowId: 'playbook-1',
          ownerId: 'user-1',
          status: 'completed',
          taskResults: [{
            taskId: 'parent::dynamic-reasoning::subgraph-1::risk-metrics',
            nodeTitle: 'parent::dynamic-reasoning::subgraph-1::risk-metrics',
            status: 'completed',
            parent_task_id: 'parent',
            runtime_subgraph_id: 'subgraph-1',
            generated_local_node_id: 'risk-metrics',
            generated_node_title: 'Calculate Risk Metrics',
          }],
          dynamic_reasoning_attempts: [{
            execution_id: 'exec-dynamic',
            parent_task_id: 'parent',
            parent_iteration: 0,
            attempt: 0,
            subgraph_id: 'subgraph-1',
            status: 'completed',
            revisions: [],
            accepted_plan: {
              schemaVersion: '1',
              nodes: [{ id: 'risk-metrics', title: 'Calculate Risk Metrics', instruction: 'Calculate', dependsOn: [] }],
              synthesis: { id: 'synthesis', title: 'Synthesize', instruction: 'Synthesize', dependsOn: ['risk-metrics'], kind: 'synthesis' },
            },
          }],
          createdAt: '2026-08-07T00:00:00.000Z',
          updatedAt: '2026-08-07T00:00:01.000Z',
        },
      },
    });

    const execution = await getExecution('playbook-1', 'exec-dynamic');

    expect(execution.taskResults[0]).toMatchObject({
      generatedNodeTitle: 'Calculate Risk Metrics',
      parentTaskId: 'parent',
      runtimeSubgraphId: 'subgraph-1',
    });
    expect(execution.dynamicReasoningAttempts?.[0]?.acceptedPlan?.nodes[0].title).toBe('Calculate Risk Metrics');
  });

  it('builds a playbook from a persisted conversation response', async () => {
    apiClientMock.post.mockReset();
    apiClientMock.post.mockResolvedValueOnce({ data: { data: { id: 'playbook-1' } } });
    const payload = {
      conversationId: 'conversation-1',
      assistantMessageId: 'message-1',
      answerVersion: 'original',
      name: 'Incident response',
    };

    await expect(buildPlaybookFromConversation(payload)).resolves.toEqual({ id: 'playbook-1' });
    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/playbooks/from-conversation',
      payload,
      { timeout: 0 },
    );
  });
});
