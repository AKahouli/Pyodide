import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (k: string) => k, language: 'en', ready: true }),
}));

import { WorkyMobileNav } from './WorkyMobileNav';

beforeEach(() => vi.clearAllMocks());

describe('WorkyMobileNav', () => {
  it('changes tab, opens voice and goes home', async () => {
    const onChange = vi.fn();
    const onVoice = vi.fn();
    const onHome = vi.fn();
    render(<WorkyMobileNav active="agents" onChange={onChange} onVoice={onVoice} onHome={onHome} />);

    await userEvent.click(screen.getByText('nav.chat'));
    expect(onChange).toHaveBeenCalledWith('chat');

    await userEvent.click(screen.getByLabelText('nav.voice'));
    expect(onVoice).toHaveBeenCalled();

    await userEvent.click(screen.getByText('nav.home'));
    expect(onHome).toHaveBeenCalled();
  });

  it('no longer renders a "More" tab', () => {
    render(<WorkyMobileNav active="agents" onChange={() => {}} onVoice={() => {}} onHome={() => {}} />);
    expect(screen.queryByText('nav.more')).toBeNull();
  });
});
