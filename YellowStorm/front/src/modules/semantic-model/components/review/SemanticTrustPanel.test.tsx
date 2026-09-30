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
  useReviewQueue: () => ({ isLoading: false, isError: false, data: { count: 4, items: [
    { key: 'review:1', group: 'decisions', priority: 2, kind: 'ambiguous_link', params: { record: 'Contract C102', relationship: 'signed by', count: 2 },
      action: { kind: 'choose_match', reviewItemId: 'review', select: 'target', options: [{ value: 'sony-eu', label: 'Sony Europe' }, { value: 'sony-fr', label: 'Sony France' }] } },
    { key: 'mapping:m1', group: 'sources', priority: 1, kind: 'source_broken', params: { document: 'orders.csv', concept: 'Order', fields: 'order_no' }, action: { kind: 'repair_mapping', mappingId: 'm1' } },
    { key: 'identity:c1', group: 'identity', priority: 1, kind: 'missing_unique_field', params: { concept: 'Invoice' }, action: { kind: 'choose_unique_field', conceptId: 'c1' } },
    { key: 'gap:c2:city', group: 'data', priority: 3, kind: 'missing_values', params: { concept: 'Customer', field: 'City', missing: 3, total: 10 }, action: { kind: 'fix_values', conceptId: 'c2' } },
  ] } }),
}));

const api = vi.hoisted(() => ({ resolveReviewItem: vi.fn() }));
vi.mock('../../api', () => ({ semanticModelApi: api }));

afterEach(() => vi.unstubAllGlobals());

describe('SemanticTrustPanel', () => {
  it('explains readiness and exposes explicit review decisions to editors', () => {
    render(<QueryClientProvider client={new QueryClient()}><SemanticTrustPanel modelId='model' canEdit onClose={vi.fn()} /></QueryClientProvider>);
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('trust.issue.sources')).toBeInTheDocument();
    expect(screen.getByText('reviewQueue.title')).toBeInTheDocument();
    expect(screen.getByText('reviewQueue.kind.ambiguous_link')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sony Europe' })).toBeInTheDocument();
  });

  it('groups items with the most important first and hands each one over to be opened', () => {
    const onOpenIssue = vi.fn(); const onClose = vi.fn();
    render(<QueryClientProvider client={new QueryClient()}><SemanticTrustPanel modelId='model' canEdit onClose={onClose} onOpenIssue={onOpenIssue} activeKey='identity:c1' /></QueryClientProvider>);
    const groups = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'));
    expect(groups.indexOf('reviewQueue.group.sources')).toBeLessThan(groups.indexOf('reviewQueue.group.data'));
    fireEvent.click(screen.getByRole('button', { name: 'reviewQueue.action.repair_mapping' }));
    expect(onOpenIssue).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'mapping:m1' }));
    fireEvent.click(screen.getByRole('button', { name: 'reviewQueue.action.fix_values' }));
    expect(onOpenIssue).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'gap:c2:city' }));
    // The page decides where to go; the list does not close itself.
    expect(onClose).not.toHaveBeenCalled();
    // The item opened last is marked, and an optional gap says so.
    expect(screen.getByText('reviewQueue.kind.missing_unique_field').closest('li')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('reviewQueue.optional')).toBeInTheDocument();
  });

  it('shows only the items behind a readiness area', () => {
    render(<QueryClientProvider client={new QueryClient()}><SemanticTrustPanel modelId='model' canEdit onClose={vi.fn()} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: /trust\.area\.sources/ }));
    expect(screen.getByText('reviewQueue.kind.source_broken')).toBeInTheDocument();
    expect(screen.queryByText('reviewQueue.kind.missing_unique_field')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'trust.showAll' })[0]);
    expect(screen.getByText('reviewQueue.kind.missing_unique_field')).toBeInTheDocument();
  });

  it('hides actions from people who can only read', () => {
    render(<QueryClientProvider client={new QueryClient()}><SemanticTrustPanel modelId='model' canEdit={false} onClose={vi.fn()} /></QueryClientProvider>);
    expect(screen.getByText('reviewQueue.kind.source_broken')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'reviewQueue.action.repair_mapping' })).not.toBeInTheDocument();
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
    fireEvent.change(screen.getByRole('combobox', { name: 'reviewQueue.chooseRecord' }), { target: { value: 'sony-fr' } });
    fireEvent.click(screen.getByRole('button', { name: 'reviewQueue.action.choose_match' }));
    await waitFor(() => expect(api.resolveReviewItem).toHaveBeenCalledWith('model', 'review', { decision: 'accepted', selectedTargetId: 'sony-fr' }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['semantic-models', 'review-queue', 'model'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['semantic-models', 'data-preview', 'model'] });
  });
});
