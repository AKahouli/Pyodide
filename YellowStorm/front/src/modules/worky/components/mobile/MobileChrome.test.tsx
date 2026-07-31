import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (k: string) => k, language: 'en', ready: true }),
}));

import { WorkyMobileNav } from './WorkyMobileNav';

beforeEach(() => vi.clearAllMocks());

describe('WorkyMobileNav', () => {
  it('fires home, voice and chat', async () => {
    const onHome = vi.fn();
    const onVoice = vi.fn();
    const onChat = vi.fn();
    render(<WorkyMobileNav onHome={onHome} onVoice={onVoice} onChat={onChat} />);

    await userEvent.click(screen.getByText('nav.home'));
    expect(onHome).toHaveBeenCalled();

    await userEvent.click(screen.getByLabelText('nav.voice'));
    expect(onVoice).toHaveBeenCalled();

    await userEvent.click(screen.getByText('nav.chat'));
    expect(onChat).toHaveBeenCalled();
  });

  it('renders only home, chat and the mic', () => {
    render(<WorkyMobileNav onHome={() => {}} onVoice={() => {}} onChat={() => {}} />);
    expect(screen.queryByText('nav.agents')).toBeNull();
    expect(screen.queryByText('nav.more')).toBeNull();
    expect(screen.getByText('nav.home')).toBeTruthy();
    expect(screen.getByText('nav.chat')).toBeTruthy();
    expect(screen.getByLabelText('nav.voice')).toBeTruthy();
  });
});
