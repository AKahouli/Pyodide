import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceCard } from './WorkspaceCard';
import type { WorkspaceHubItem } from '../../hooks/useWorkspaceHubFilters';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

function makeItem(overrides: Partial<WorkspaceHubItem> = {}): WorkspaceHubItem {
  return {
    id: 'ws-1',
    name: 'Test Workspace',
    documentCount: 3,
    usedStorage: 1024,
    allocatedStorage: 2048,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isShared: false,
    isPersonal: false,
    isReadOnly: false,
    ...overrides,
  };
}

describe('WorkspaceCard', () => {
  it('hides settings/share/delete actions for a read-only public-discovery item', () => {
    const workspace = makeItem({ isShared: false, isReadOnly: true, isPublicItem: true });

    render(
      <WorkspaceCard
        workspace={workspace}
        onOpen={vi.fn()}
        onSettings={vi.fn()}
        onShare={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'hub.card.actions' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'hub.card.open' })).toBeInTheDocument();
  });

  it('keeps owned workspace actions in one accessible menu', async () => {
    const workspace = makeItem({ isShared: false, isReadOnly: false, isPersonal: false });

    render(
      <WorkspaceCard
        workspace={workspace}
        onOpen={vi.fn()}
        onSettings={vi.fn()}
        onShare={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'hub.card.actions' }));
    expect(await screen.findByRole('menuitem', { name: 'hub.card.settings' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'hub.card.share' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'hub.card.delete' })).toBeInTheDocument();
  });

  it('opens the workspace from a named primary control', async () => {
    const onOpen = vi.fn();
    render(<WorkspaceCard workspace={makeItem()} onOpen={onOpen} />);

    await userEvent.click(screen.getByRole('button', { name: 'hub.card.open' }));
    expect(onOpen).toHaveBeenCalledWith('ws-1');
  });
});
