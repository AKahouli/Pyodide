import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SemanticTrustPanel } from './SemanticTrustPanel';

vi.mock('../../query/hooks', () => ({
  useSemanticReadiness: () => ({ isLoading: false, data: {
    status: 'needs_review', score: 60, completeAreas: 3, totalAreas: 5,
    areas: [
      { key: 'structure', complete: true, issues: [] },
      { key: 'sources', complete: false, issues: [{ severity: 'blocking', message: 'source issue' }] },
    ],
  } }),
  useSemanticReviewItems: () => ({ isLoading: false, data: [{
    id: 'review', kind: 'ambiguous_relation', targetId: 'relation', status: 'open',
    details: { sourceLabel: 'Contract C102', targetEntityIds: ['sony-eu', 'sony-fr'], targetLabels: ['Sony Europe', 'Sony France'] },
    resolution: null, createdAt: '', updatedAt: '', resolvedBy: null, resolvedAt: null,
  }] }),
}));

const api = vi.hoisted(() => ({ resolveReviewItem: vi.fn() }));
vi.mock('../../api', () => ({ semanticModelApi: api }));

afterEach(() => vi.unstubAllGlobals());

describe('SemanticTrustPanel', () => {
  it('explains readiness and exposes explicit review decisions to editors', () => {
    render(<QueryClientProvider client={new QueryClient()}><SemanticTrustPanel modelId='model' canEdit onClose={vi.fn()} /></QueryClientProvider>);
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('trust.issue.sources')).toBeInTheDocument();
    expect(screen.getByText('Contract C102')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'trust.leaveUnresolved' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'trust.dismiss' })).toBeInTheDocument();
  });

  it('closes from the panel close control', () => {
    const onClose = vi.fn();
    render(<QueryClientProvider client={new QueryClient()}><SemanticTrustPanel modelId='model' canEdit onClose={onClose} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'action.close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('traps focus and restores it after Escape on mobile', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return <QueryClientProvider client={new QueryClient()}><button onClick={() => setOpen(true)}>Open trust</button>{open && <SemanticTrustPanel modelId='model' canEdit onClose={() => setOpen(false)} />}</QueryClientProvider>;
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open trust' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('invalidates cached Data Preview after saving a decision', async () => {
    api.resolveReviewItem.mockResolvedValue({ revision: 2 });
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(<QueryClientProvider client={client}><SemanticTrustPanel modelId='model' canEdit onClose={vi.fn()} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'trust.dismiss' }));
    await waitFor(() => expect(api.resolveReviewItem).toHaveBeenCalled());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['semantic-models', 'data-preview', 'model'] });
  });
});
