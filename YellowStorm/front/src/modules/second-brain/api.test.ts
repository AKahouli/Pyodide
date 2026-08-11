import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ENDPOINTS } from '@/lib/api/config';
import { confirmSecondBrainAction, runSecondBrainTurn } from './api';

const apiClientMock = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: apiClientMock,
}));

describe('second brain API', () => {
  const response = {
    conversationId: 'conversation-1',
    correlationId: 'correlation-1',
    answer: 'Done',
    toolResults: [],
    pendingAction: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    apiClientMock.post.mockResolvedValue({ data: { data: response } });
  });

  it('allows a turn to use the backend long-running request window', async () => {
    const input = {
      message: 'Find a Playbook',
      pageContext: {
        route: '/',
        module: 'other' as const,
        surface: 'other',
        availableActions: ['search'],
        hasUnsavedChanges: false,
        locale: 'en',
        contextVersion: 1 as const,
      },
    };

    await expect(runSecondBrainTurn(input)).resolves.toBe(response);
    expect(apiClientMock.post).toHaveBeenCalledWith(
      API_ENDPOINTS.secondBrain.turns,
      input,
      { timeout: 300_000 },
    );
  });

  it('uses the same request window when continuing a confirmation', async () => {
    await expect(confirmSecondBrainAction('confirmation-1')).resolves.toBe(response);
    expect(apiClientMock.post).toHaveBeenCalledWith(
      API_ENDPOINTS.secondBrain.confirm('confirmation-1'),
      undefined,
      { timeout: 300_000 },
    );
  });
});
