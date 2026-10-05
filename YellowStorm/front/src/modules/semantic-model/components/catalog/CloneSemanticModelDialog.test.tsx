import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CloneSemanticModelDialog, nextCloneInclude } from './CloneSemanticModelDialog';
import { semanticModelApi } from '../../api';
import { showWarning } from '@/lib/notifications';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/lib/notifications', () => ({ showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() }));

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

vi.mock('../../api', () => ({
  semanticModelApi: {
    clone: vi.fn(),
    clonePreview: vi.fn().mockResolvedValue({ sources: 4, records: 120, people: 2 }),
  },
}));

function renderDialog(role = 'owner', onOpenChange = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <CloneSemanticModelDialog model={{ id: 'm1', name: 'Contracts', role } as never} open onOpenChange={onOpenChange} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

const box = (option: string) => screen.getByRole('checkbox', { name: `clone.options.${option}` });

describe('nextCloneInclude', () => {
  it('brings the sources with the data and keeps them while the data is ticked', () => {
    const withData = nextCloneInclude({ sources: false, data: false, shares: false }, 'data', true);
    expect(withData).toEqual({ sources: true, data: true, shares: false });
    expect(nextCloneInclude(withData, 'sources', false).sources).toBe(true);
    const withoutData = nextCloneInclude(withData, 'data', false);
    expect(nextCloneInclude(withoutData, 'sources', false).sources).toBe(false);
  });
});

describe('CloneSemanticModelDialog', () => {
  beforeEach(() => {
    vi.mocked(semanticModelApi.clone).mockReset();
    navigate.mockReset();
  });

  it('proposes "<name> (copy)", sources ticked, and shows the counts', async () => {
    renderDialog();
    expect(screen.getByRole('textbox')).toHaveValue('Contracts (clone.copySuffix)');
    expect(box('sources')).toBeChecked();
    expect(box('data')).not.toBeChecked();
    expect(box('shares')).not.toBeChecked();
    expect(await screen.findByText('120')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('ticking the data ticks and locks the sources', async () => {
    renderDialog();
    await userEvent.click(box('sources'));
    expect(box('sources')).not.toBeChecked();
    await userEvent.click(box('data'));
    expect(box('sources')).toBeChecked();
    expect(box('sources')).toBeDisabled();
    await userEvent.click(box('data'));
    expect(box('sources')).toBeEnabled();
  });

  it('sends the name and the ticked options, then opens the copy', async () => {
    vi.mocked(semanticModelApi.clone).mockResolvedValue({ id: 'copy-1', dataCopy: { status: 'copied' } } as never);
    const { onOpenChange } = renderDialog();
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), 'My copy');
    await userEvent.click(box('data'));
    await userEvent.click(box('shares'));
    await userEvent.click(screen.getByRole('button', { name: /clone.submit/ }));
    await waitFor(() => expect(semanticModelApi.clone).toHaveBeenCalledWith('m1', 'My copy', { sources: true, data: true, shares: true }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/semantic-models/copy-1'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(showWarning).not.toHaveBeenCalled();
  });

  it('warns when the model was copied without its data', async () => {
    vi.mocked(semanticModelApi.clone).mockResolvedValue({ id: 'copy-2', dataCopy: { status: 'failed' } } as never);
    renderDialog();
    await userEvent.click(box('data'));
    await userEvent.click(screen.getByRole('button', { name: /clone.submit/ }));
    await waitFor(() => expect(showWarning).toHaveBeenCalledWith('clone.dataNotCopied'));
    expect(navigate).toHaveBeenCalledWith('/semantic-models/copy-2');
  });

  it('lets only the owner copy the shares', () => {
    renderDialog('viewer');
    expect(box('shares')).toBeDisabled();
  });
});
