/**
 * Agent Store
 * Zustand store for user agents management
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import type { AgentStore, AgentState, Agent } from './types';
import * as api from './api';
import { i18nInstance } from '@/modules/localization/i18nInstance';

function tAgent(key: string, fallback: string, options?: Record<string, unknown>) {
  if (i18nInstance.isInitialized) {
    return i18nInstance.t(key, { ns: 'agent', defaultValue: fallback, ...options });
  }
  if (options) {
    let result = fallback;
    for (const [k, v] of Object.entries(options)) {
      result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
    }
    return result;
  }
  return fallback;
}

// ===== Initial State =====

const initialState: AgentState = {
  agents: [],
  agentTypes: [],
  isLoading: false,
  isInitialized: false,
  error: null,
  lastFetchedAt: null,
};

// ===== Store Implementation =====

export const useAgentStore = create<AgentStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      fetchAgents: async () => {
        const state = get();

        if (state.isLoading) return;

        // Skip if fresh (< 5 minutes)
        if (
          state.isInitialized &&
          state.lastFetchedAt &&
          Date.now() - state.lastFetchedAt.getTime() < 5 * 60 * 1000
        ) {
          return;
        }

        set({ isLoading: true, error: null });

        try {
          const agents = await api.getAllAgents();
          set({
            agents,
            isLoading: false,
            isInitialized: true,
            error: null,
            lastFetchedAt: new Date(),
          });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : tAgent('store.errors.fetchAgentsFailed', 'Failed to fetch agents');
          set({ isLoading: false, error: errorMessage });
          throw err;
        }
      },

      fetchAgentTypes: async () => {
        try {
          const agentTypes = await api.getAgentTypes();
          set({ agentTypes });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : tAgent('store.errors.fetchAgentTypesFailed', 'Failed to fetch agent types');
          set({ error: errorMessage });
        }
      },

      createAgent: async (data) => {
        const agent = await api.createAgent(data);
        set((state) => ({ agents: [...state.agents, agent] }));
        toast.success(tAgent('store.toasts.agentCreated', 'Agent created'), {
          description: tAgent('store.toasts.agentCreatedDescription', '{{name}} has been created successfully.', { name: agent.name }),
        });
        return agent;
      },

      updateAgent: async (id, data) => {
        const agent = await api.updateAgent(id, data);
        set((state) => ({
          agents: state.agents.map((a) => (a.id === id ? agent : a)),
        }));
        toast.success(tAgent('store.toasts.agentUpdated', 'Agent updated'), {
          description: tAgent('store.toasts.agentUpdatedDescription', '{{name}} has been updated successfully.', { name: agent.name }),
        });
        return agent;
      },

      deleteAgent: async (id) => {
        const agent = get().agents.find((a) => a.id === id);
        await api.deleteAgent(id);
        set((state) => ({
          agents: state.agents.filter((a) => a.id !== id),
        }));
        toast.success(tAgent('store.toasts.agentDeleted', 'Agent deleted'), {
          description: tAgent('store.toasts.agentDeletedDescription', '{{name}} has been deleted.', { name: agent?.name || tAgent('store.defaults.agentName', 'Agent') }),
        });
      },

      getPersonalAgents: () => get().agents.filter((a) => !a.isDefault),

      getDefaultAgents: () => get().agents.filter((a) => a.isDefault),

      getAgentById: (id) => get().agents.find((a) => a.id === id),

      refreshAgents: async () => {
        set({ lastFetchedAt: null, isInitialized: false });
        await get().fetchAgents();
      },

      reset: () => set(initialState),
    }),
    { name: 'agent-store' },
  ),
);

// ===== Selector Hooks =====

export const useAgents = () => useAgentStore(useShallow((state) => state.agents));

export const usePersonalAgents = () =>
  useAgentStore(useShallow((state) => state.agents.filter((a) => !a.isDefault)));

export const useDefaultAgents = () =>
  useAgentStore(useShallow((state) => state.agents.filter((a) => a.isDefault)));

export const useAgentsLoading = () => useAgentStore((state) => state.isLoading);

export const useAgentsInitialized = () => useAgentStore((state) => state.isInitialized);

export const useAgentsError = () => useAgentStore((state) => state.error);

export const useAgentById = (id: string) =>
  useAgentStore(useShallow((state) => state.agents.find((a) => a.id === id)));

export const useAgentTypes = () => useAgentStore(useShallow((state) => state.agentTypes));
