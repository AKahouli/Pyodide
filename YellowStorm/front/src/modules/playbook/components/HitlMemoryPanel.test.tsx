import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HitlMemoryPanel } from './HitlMemoryPanel';
import type { HitlMemory } from '@/modules/playbook/types';

const memories: HitlMemory[] = [];

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params?.interruptId) return `${key}:${params.interruptId}`;
      if (params?.executionId) return `${key}:${params.executionId}`;
      return key;
    },
  }),
}));

vi.mock('@/modules/playbook/query/hooks/useHitlQueries', () => ({
  useHitlMemoriesQuery: () => ({ data: memories }),
}));

describe('HitlMemoryPanel', () => {
  beforeEach(() => {
    memories.length = 0;
  });

  it('renders saved memory metadata used to explain future HITL behavior', () => {
    memories.push({
      id: 'memory-1',
      ownerId: 'user-1',
      flowId: 'flow-1',
      nodeId: 'node-1',
      memoryType: 'approval_policy',
      source: 'hitl_feedback',
      title: 'Require approval before client sends',
      content: 'Ask before sending client messages.',
      normalizedInstruction: 'Ask for approval before sending external client messages.',
      appliesTo: 'node',
      status: 'active',
      sensitivity: 'sensitive',
      createdFromExecutionId: 'execution-1',
      createdFromInterruptId: 'interrupt-1',
      createdAt: '2026-05-31T00:00:00.000Z',
      updatedAt: '2026-05-31T00:00:00.000Z',
    });

    render(<HitlMemoryPanel flowId="flow-1" />);

    expect(screen.getByText('Require approval before client sends')).toBeInTheDocument();
    expect(screen.getByText('hitl.memory.scope.node')).toBeInTheDocument();
    expect(screen.getByText('hitl.memory.source.hitl_feedback')).toBeInTheDocument();
    expect(screen.getByText('hitl.memory.sensitivity.sensitive')).toBeInTheDocument();
    expect(screen.getByText('hitl.memory.createdFromInterrupt:interrupt-1')).toBeInTheDocument();
    expect(screen.getByText('hitl.memory.createdFromExecution:execution-1')).toBeInTheDocument();
  });
});
