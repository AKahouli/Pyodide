import { describe, expect, it, vi } from 'vitest';
import {
  getFlowNodeTemplates,
  getPlaybookTriggers,
  getPlaybookRepeatability,
  getTaskRepeatability,
  sanitizePlaybookUpdate,
  syncPlaybookTriggerMailSubscription,
  upsertPlaybookTriggerMail,
  upsertPlaybookTriggerSchedule,
  clearPlaybookTriggerSchedule,
  clearPlaybookTriggerMail,
  updatePlaybook,
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
          routerConfig: { outputLabels: ['retry', 'done', '__error__'], maxIterations: 3 },
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
        routerConfig: { outputLabels: ['retry', 'done', '__error__'], maxIterations: 3 },
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
              routerConfig: { outputLabels: ['retry', 'done', '__error__'], maxIterations: 3 },
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
      routerConfig: { outputLabels: ['retry', 'done', '__error__'], maxIterations: 3 },
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
          routerConfig: { outputLabels: ['retry', 'done', '__error__'], maxIterations: 3 },
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
            routerConfig: { outputLabels: ['retry', 'done', '__error__'], maxIterations: 3 },
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
});
