import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AgentCard } from './AgentCard';
import type { Agent } from '../types';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

const baseAgent: Agent = {
  id: '1',
  name: 'Agent',
  slug: 'agent',
  agentType: { id: 'type-1', name: 'Manager' },
  role: '',
  description: 'desc',
  temperature: 0.5,
  instruction: '',
  ignorePrePrompt: false,
  knowledgeBases: [],
  tools: [],
  isDefault: false,
  isDefaultForType: false,
  isActive: true,
  createdBy: '',
  createdAt: '',
  updatedAt: '',
};

describe('AgentCard', () => {
  it('shows edit/delete actions for personal agents', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(<AgentCard agent={baseAgent} onEdit={onEdit} onDelete={onDelete} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);

    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);

    expect(onEdit).toHaveBeenCalledWith(baseAgent);
    expect(onDelete).toHaveBeenCalledWith(baseAgent);
  });

  it('hides actions for default agents and shows lock badge', () => {
    render(<AgentCard agent={{ ...baseAgent, isDefault: true }} />);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
