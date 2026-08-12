import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import * as api from '../../api';

vi.mock('../../api');
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (k: string) => k }) }));

import { ConciergeInstructionsDialog } from './ConciergeInstructionsDialog';

describe('ConciergeInstructionsDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the current prompt when opened', async () => {
    (api.getVoicePrompt as any).mockResolvedValue({ prompt: 'current text', isDefault: false });
    render(<ConciergeInstructionsDialog streamId="s1" open onOpenChange={() => {}} />);
    await waitFor(() => expect(api.getVoicePrompt).toHaveBeenCalledWith('s1'));
    expect(await screen.findByDisplayValue('current text')).toBeTruthy();
  });

  it('saves the edited prompt', async () => {
    (api.getVoicePrompt as any).mockResolvedValue({ prompt: 'a', isDefault: false });
    (api.setVoicePrompt as any).mockResolvedValue({ prompt: 'b', isDefault: false });
    render(<ConciergeInstructionsDialog streamId="s1" open onOpenChange={() => {}} />);
    const box = await screen.findByRole('textbox');
    fireEvent.change(box, { target: { value: 'b' } });
    fireEvent.click(screen.getByText('voicePrompt.save'));
    await waitFor(() => expect(api.setVoicePrompt).toHaveBeenCalledWith('s1', 'b'));
  });
});
