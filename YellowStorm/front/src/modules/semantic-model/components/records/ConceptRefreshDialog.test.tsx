import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConceptRefreshDialog } from './ConceptRefreshDialog';

describe('ConceptRefreshDialog', () => {
  it('refreshes reusing the earlier AI answers unless asked to call the AI again', async () => {
    const onConfirm = vi.fn(async () => undefined);
    const onOpenChange = vi.fn();
    render(<ConceptRefreshDialog open onOpenChange={onOpenChange} conceptLabel='Fait' onConfirm={onConfirm} />);

    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByText('records.table.refreshConfirm'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ rereadDocuments: false }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('records.table.refreshConfirm'));
    await waitFor(() => expect(onConfirm).toHaveBeenLastCalledWith({ rereadDocuments: true }));
  });
});
