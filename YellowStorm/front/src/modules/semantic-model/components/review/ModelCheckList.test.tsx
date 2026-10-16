import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelCheck, ModelCheckIssue, SemanticGraph } from '../../types';
import { useSemanticModelEditorStore } from '../../store';
import { ModelCheckList } from './ModelCheckList';

const concept = (id: string, label: string) => ({ id, key: id, label, description: '', category: 'business_object' as const, recordPolicy: 'optional' as const, systemKey: null, aliases: [], attributes: [], position: { x: 0, y: 0 } });
const graph: SemanticGraph = { modelId: 'model', versionId: 'v', revision: 0, nodes: [concept('customer', 'Customer'), concept('order', 'Order')], relations: [], records: [], recordRelations: [] };
const issue = (overrides: Partial<ModelCheckIssue>): ModelCheckIssue => ({ severity: 'error', code: 'no_identity', message: 'No unique field', ...overrides });
const check = (issues: ModelCheckIssue[]): ModelCheck => ({
  modelId: 'model', versionKey: 'v', checkedAt: '', issues,
  errorCount: issues.filter((item) => item.severity === 'error').length, warningCount: issues.filter((item) => item.severity === 'warning').length,
});

describe('ModelCheckList', () => {
  beforeEach(() => { useSemanticModelEditorStore.getState().hydrate(graph); });

  it('lists the issues by concept, errors first, and opens the one that is clicked', () => {
    const onOpenIssue = vi.fn();
    const error = issue({ conceptId: 'order' });
    render(<ModelCheckList check={check([issue({ severity: 'warning', code: 'missing_label_field', conceptId: 'customer' }), error])} onOpenIssue={onOpenIssue} />);

    const titles = screen.getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent);
    expect(titles).toEqual(['check.group.concept', 'check.group.concept']);
    const groups = screen.getAllByRole('heading', { level: 4 }).map((heading) => heading.parentElement!);
    expect(within(groups[0]).getByRole('button')).toHaveAttribute('data-severity', 'error');
    expect(within(groups[1]).getByRole('button')).toHaveAttribute('data-severity', 'warning');

    fireEvent.click(within(groups[0]).getByRole('button'));
    expect(onOpenIssue).toHaveBeenCalledWith(error);
  });

  it('says so when nothing is wrong, and when the check could not be read', () => {
    const { rerender } = render(<ModelCheckList check={check([])} />);
    expect(screen.getByText('check.clean')).toBeInTheDocument();
    rerender(<ModelCheckList loadFailed />);
    expect(screen.getByText('check.unavailable')).toBeInTheDocument();
    rerender(<ModelCheckList />);
    expect(screen.queryByText('check.unavailable')).not.toBeInTheDocument();
  });
});
