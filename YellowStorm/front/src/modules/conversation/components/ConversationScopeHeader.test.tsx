import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AvailableGovernedScope } from '@/modules/governance';
import { ConversationScopeHeader } from './ConversationScopeHeader';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));
const scope = {
  scopeId: 'support', name: 'Support', revisionNumber: 9,
  description: 'Customer support scope', primaryAgent: { id: 'agent-1', name: 'Support agent' },
} as AvailableGovernedScope;

describe('ConversationScopeHeader', () => {
  it('shows details only on demand, without changing the selected scope', async () => {
    const onChange = vi.fn();
    const { container } = render(<ConversationScopeHeader enabled scopes={[scope]} scope={scope} locked={false} onChange={onChange} onRetry={vi.fn()} />);
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    await userEvent.click(screen.getByText('home.scope.viewDetails'));
    expect(container.querySelector('details')).toHaveAttribute('open');
    expect(screen.getByText(scope.description!)).toBeVisible();
    expect(screen.getByRole('combobox')).toHaveValue(scope.scopeId);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('retains the pinned name and disabled selection when scope availability disappears', () => {
    render(<ConversationScopeHeader enabled scopes={[]} scope={scope} locked onChange={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('combobox')).toHaveValue('support');
    expect(screen.getByRole('option', { name: 'Support' })).toBeInTheDocument();
    expect(screen.getByText('home.scope.locked')).toBeInTheDocument();
  });

  it('keeps standard mode available while allowing a failed scope request to be retried', async () => {
    const onRetry = vi.fn();
    render(<ConversationScopeHeader enabled scopes={[]} locked={false} isError onChange={vi.fn()} onRetry={onRetry} />);
    expect(screen.getByRole('combobox')).toHaveValue('');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'home.retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
