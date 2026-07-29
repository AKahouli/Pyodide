import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (k: string) => k, language: 'en', ready: true }),
}));

import { WorkyVoiceDock } from './WorkyVoiceDock';

describe('WorkyVoiceDock', () => {
  it('opens the voice session when clicked', async () => {
    const onOpen = vi.fn();
    render(<WorkyVoiceDock onOpen={onOpen} />);
    expect(screen.getByText('voice.manager')).toBeTruthy();
    await userEvent.click(screen.getByLabelText('nav.voice'));
    expect(onOpen).toHaveBeenCalled();
  });
});
