import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RenameDialog } from './RenameDialog';

describe('RenameDialog', () => {
  it('closes without rename when title is unchanged', async () => {
    const onOpenChange = vi.fn();
    const onRename = vi.fn().mockResolvedValue(undefined);

    render(<RenameDialog open onOpenChange={onOpenChange} currentTitle='Current title' onRename={onRename} />);

    await userEvent.click(screen.getByRole('button', { name: 'actionSave' }));

    expect(onRename).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renames with trimmed value and closes dialog', async () => {
    const onOpenChange = vi.fn();
    const onRename = vi.fn().mockResolvedValue(undefined);

    render(<RenameDialog open onOpenChange={onOpenChange} currentTitle='Current title' onRename={onRename} />);

    const input = screen.getByPlaceholderText('dialogs.rename.placeholder');
    await userEvent.clear(input);
    await userEvent.type(input, '  New title  ');

    await userEvent.click(screen.getByRole('button', { name: 'actionSave' }));

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('New title');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
