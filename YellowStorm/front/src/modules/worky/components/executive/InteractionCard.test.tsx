import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InteractionCard } from './InteractionCard';

const mutate = vi.fn();

vi.mock('../../query/hooks', () => ({
  useRespondInteraction: () => ({ mutate, isPending: false }),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

const interaction = {
  id: 'interaction-1',
  taskId: null,
  type: 'approval' as const,
  question: 'May I proceed?',
  options: [],
  blocksTaskIds: [],
  createdAt: '2026-09-02T00:00:00.000Z',
};

describe('InteractionCard', () => {
  beforeEach(() => mutate.mockReset());

  it('sends an explicit approval verdict', async () => {
    render(<InteractionCard streamId='stream-1' interaction={interaction} />);

    await userEvent.click(screen.getByText('approval.approve'));

    expect(mutate).toHaveBeenCalledWith({
      interactionId: 'interaction-1',
      content: 'approved',
      approve: true,
    });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('sends an explicit rejection verdict', async () => {
    render(<InteractionCard streamId='stream-1' interaction={interaction} />);

    await userEvent.click(screen.getByText('approval.reject'));

    expect(mutate).toHaveBeenCalledWith({
      interactionId: 'interaction-1',
      content: 'rejected',
      approve: false,
    });
  });
});
