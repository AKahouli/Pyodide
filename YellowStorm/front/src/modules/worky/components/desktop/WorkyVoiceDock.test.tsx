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

function mockDockRect(element: HTMLElement): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    left: 400,
    right: 600,
    top: 650,
    bottom: 710,
    width: 200,
    height: 60,
    x: 400,
    y: 650,
    toJSON: () => ({}),
  });
}

describe('WorkyVoiceDock', () => {
  it('idle: clicking the pill starts voice', () => {
    const onToggle = vi.fn();
    render(<WorkyVoiceDock {...base} onToggle={onToggle} />);
    const dock = screen.getByRole('button', { name: 'nav.voice' });
    expect(dock.parentElement).toHaveClass('z-40');
    fireEvent.click(dock);
    expect(onToggle).toHaveBeenCalled();
  });

  it('active: shows a live state label and a hang-up control', () => {
    const onToggle = vi.fn();
    render(<WorkyVoiceDock {...base} active state="listening" onToggle={onToggle} />);
    expect(screen.getByTestId('voice-dock-live')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'voice.end' }));
    expect(onToggle).toHaveBeenCalled();
  });

  it('clamps successive pointer moves from the drag origin without starting voice', () => {
    const onToggle = vi.fn();
    render(<WorkyVoiceDock {...base} onToggle={onToggle} />);
    const dock = screen.getByRole('button', { name: 'nav.voice' });
    mockDockRect(dock);

    fireEvent.pointerDown(dock, { button: 0, clientX: 500, clientY: 700, pointerId: 1 });
    fireEvent.pointerMove(dock, { clientX: 600, clientY: 700, pointerId: 1 });
    fireEvent.pointerMove(dock, { clientX: 1000, clientY: 700, pointerId: 1 });
    fireEvent.pointerUp(dock, { pointerId: 1 });
    fireEvent.click(dock);

    expect(dock).toHaveStyle({ transform: 'translate(calc(-50% + 416px), 0px)' });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('reclamps the dock when the active controls expand beyond the viewport', () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const activeRect = this.getAttribute('data-testid') === 'voice-dock-live';
      return {
        left: activeRect ? 700 : 400,
        right: activeRect ? 1100 : 600,
        top: 650,
        bottom: 710,
        width: activeRect ? 400 : 200,
        height: 60,
        x: activeRect ? 700 : 400,
        y: 650,
        toJSON: () => ({}),
      };
    });
    const { rerender } = render(<WorkyVoiceDock {...base} />);
    const dock = screen.getByRole('button', { name: 'nav.voice' });

    fireEvent.pointerDown(dock, { button: 0, clientX: 500, clientY: 700, pointerId: 1 });
    fireEvent.pointerMove(dock, { clientX: 1000, clientY: 700, pointerId: 1 });
    fireEvent.pointerUp(dock, { pointerId: 1 });
    rerender(<WorkyVoiceDock {...base} active />);

    expect(screen.getByTestId('voice-dock-live')).toHaveStyle({
      transform: 'translate(calc(-50% + 332px), 0px)',
    });
    rectSpy.mockRestore();
  });

  it('allows keyboard users to reposition the dock', () => {
    render(<WorkyVoiceDock {...base} />);
    const dock = screen.getByRole('button', { name: 'nav.voice' });
    mockDockRect(dock);

    fireEvent.keyDown(dock, { key: 'ArrowLeft' });

    expect(dock).toHaveStyle({ transform: 'translate(calc(-50% + -10px), 0px)' });
    expect(dock).toHaveAccessibleDescription('voice.dragInstructions');
  });
});
