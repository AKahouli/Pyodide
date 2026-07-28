import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentStore } from './store';
import type { Agent } from './types';

const getAllAgentsMock = vi.hoisted(() => vi.fn());
const getAgentTypesMock = vi.hoisted(() => vi.fn());
const createAgentMock = vi.hoisted(() => vi.fn());
const updateAgentMock = vi.hoisted(() => vi.fn());
const updateDefaultAgentMock = vi.hoisted(() => vi.fn());
const deleteAgentMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());

vi.mock('./api', () => ({
  getAllAgents: getAllAgentsMock,
  getAgentTypes: getAgentTypesMock,
  createAgent: createAgentMock,
  updateAgent: updateAgentMock,
  updateDefaultAgent: updateDefaultAgentMock,
  deleteAgent: deleteAgentMock,
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccessMock },
}));

vi.mock('@/modules/localization/i18nInstance', () => ({
  i18nInstance: { isInitialized: false },
}));

const baseAgent: Agent = {
  id: 'a1',
  name: 'Alpha',
  slug: 'alpha',
  agentType: { id: 'type-1', name: 'Manager' },
  role: 'Do things',
  description: '',
  temperature: 0.2,
  instruction: '',
  ignorePrePrompt: false,
  knowledgeBases: [],
  tools: [],
  isDefault: false,
  isDefaultForType: false,
  isActive: true,
  createdBy: 'u1',
  createdAt: 'now',
  updatedAt: 'now',
};

describe('agent store', () => {
  beforeEach(() => {
    useAgentStore.setState({
      agents: [],
      agentTypes: [],
      isLoading: false,
      isInitialized: false,
      error: null,
      lastFetchedAt: null,
    });
    vi.clearAllMocks();
  });

  it('skips fetchAgents when cache is fresh', async () => {
    useAgentStore.setState({
      agents: [],
      agentTypes: [],
      isLoading: false,
      isInitialized: true,
      error: null,
      lastFetchedAt: new Date(Date.now() - 2 * 60 * 1000),
    });

    await useAgentStore.getState().fetchAgents();

    expect(getAllAgentsMock).not.toHaveBeenCalled();
  });

  it('fetches agents and updates state', async () => {
    const fetched: Agent[] = [{ ...baseAgent, id: 'a2', name: 'Bravo' }];
    getAllAgentsMock.mockResolvedValue(fetched);

    await useAgentStore.getState().fetchAgents();

    const state = useAgentStore.getState();
    expect(state.agents).toEqual(fetched);
    expect(state.isInitialized).toBe(true);
    expect(state.lastFetchedAt).toBeInstanceOf(Date);
    expect(state.error).toBeNull();
  });

  it('sets error on fetch failure and rethrows', async () => {
    const err = new Error('boom');
    getAllAgentsMock.mockRejectedValue(err);

    await expect(useAgentStore.getState().fetchAgents()).rejects.toThrow('boom');

    expect(useAgentStore.getState().error).toBe('boom');
  });

  it('creates agent, appends to state, and toasts', async () => {
    createAgentMock.mockResolvedValue(baseAgent);

    const created = await useAgentStore.getState().createAgent({ name: 'Alpha' } as never);

    expect(created).toEqual(baseAgent);
    expect(useAgentStore.getState().agents).toContainEqual(baseAgent);
    expect(toastSuccessMock).toHaveBeenCalled();
  });

  it('updates agent in state and toasts', async () => {
    useAgentStore.setState({
      agents: [baseAgent],
      agentTypes: [],
      isLoading: false,
      isInitialized: true,
      error: null,
      lastFetchedAt: null,
    });

    updateAgentMock.mockResolvedValue({ ...baseAgent, name: 'Updated' });

    const updated = await useAgentStore.getState().updateAgent('a1', { name: 'Updated' });

    expect(updated.name).toBe('Updated');
    expect(useAgentStore.getState().agents[0].name).toBe('Updated');
    expect(toastSuccessMock).toHaveBeenCalled();
  });

  it('routes default agent updates through the admin endpoint', async () => {
    const defaultAgent = { ...baseAgent, isDefault: true };
    useAgentStore.setState({ agents: [defaultAgent] });
    updateDefaultAgentMock.mockResolvedValue({
      ...defaultAgent,
      connectors: ['connector-1'],
      connectorActionSelections: [{ connectorId: 'connector-1', actionKeys: ['search'] }],
    });

    await useAgentStore.getState().updateAgent('a1', {
      connectors: ['connector-1'],
      connectorActionSelections: [{ connectorId: 'connector-1', actionKeys: ['search'] }],
    });

    expect(updateDefaultAgentMock).toHaveBeenCalledWith('a1', {
      connectors: ['connector-1'],
      connectorActionSelections: [{ connectorId: 'connector-1', actionKeys: ['search'] }],
    });
    expect(updateAgentMock).not.toHaveBeenCalled();
    expect(useAgentStore.getState().agents[0].connectors).toEqual(['connector-1']);
  });

  it('deletes agent and removes from state', async () => {
    useAgentStore.setState({
      agents: [baseAgent, { ...baseAgent, id: 'a2' }],
      agentTypes: [],
      isLoading: false,
      isInitialized: true,
      error: null,
      lastFetchedAt: null,
    });

    deleteAgentMock.mockResolvedValue(undefined);

    await useAgentStore.getState().deleteAgent('a1');

    expect(useAgentStore.getState().agents).toHaveLength(1);
    expect(useAgentStore.getState().agents[0].id).toBe('a2');
  });
});
