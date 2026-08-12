import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (k: string) => k, language: 'en', ready: true }),
}));

// Start/stop-on-open now lives in useWorkyVoiceSession (tested separately); the
// sheet just renders the session state and closes on End.
vi.mock('../../voice/useWorkyVoiceSession', () => ({
  useWorkyVoiceSession: () => ({
    state: 'listening',
    transcript: { you: 'hi there' },
    level: 0,
    muted: false,
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
    toggleMute: vi.fn(),
    submitTurn: vi.fn(),
    cancelTurn: vi.fn(),
    beginTake: vi.fn(),
    interrupt: vi.fn(),
    usingRealtime: true,
  }),
}));

import { VoiceSession } from './VoiceSession';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VoiceSession', () => {
  it('shows the listening state', () => {
    render(<VoiceSession streamId="s1" open onOpenChange={() => {}} />);
    expect(screen.getByText('voice.listening')).toBeTruthy();
  });

  it('End closes the sheet', async () => {
    const onOpenChange = vi.fn();
    render(<VoiceSession streamId="s1" open onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByLabelText('voice.end'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
