import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultFormValues } from '../components/AgentFormSchema';
import { useAgentOperations } from './useAgentOperations';

const createAgentMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock('../store', () => ({
  useAgentStore: () => ({
    createAgent: createAgentMock,
    updateAgent: vi.fn(),
    deleteAgent: vi.fn(),
    unshareAgent: vi.fn(),
    publishAgentToA2A: vi.fn(),
    rotateAgentA2AKey: vi.fn(),
    revokeAgentA2A: vi.fn(),
  }),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe('useAgentOperations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps the form reasoning effort to the agent API payload', async () => {
    const { result } = renderHook(() => useAgentOperations());

    await act(() => result.current.handleSave({
      ...defaultFormValues,
      name: 'Agent',
      slug: 'agent',
      agentType: 'type-1',
      role: 'Role',
      reasoningEffort: 'high',
    }));

    expect(createAgentMock).toHaveBeenCalledWith(expect.objectContaining({ reasoning_effort: 'high' }));
  });
});
