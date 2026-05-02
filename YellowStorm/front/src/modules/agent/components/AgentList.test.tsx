import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AgentList } from './AgentList';
import type { Agent } from '../types';

let personalAgents: Agent[] = [];
let defaultAgents: Agent[] = [];
let isLoading = false;

const fetchAgents = vi.fn();
const fetchAgentTypes = vi.fn();
const createAgent = vi.fn();
const updateAgent = vi.fn();
const deleteAgent = vi.fn();

vi.mock('../store', () => ({
  usePersonalAgents: () => personalAgents,
  useDefaultAgents: () => defaultAgents,
  useAgentsLoading: () => isLoading,
  useAgentStore: () => ({
    fetchAgents,
    fetchAgentTypes,
    createAgent,
    updateAgent,
    deleteAgent,
  }),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./AgentCard', () => ({
  AgentCard: ({ agent, onEdit, onDelete }: { agent: Agent; onEdit?: (a: Agent) => void; onDelete?: (a: Agent) => void }) => (
    <div>
      <span>{agent.name}</span>
      {onEdit && <button type="button" onClick={() => onEdit(agent)}>edit</button>}
      {onDelete && <button type="button" onClick={() => onDelete(agent)}>delete</button>}
    </div>
  ),
}));

vi.mock('./CreateEditAgentDialog', () => ({
  CreateEditAgentDialog: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => (
    <div>
      {open && <div data-testid="agent-dialog">dialog-open</div>}
      <button type="button" onClick={() => onOpenChange(false)}>close</button>
    </div>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

beforeEach(() => {
  personalAgents = [];
  defaultAgents = [];
  isLoading = false;
  fetchAgents.mockClear();
  fetchAgentTypes.mockClear();
  createAgent.mockClear();
  updateAgent.mockClear();
  deleteAgent.mockClear();
});

describe('AgentList', () => {
  it('fetches agents and types on mount', () => {
    render(<AgentList />);

    expect(fetchAgents).toHaveBeenCalledTimes(1);
    expect(fetchAgentTypes).toHaveBeenCalledTimes(1);
  });

  it('renders personal and default agent sections', () => {
    personalAgents = [
      { id: 'p1', name: 'Personal', slug: 'personal', agentType: { id: 't1', name: 'Type' }, role: '', description: '', temperature: 0.1, instruction: '', ignorePrePrompt: false, knowledgeBases: [], tools: [], isDefault: false, isDefaultForType: false, isActive: true, createdBy: '', createdAt: '', updatedAt: '' },
    ];
    defaultAgents = [
      { id: 'd1', name: 'Default', slug: 'default', agentType: { id: 't1', name: 'Type' }, role: '', description: '', temperature: 0.1, instruction: '', ignorePrePrompt: false, knowledgeBases: [], tools: [], isDefault: true, isDefaultForType: false, isActive: true, createdBy: '', createdAt: '', updatedAt: '' },
    ];

    render(<AgentList />);

    expect(screen.getByText('Personal')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('opens create dialog and closes it', () => {
    render(<AgentList />);

    fireEvent.click(screen.getByText('list.newAgent'));
    expect(screen.getByTestId('agent-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByText('close'));
    expect(screen.queryByTestId('agent-dialog')).not.toBeInTheDocument();
  });

  it('confirms deletion through alert dialog', async () => {
    personalAgents = [
      { id: 'p1', name: 'Personal', slug: 'personal', agentType: { id: 't1', name: 'Type' }, role: '', description: '', temperature: 0.1, instruction: '', ignorePrePrompt: false, knowledgeBases: [], tools: [], isDefault: false, isDefaultForType: false, isActive: true, createdBy: '', createdAt: '', updatedAt: '' },
    ];
    deleteAgent.mockResolvedValue(undefined);

    render(<AgentList />);

    fireEvent.click(screen.getByText('delete'));
    fireEvent.click(screen.getByText('list.deleteDialog.confirm'));

    await waitFor(() => {
      expect(deleteAgent).toHaveBeenCalledWith('p1');
    });
  });
});
