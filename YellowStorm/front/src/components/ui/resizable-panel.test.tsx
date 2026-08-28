import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResizablePanel } from './resizable-panel';

const STORAGE_KEY = 'test-resizable-panel-width';

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

function renderPanel() {
  return render(
    <ResizablePanel
      storageKey={STORAGE_KEY}
      defaultWidth={400}
      minWidth={300}
      maxWidthRatio={0.5}
      handlePosition='left'
      withHandle
      resizeHandleLabel='Resize panel'
    >
      <div>Panel content</div>
    </ResizablePanel>,
  );
}

describe('ResizablePanel', () => {
  beforeEach(() => {
    localStorage.clear();
    setViewport(1200);
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() });
  });

  it('supports accessible keyboard resizing and persists the width', async () => {
    renderPanel();
    const separator = screen.getByRole('separator', { name: 'Resize panel' });
    const panel = screen.getByText('Panel content').parentElement;

    expect(separator).toHaveAttribute('aria-valuemin', '300');
    expect(separator).toHaveAttribute('aria-valuemax', '600');
    expect(separator).toHaveAttribute('aria-valuenow', '400');
    expect(separator).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(panel).toHaveStyle({ width: '416px' });
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(panel).toHaveStyle({ width: '400px' });
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(panel).toHaveStyle({ width: '300px' });
    fireEvent.keyDown(separator, { key: 'End' });
    expect(panel).toHaveStyle({ width: '600px' });

    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBe('600'));
  });

  it('drags a left handle in the correct direction and clamps to its bounds', () => {
    renderPanel();
    const separator = screen.getByRole('separator', { name: 'Resize panel' });
    const panel = screen.getByText('Panel content').parentElement;

    fireEvent.pointerDown(separator, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 400, pointerId: 1 });
    expect(panel).toHaveStyle({ width: '500px' });
    fireEvent.pointerMove(separator, { clientX: -500, pointerId: 1 });
    expect(panel).toHaveStyle({ width: '600px' });
    fireEvent.pointerMove(separator, { clientX: 900, pointerId: 1 });
    expect(panel).toHaveStyle({ width: '300px' });
    fireEvent.pointerUp(separator, { pointerId: 1 });
  });

  it('restores a saved width and reclamps it when the viewport shrinks', async () => {
    localStorage.setItem(STORAGE_KEY, '520');
    renderPanel();
    const panel = screen.getByText('Panel content').parentElement;
    const separator = screen.getByRole('separator', { name: 'Resize panel' });

    expect(panel).toHaveStyle({ width: '520px' });
    setViewport(800);
    fireEvent(window, new Event('resize'));

    await waitFor(() => expect(panel).toHaveStyle({ width: '400px' }));
    expect(separator).toHaveAttribute('aria-valuemax', '400');
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBe('400'));
  });
});
