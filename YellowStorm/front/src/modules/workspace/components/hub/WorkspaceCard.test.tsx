import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceCard } from './WorkspaceCard';
import type { WorkspaceHubItem } from '../../hooks/useWorkspaceHubFilters';

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

    expect(screen.queryByTitle('Paramètres')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Partager')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Supprimer le workspace')).not.toBeInTheDocument();
  });

  it('shows settings/share/delete actions for an owned, non-read-only item', () => {
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

    expect(screen.getByTitle('Paramètres')).toBeInTheDocument();
    expect(screen.getByTitle('Partager')).toBeInTheDocument();
    expect(screen.getByTitle('Supprimer le workspace')).toBeInTheDocument();
  });
});
