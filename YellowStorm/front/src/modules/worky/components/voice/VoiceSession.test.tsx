import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (k: string) => k, language: 'en', ready: true }),
}));

const vs = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), state: { current: 'listening' as string } }));
vi.mock('../../voice/useVoiceSession', () => ({
  useVoiceSession: () => ({
    state: vs.state.current,
    transcript: { you: 'hi there' },
    start: vs.start,
    stop: vs.stop,
    mute: vs.stop,
  }),
}));

import { VoiceSession } from './VoiceSession';

beforeEach(() => {
  vi.clearAllMocks();
  vs.state.current = 'listening';
});

describe('VoiceSession', () => {
  it('starts on open and shows the listening state', () => {
    render(<VoiceSession streamId="s1" open onOpenChange={() => {}} />);
    expect(vs.start).toHaveBeenCalled();
    expect(screen.getByText('voice.listening')).toBeTruthy();
  });

  it('End stops the session and closes', async () => {
    const onOpenChange = vi.fn();
    render(<VoiceSession streamId="s1" open onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByLabelText('voice.end'));
    expect(vs.stop).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
