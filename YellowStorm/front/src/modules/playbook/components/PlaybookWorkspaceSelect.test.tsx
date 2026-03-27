import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { forwardRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybookWorkspaceSelect } from './PlaybookWorkspaceSelect';

const getWorkspacesMock = vi.hoisted(() => vi.fn());

vi.mock('@/modules/workspace', () => ({
  getWorkspaces: getWorkspacesMock,
}));

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/command', () => ({
  Command: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandInput: () => <input aria-label='search' />,
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandItem: ({ children, onSelect }: { children: ReactNode; onSelect: () => void }) => (
    <button type='button' onClick={onSelect}>{children}</button>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: forwardRef<HTMLButtonElement, { children: ReactNode; onClick?: () => void }>(
    ({ children, onClick }, ref) => <button type='button' ref={ref} onClick={onClick}>{children}</button>,
  ),
}));

describe('PlaybookWorkspaceSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspacesMock.mockResolvedValue({
      workspaces: [
        { id: 'w1', name: 'Workspace 1', description: 'Main', documentCount: 3 },
        { id: 'w2', name: 'Workspace 2', description: '', documentCount: 1 },
      ],
    });
  });

  it('loads workspaces and toggles selected values', async () => {
    const onChange = vi.fn();
    render(<PlaybookWorkspaceSelect value={[]} onChange={onChange} />);

    await waitFor(() => expect(getWorkspacesMock).toHaveBeenCalled());
    fireEvent.click(await screen.findByText('Workspace 1'));
    expect(onChange).toHaveBeenCalledWith(['w1']);
  });

  it('shows selected workspace name in trigger', async () => {
    render(<PlaybookWorkspaceSelect value={['w1']} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText('Workspace 1').length).toBeGreaterThan(0));
  });
});
