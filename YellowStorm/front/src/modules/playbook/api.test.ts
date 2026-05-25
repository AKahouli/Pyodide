import { describe, expect, it, vi } from 'vitest';
import {
  clonePlaybook,
  executePlaybook,
  getFlowNodeTemplates,
  getPlaybookTriggers,
  getExecution,
  runAdvisorEvaluation,
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
  updatePlaybook,
  validateTaskReplay,
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
              type: 'router-default',
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
      expectedUpdatedAt: '2025-01-01T00:00:00.000Z',
      clientMutationId: 'intent-abc123',
    });

    expect(apiClientMock.patch).toHaveBeenCalledWith('/playbooks/playbook-1', expect.objectContaining({
      expectedUpdatedAt: '2025-01-01T00:00:00.000Z',
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
});
