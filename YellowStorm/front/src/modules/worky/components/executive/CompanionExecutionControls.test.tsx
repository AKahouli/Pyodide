import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompanionExecutionControls } from './CompanionExecutionControls';

const pause = vi.fn();
const resume = vi.fn();
const stop = vi.fn();
const { showError } = vi.hoisted(() => ({ showError: vi.fn() }));

vi.mock('@/lib/notifications', () => ({ showError }));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../query/hooks', () => ({
  usePauseTurn: () => ({ mutate: pause, isPending: false }),
  useResumeTurn: () => ({ mutate: resume, isPending: false }),
  useStopTurn: () => ({ mutate: stop, isPending: false }),
}));

describe('CompanionExecutionControls', () => {
  it('offers Pause only while running', () => {
    render(<CompanionExecutionControls streamId='s1' sessionStatus='running' />);
    fireEvent.click(screen.getByLabelText('executive.controls.pause'));
    expect(pause).toHaveBeenCalledWith({ streamId: 's1' }, expect.objectContaining({ onError: expect.any(Function) }));
    expect(screen.queryByLabelText('executive.controls.resume')).not.toBeInTheDocument();
  });

  it('offers Resume while paused and hides controls for terminal sessions', () => {
    const { rerender } = render(<CompanionExecutionControls streamId='s1' sessionStatus='paused' />);
    fireEvent.click(screen.getByLabelText('executive.controls.resume'));
    expect(resume).toHaveBeenCalledWith({ streamId: 's1' }, expect.objectContaining({ onError: expect.any(Function) }));
    rerender(<CompanionExecutionControls streamId='s1' sessionStatus='completed' />);
    expect(screen.queryByLabelText('executive.controls.stop')).not.toBeInTheDocument();
  });

  it('requires confirmation before stopping', () => {
    render(<CompanionExecutionControls streamId='s1' sessionStatus='waiting' />);
    fireEvent.click(screen.getByLabelText('executive.controls.stop'));
    expect(screen.getByText('executive.controls.stopDescription')).toBeInTheDocument();
    fireEvent.click(screen.getByText('executive.controls.stopConfirm'));
    expect(stop).toHaveBeenCalledWith({ streamId: 's1' }, expect.objectContaining({ onError: expect.any(Function) }));
  });

  it('shows localized feedback when a control request fails', () => {
    render(<CompanionExecutionControls streamId='s1' sessionStatus='running' />);
    fireEvent.click(screen.getByLabelText('executive.controls.pause'));
    const options = pause.mock.calls.at(-1)?.[1] as { onError: (error: Error) => void };

    options.onError(new Error('network unavailable'));

    expect(showError).toHaveBeenCalledWith('executive.controls.pauseFailed', {
      description: 'network unavailable',
    });
  });
});
