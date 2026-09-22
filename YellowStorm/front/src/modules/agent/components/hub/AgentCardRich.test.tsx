import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentCardRich } from './AgentCardRich';
import type { Agent } from '../../types';

const preview = vi.fn();
const start = vi.fn();
const toggleSaved = vi.fn();
let canManageDefault = true;

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/modules/admin', () => ({
  usePermissions: () => ({ hasPermission: () => canManageDefault }),
}));

vi.mock('./LibraryContext', () => ({
  useLibrary: () => ({ preview, start, toggleSaved, saved: [] }),
}));

vi.mock('../AgentMemoriesModal', () => ({ AgentMemoriesModal: () => null }));

const agent: Agent = {
  id: 'agent-1',
  name: 'Agent One',
  slug: 'agent-one',
  agentType: { id: 'type-1', name: 'Manager' },
  role: '',
  description: 'Description',
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

describe('AgentCardRich', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canManageDefault = true;
  });

  it('opens the agent editor when the card is clicked', () => {
    const onEdit = vi.fn();
    const { container } = render(<AgentCardRich agent={agent} onEdit={onEdit} onView={vi.fn()} />);

    fireEvent.click(container.querySelector('article')!);

    expect(onEdit).toHaveBeenCalledWith(agent);
    expect(preview).not.toHaveBeenCalled();
  });

  it('opens read-only settings for a default agent without update permission', () => {
    canManageDefault = false;
    const onEdit = vi.fn();
    const onView = vi.fn();
    const { container } = render(<AgentCardRich agent={{ ...agent, isDefault: true }} onEdit={onEdit} onView={onView} />);

    fireEvent.click(container.querySelector('article')!);

    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ id: agent.id }));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('opens the editor for write-shared agents and read-only settings for read-shared agents', () => {
    const onEdit = vi.fn();
    const onView = vi.fn();
    const sharedBy = { id: 'user-1', firstName: 'User', lastName: '', email: 'user@example.com' };
    const { container, rerender } = render(<AgentCardRich agent={{ ...agent, shareInfo: { shareId: 'share-1', permission: 'write', sharedBy } }} onEdit={onEdit} onView={onView} />);

    fireEvent.click(container.querySelector('article')!);
    expect(onEdit).toHaveBeenCalledOnce();

    rerender(<AgentCardRich agent={{ ...agent, shareInfo: { shareId: 'share-1', permission: 'read', sharedBy } }} onEdit={onEdit} onView={onView} />);
    fireEvent.click(container.querySelector('article')!);
    expect(onView).toHaveBeenCalledOnce();
  });

  it('does not open the editor when toolbar controls are used', () => {
    const onEdit = vi.fn();
    const { getByRole, getByLabelText } = render(<AgentCardRich agent={agent} onEdit={onEdit} onView={vi.fn()} />);

    fireEvent.pointerDown(getByRole('button', { name: 'library.start' }));
    fireEvent.click(getByRole('button', { name: 'library.start' }));
    fireEvent.pointerDown(getByLabelText('library.actions'));
    fireEvent.click(getByLabelText('library.actions'));

    expect(start).toHaveBeenCalledOnce();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('does not open the editor when a portaled menu action is selected', async () => {
    const onEdit = vi.fn();
    render(<AgentCardRich agent={agent} onEdit={onEdit} onView={vi.fn()} />);

    fireEvent.pointerDown(screen.getByLabelText('library.actions'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'library.addSaved' }));

    expect(toggleSaved).toHaveBeenCalledOnce();
    expect(onEdit).not.toHaveBeenCalled();
  });
});
