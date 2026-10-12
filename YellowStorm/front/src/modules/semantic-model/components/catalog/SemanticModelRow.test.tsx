import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SemanticModelRow } from './SemanticModelRow';
import { semanticModelApi } from '../../api';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/lib/notifications', () => ({ showSuccess: vi.fn() }));

vi.mock('../../api', () => ({
  semanticModelApi: {
    clone: vi.fn(),
    update: vi.fn().mockResolvedValue({ id: 'm1', name: 'Renamed', revision: 4 }),
  },
}));

vi.mock('./DeleteSemanticModelDialog', () => ({
  DeleteSemanticModelDialog: ({ open }: { open: boolean }) => (open ? createPortal(<div>delete-dialog-open</div>, document.body) : null),
}));

vi.mock('./CloneSemanticModelDialog', () => ({
  CloneSemanticModelDialog: ({ open }: { open: boolean }) => (open ? createPortal(<div>clone-dialog-open</div>, document.body) : null),
}));

vi.mock('./ShareSemanticModelDialog', () => ({
  ShareSemanticModelDialog: ({ open }: { open: boolean }) => open ? createPortal(<div>share-dialog-open</div>, document.body) : null,
}));

const model = {
  id: 'm1',
  name: 'Contracts',
  description: '',
  kind: 'designed',
  status: 'draft',
  role: 'owner' as const,
  revision: 3,
  workspaceCount: 1,
  nodeCount: 0,
  relationCount: 0,
  recordCount: 0,
  brokenBindingCount: 0,
};

function renderRow(overrides: Record<string, unknown> = {}) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <table><tbody><SemanticModelRow model={{ ...model, ...overrides } as never} /></tbody></table>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SemanticModelRow rename', () => {
  beforeEach(() => {
    vi.mocked(semanticModelApi.update).mockClear();
  });

  it('renames the model with the current revision and refreshes the catalog', async () => {
    renderRow();

    await userEvent.click(screen.getByRole('button', { name: 'catalog.actionsFor' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'catalog.rename.button' }));
    const input = await screen.findByLabelText('catalog.rename.name');
    expect(input).toHaveValue('Contracts');

    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed');
    await userEvent.click(screen.getByRole('button', { name: 'catalog.rename.submit' }));

    await waitFor(() => {
      expect(semanticModelApi.update).toHaveBeenCalledWith('m1', { expectedRevision: 3, name: 'Renamed' });
    });
  });

  it('keeps save disabled when the name is unchanged', async () => {
    renderRow();

    await userEvent.click(screen.getByRole('button', { name: 'catalog.actionsFor' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'catalog.rename.button' }));
    expect(await screen.findByRole('button', { name: 'catalog.rename.submit' })).toBeDisabled();
    expect(semanticModelApi.update).not.toHaveBeenCalled();
  });
});

describe('SemanticModelRow actions', () => {
  it('opens sharing from the owner menu', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: 'catalog.actionsFor' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'share.action' }));
    expect(screen.getByText('share-dialog-open')).toBeInTheDocument();
  });

  it('opens the clone dialog from the copy button', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: 'catalog.actionsFor' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'clone.button' }));
    expect(screen.getByText('clone-dialog-open')).toBeInTheDocument();
  });

  it('opens the delete dialog from the trash button for the owner', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: 'catalog.actionsFor' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'deleteModel.button' }));
    expect(screen.getByText('delete-dialog-open')).toBeInTheDocument();
  });

  it('disables deletion for editors and hides owner-only sharing', async () => {
    renderRow({ role: 'editor' });
    await userEvent.click(screen.getByRole('button', { name: 'catalog.actionsFor' }));
    expect(screen.getByRole('menuitem', { name: 'deleteModel.button' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTitle('deleteModel.ownerOnly')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'share.action' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'catalog.rename.button' })).toBeInTheDocument();
  });

  it('keeps opening and copying available to viewers without exposing rename', async () => {
    renderRow({ role: 'viewer' });
    expect(screen.getByRole('link', { name: 'Contracts' })).toHaveAttribute('href', '/semantic-models/m1');
    expect(screen.getByRole('link', { name: 'catalog.openNamed' })).toHaveAttribute('href', '/semantic-models/m1');
    await userEvent.click(screen.getByRole('button', { name: 'catalog.actionsFor' }));
    expect(screen.queryByRole('menuitem', { name: 'catalog.rename.button' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'share.action' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'clone.button' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'deleteModel.button' })).toHaveAttribute('aria-disabled', 'true');
  });
});
