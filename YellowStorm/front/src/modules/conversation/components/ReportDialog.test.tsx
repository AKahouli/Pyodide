import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReportDialog } from './ReportDialog';

vi.mock('../store', () => ({
  useConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      reportMessage: vi.fn(),
    }),
}));

describe('ReportDialog', () => {
  it('closes dialog when cancel is clicked', async () => {
    const onOpenChange = vi.fn();
    render(<ReportDialog open onOpenChange={onOpenChange} conversationId='conv-1' messageId='m1' />);

    await userEvent.click(screen.getByRole('button', { name: 'actionCancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
