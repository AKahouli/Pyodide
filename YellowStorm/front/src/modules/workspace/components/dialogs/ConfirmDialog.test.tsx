import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('calls onConfirm when confirm button is clicked', async () => {
    const onConfirm = vi.fn(async () => undefined);

    render(
      <ConfirmDialog open onOpenChange={vi.fn()} title='confirm.title' description='confirm.description' onConfirm={onConfirm} confirmLabel='confirm.action' />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'confirm.action' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
