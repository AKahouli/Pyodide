import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { toViewportCoords, BrowserSessionViewer } from './BrowserSessionViewer';

describe('toViewportCoords', () => {
  it('maps a canvas-relative click to viewport pixels', () => {
    const rect = { left: 0, top: 0, width: 640, height: 400 } as DOMRect;
    // canvas is half the viewport size → click at (320,200) → (640,400)
    expect(toViewportCoords(320, 200, rect, 1280, 800)).toEqual({ x: 640, y: 400 });
  });

  it('accounts for a non-zero canvas offset', () => {
    const rect = { left: 100, top: 50, width: 1280, height: 800 } as DOMRect;
    expect(toViewportCoords(100, 50, rect, 1280, 800)).toEqual({ x: 0, y: 0 });
  });
});

describe('BrowserSessionViewer loading overlay', () => {
  it('shows a loading spinner while loading', () => {
    render(<BrowserSessionViewer frame={null} onInput={() => {}} loading />);
    expect(screen.getByRole('status', { name: 'Chargement de la page' })).toBeInTheDocument();
  });

  it('hides the spinner when not loading', () => {
    render(<BrowserSessionViewer frame={null} onInput={() => {}} loading={false} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
