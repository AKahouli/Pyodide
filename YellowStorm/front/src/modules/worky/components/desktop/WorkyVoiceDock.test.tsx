import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (k: string) => k }) }));

import { WorkyVoiceDock } from './WorkyVoiceDock';

const base = {
  state: 'idle' as const,
  level: 0,
  muted: false,
  active: false,
  onToggle: vi.fn(),
  onMute: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenPrompt: vi.fn(),
};

describe('WorkyVoiceDock', () => {
  it('idle: clicking the pill starts voice', () => {
    const onToggle = vi.fn();
    render(<WorkyVoiceDock {...base} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'nav.voice' }));
    expect(onToggle).toHaveBeenCalled();
  });

  it('active: shows a live state label and a hang-up control', () => {
    const onToggle = vi.fn();
    render(<WorkyVoiceDock {...base} active state="listening" onToggle={onToggle} />);
    expect(screen.getByTestId('voice-dock-live')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'voice.end' }));
    expect(onToggle).toHaveBeenCalled();
  });
});
