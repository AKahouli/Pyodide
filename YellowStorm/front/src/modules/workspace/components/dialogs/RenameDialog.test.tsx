import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RenameDialog } from './RenameDialog';

describe('RenameDialog', () => {
  it('submits new name and closes dialog', async () => {
    const onRename = vi.fn(async () => undefined);
    const onOpenChange = vi.fn();

    render(<RenameDialog open onOpenChange={onOpenChange} currentName='Old name' onRename={onRename} />);

    const input = screen.getByPlaceholderText('Workspace name');
    await userEvent.clear(input);
    await userEvent.type(input, 'New name');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));

    await waitFor(() => expect(onRename).toHaveBeenCalledWith('New name'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
