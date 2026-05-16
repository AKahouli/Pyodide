import { describe, expect, it, vi } from 'vitest';
import {
  getPlaybookTriggers,
  getPlaybookRepeatability,
  getTaskRepeatability,
  sanitizePlaybookUpdate,
  upsertPlaybookTriggerSchedule,
  clearPlaybookTriggerMail,
  updatePlaybook,
} from './api';
import { makeTask } from './test-utils';

const apiClientMock = vi.hoisted(() => ({
  get: vi.fn(),
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
      '/playbooks/playbook-1/repeatability/task-1',
      { params: { limit: 9 } },
    );
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
    });
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
});
