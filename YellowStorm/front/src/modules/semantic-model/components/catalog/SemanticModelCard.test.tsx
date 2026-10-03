import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SemanticModelCard } from './SemanticModelCard';
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
  DeleteSemanticModelDialog: ({ open }: { open: boolean }) => (open ? <div>delete-dialog-open</div> : null),
}));

vi.mock('./ShareSemanticModelDialog', () => ({
  ShareSemanticModelDialog: () => null,
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

function renderCard(overrides: Record<string, unknown> = {}) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SemanticModelCard model={{ ...model, ...overrides } as never} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SemanticModelCard rename', () => {
  beforeEach(() => {
    vi.mocked(semanticModelApi.update).mockClear();
  });

  it('renames the model with the current revision and refreshes the catalog', async () => {
    renderCard();

    await userEvent.click(screen.getByRole('button', { name: 'catalog.rename.button' }));
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
    renderCard();

    await userEvent.click(screen.getByRole('button', { name: 'catalog.rename.button' }));
    expect(await screen.findByRole('button', { name: 'catalog.rename.submit' })).toBeDisabled();
    expect(semanticModelApi.update).not.toHaveBeenCalled();
  });
});

describe('SemanticModelCard delete', () => {
  it('opens the delete dialog from the trash button for the owner', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'deleteModel.button' }));
    expect(screen.getByText('delete-dialog-open')).toBeInTheDocument();
  });

  it('disables the trash button for other roles', () => {
    renderCard({ role: 'editor' });
    expect(screen.getByRole('button', { name: 'deleteModel.button' })).toBeDisabled();
    expect(screen.getByTitle('deleteModel.ownerOnly')).toBeInTheDocument();
  });
});
