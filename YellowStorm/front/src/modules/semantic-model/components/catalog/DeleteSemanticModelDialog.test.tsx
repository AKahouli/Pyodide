import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DeleteSemanticModelDialog } from './DeleteSemanticModelDialog';
import { semanticModelApi } from '../../api';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/lib/notifications', () => ({ showSuccess: vi.fn(), showError: vi.fn() }));

vi.mock('../../api', () => ({
  semanticModelApi: { deletePermanently: vi.fn().mockResolvedValue(undefined) },
}));

const model = { id: 'm1', name: 'Contracts', nodeCount: 3, relationCount: 2, recordCount: 40, workspaceCount: 1 };

function renderDialog(onDeleted = vi.fn(), onOpenChange = vi.fn()) {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <DeleteSemanticModelDialog model={model} open onOpenChange={onOpenChange} onDeleted={onDeleted} />
    </QueryClientProvider>,
  );
  return { invalidate, onDeleted, onOpenChange };
}

describe('DeleteSemanticModelDialog', () => {
  beforeEach(() => vi.mocked(semanticModelApi.deletePermanently).mockClear());

  it('warns about what is lost and that source files stay', () => {
    renderDialog();
    expect(screen.getByText('deleteModel.willDelete')).toBeInTheDocument();
    expect(screen.getByText('deleteModel.items.records')).toBeInTheDocument();
    expect(screen.getByText('deleteModel.items.index')).toBeInTheDocument();
    expect(screen.getByText('deleteModel.filesStay')).toBeInTheDocument();
  });

  it('keeps the delete button disabled until every acknowledgement is ticked', async () => {
    const user = userEvent.setup();
    renderDialog();
    const button = screen.getByRole('button', { name: /deleteModel.submit/ });
    expect(button).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'deleteModel.acknowledge.data' }));
    expect(button).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'deleteModel.acknowledge.irreversible' }));
    expect(button).toBeEnabled();
    await user.click(screen.getByRole('checkbox', { name: 'deleteModel.acknowledge.data' }));
    expect(button).toBeDisabled();
    expect(semanticModelApi.deletePermanently).not.toHaveBeenCalled();
  });

  it('deletes, closes, refreshes the models and hands back to the caller', async () => {
    const user = userEvent.setup();
    const { invalidate, onDeleted, onOpenChange } = renderDialog();
    await user.click(screen.getByRole('checkbox', { name: 'deleteModel.acknowledge.data' }));
    await user.click(screen.getByRole('checkbox', { name: 'deleteModel.acknowledge.irreversible' }));
    await user.click(screen.getByRole('button', { name: /deleteModel.submit/ }));
    await waitFor(() => expect(semanticModelApi.deletePermanently).toHaveBeenCalledWith('m1'));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['semantic-models'] });
  });
});
