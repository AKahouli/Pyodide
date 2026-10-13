import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewQueueItem, ValidationIssue } from '../../types';
import { ModelSetupChecks } from './ModelSetupChecks';

const item = (key: string, kind: string, action: ReviewQueueItem['action']): ReviewQueueItem => ({ key, group: 'sources', priority: 1, kind, params: { concept: 'Supplier' }, action });
const unsourced = item('unsourced:c-3', 'concept_without_source', { kind: 'add_source', conceptId: 'c-3' });

const show = (props: Partial<Parameters<typeof ModelSetupChecks>[0]> = {}) => render(
  <QueryClientProvider client={new QueryClient()}>
    <ModelSetupChecks modelId='m-1' canEdit items={[unsourced]} {...props} />
  </QueryClientProvider>);

describe('ModelSetupChecks', () => {
  it('lists what the next run waits for and opens where each item is fixed', () => {
    const onOpenIssue = vi.fn();
    show({ onOpenIssue });
    expect(screen.getByText('reviewQueue.kind.concept_without_source')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'reviewQueue.action.add_source' }));
    expect(onOpenIssue).toHaveBeenCalledWith(unsourced);
  });

  it('says so when nothing blocks the run', () => {
    show({ items: [] });
    expect(screen.getByText('health.setup.empty')).toBeInTheDocument();
  });

  it('shows the findings of the last structural check and runs it again on request', () => {
    const issue: ValidationIssue = { code: 'isolated_node', severity: 'warning', targetKind: 'node_type', targetId: 'c-3', message: 'Isolated' };
    const onOpenValidationIssue = vi.fn();
    const onRunCheck = vi.fn();
    show({ validation: [issue], onOpenValidationIssue, canRunCheck: true, onRunCheck });
    fireEvent.click(screen.getByRole('button', { name: 'validation.issue.isolated_node' }));
    expect(onOpenValidationIssue).toHaveBeenCalledWith('c-3');
    fireEvent.click(screen.getByRole('button', { name: 'action.validate' }));
    expect(onRunCheck).toHaveBeenCalled();
  });
});
