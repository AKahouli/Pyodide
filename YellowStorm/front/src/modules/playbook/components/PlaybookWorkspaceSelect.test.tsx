import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import type { ReactNode } from 'react';
import { forwardRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybookWorkspaceSelect } from './PlaybookWorkspaceSelect';

const getWorkspacesMock = vi.hoisted(() => vi.fn());
const getSharedWorkspacesMock = vi.hoisted(() => vi.fn());

vi.mock('@/modules/workspace', () => ({
  getWorkspaces: getWorkspacesMock,
  getSharedWorkspaces: getSharedWorkspacesMock,
}));

vi.mock('@/components/ui/popover', () => {
  const PopoverContext = React.createContext<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
  } | null>(null);

  return {
    Popover: ({
      children,
      open,
      onOpenChange,
    }: {
      children: ReactNode;
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }) => (
      <PopoverContext.Provider value={{ open, onOpenChange }}>
        <div>{children}</div>
      </PopoverContext.Provider>
    ),
    PopoverTrigger: ({ children }: { children: ReactNode }) => {
      const context = React.useContext(PopoverContext);
      if (!context || !React.isValidElement(children)) {
        return <>{children}</>;
      }

      return React.cloneElement(children, {
        onClick: () => context.onOpenChange(!context.open),
      });
    },
    PopoverContent: ({ children }: { children: ReactNode }) => {
      const context = React.useContext(PopoverContext);
      if (!context?.open) {
        return null;
      }

      return <div>{children}</div>;
    },
  };
});

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
  Button: forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
    ({ children, onClick, ...props }, ref) => <button type='button' ref={ref} onClick={onClick} {...props}>{children}</button>,
  ),
}));

async function openWorkspaceSelect() {
  fireEvent.click(screen.getByRole('combobox'));
  await screen.findByLabelText('search');
}

describe('PlaybookWorkspaceSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspacesMock.mockResolvedValue({
      workspaces: [
        { id: 'w1', name: 'Workspace 1', description: 'Main', documentCount: 3 },
        { id: 'w2', name: 'Workspace 2', description: '', documentCount: 1 },
      ],
    });
    getSharedWorkspacesMock.mockResolvedValue({
      workspaces: [
        { id: 'sw1', name: 'Shared Workspace', description: 'Shared', documentCount: 4, shareId: 'share-1' },
      ],
    });
  });

  it('loads workspaces and selects the clicked workspace', async () => {
    const onChange = vi.fn();
    render(<PlaybookWorkspaceSelect value={[]} onChange={onChange} />);

    await waitFor(() => expect(getWorkspacesMock).toHaveBeenCalled());
    await openWorkspaceSelect();
    fireEvent.click(await screen.findByText('Workspace 1'));
    expect(onChange).toHaveBeenCalledWith(['w1']);
  });

  it('includes shared workspaces in the list', async () => {
    const onChange = vi.fn();
    render(<PlaybookWorkspaceSelect value={[]} onChange={onChange} />);

    await waitFor(() => expect(getSharedWorkspacesMock).toHaveBeenCalled());
    await openWorkspaceSelect();
    fireEvent.click(await screen.findByText('Shared Workspace'));

    expect(onChange).toHaveBeenCalledWith(['sw1']);
  });

  it('shows selected workspace name in trigger', async () => {
    render(<PlaybookWorkspaceSelect value={['w1']} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText('Workspace 1').length).toBeGreaterThan(0));
  });

  it('replaces the current selection with the clicked workspace', async () => {
    const onChange = vi.fn();
    render(<PlaybookWorkspaceSelect value={['w1']} onChange={onChange} />);

    await waitFor(() => expect(getWorkspacesMock).toHaveBeenCalled());
    await openWorkspaceSelect();
    fireEvent.click(await screen.findByText('Workspace 2'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['w2']);
    await waitFor(() => expect(screen.queryByLabelText('search')).not.toBeInTheDocument());
  });

  it('collapses multiple incoming values to the first selected workspace in the trigger', async () => {
    render(<PlaybookWorkspaceSelect value={['w1', 'w2']} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByText('Workspace 1').length).toBeGreaterThan(0));
    expect(screen.queryByText('2 workspaces')).not.toBeInTheDocument();
  });

  it('does nothing when selecting the already active workspace', async () => {
    const onChange = vi.fn();
    render(<PlaybookWorkspaceSelect value={['w1']} onChange={onChange} />);

    await waitFor(() => expect(getWorkspacesMock).toHaveBeenCalled());
    await openWorkspaceSelect();
    fireEvent.click(await screen.findAllByText('Workspace 1').then((elements) => elements.at(-1)!));

    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByLabelText('search')).not.toBeInTheDocument());
  });
});
