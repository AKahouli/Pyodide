import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlatformCopilotPanelStore } from '@/modules/platform-copilot/platformCopilotPanelStore';
import { PlaybookPendingSources } from './PlaybookPendingSources';

const api = vi.hoisted(() => ({ getPendingPlaybookSources: vi.fn() }));
vi.mock('../../assistant-sources-api', () => api);
// The card has its own tests: here it only hands its message on.
vi.mock('./PlaybookSourcesCard', () => ({
  PlaybookSourcesCard: ({ playbookName, onSend }: { playbookName?: string; onSend: (text: string) => boolean }) =>
    <button type='button' onClick={() => onSend(`I chose the sources for ${playbookName}.`)}>continue {playbookName}</button>,
}));

function renderPending() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PlaybookPendingSources playbookId='p-1' /></QueryClientProvider>);
}

describe('PlaybookPendingSources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlatformCopilotPanelStore.setState({ open: false, pendingPrompt: null, pendingHandoff: null });
  });

  it('shows nothing when Yellowmind waits for nothing', async () => {
    api.getPendingPlaybookSources.mockResolvedValue([]);
    const { container } = renderPending();
    await waitFor(() => expect(api.getPendingPlaybookSources).toHaveBeenCalledWith('p-1'));
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the waiting questions and writes the message in Yellowmind for the person to send', async () => {
    api.getPendingPlaybookSources.mockResolvedValue([{ continuationId: 'c-1', playbookName: 'CV screening' }]);
    renderPending();
    fireEvent.click(await screen.findByText('playbookSources.pending_one'));
    fireEvent.click(screen.getByText('continue CV screening'));
    expect(usePlatformCopilotPanelStore.getState()).toMatchObject({ open: true, pendingPrompt: 'I chose the sources for CV screening.' });
  });
});
