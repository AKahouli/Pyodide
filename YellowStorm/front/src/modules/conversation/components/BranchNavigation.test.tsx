import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { BranchNavigation } from './BranchNavigation';
import type { Message } from '../types';
const setActiveBranch = vi.fn();
vi.mock('../store', () => ({ useConversationStore: (selector: (state: { setActiveBranch: typeof setActiveBranch }) => unknown) => selector({ setActiveBranch }) }));
const branches = [{ id: 'a1', createdAt: '2026-10-18T09:00:00Z' }, { id: 'a2', createdAt: '2026-10-18T10:00:00Z' }] as Message[];
function Location() { return <output data-testid='location'>{useLocation().search}</output>; }
function mount(active = 'a2', answers = branches) {
  return render(<MemoryRouter initialEntries={['/conversation/c1?keep=yes&message=a2']}><BranchNavigation userMessageId='u1' branches={answers} activeBranchId={active} /><Location /></MemoryRouter>);
}
describe('BranchNavigation', () => {
  beforeEach(() => vi.clearAllMocks());
  it('does not render with a single branch', () => {
    mount('a1', branches.slice(0, 1));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
  it('navigates existing answers and preserves unrelated route parameters', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'branchNavigation.previous' }));
    expect(setActiveBranch).toHaveBeenCalledWith('u1', 'a1');
    expect(screen.getByTestId('location')).toHaveTextContent('?keep=yes&message=a1');
  });
  it('selects a saved answer through version history without mutating it', async () => {
    mount();
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('branchNavigation.current');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'branchNavigation.history' }), 'a1');
    expect(setActiveBranch).toHaveBeenCalledTimes(1);
    expect(setActiveBranch).toHaveBeenCalledWith('u1', 'a1');
    expect(screen.getByTestId('location')).toHaveTextContent('message=a1');
    expect(branches[0].createdAt).toBe('2026-10-18T09:00:00Z');
  });
  it('bounds arrows and allows selection when the active answer is not loaded', async () => {
    mount('missing');
    expect(screen.getByRole('button', { name: 'branchNavigation.previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'branchNavigation.next' })).toBeDisabled();
    await userEvent.selectOptions(screen.getByRole('combobox'), 'a2');
    expect(setActiveBranch).toHaveBeenCalledWith('u1', 'a2');
  });
});
