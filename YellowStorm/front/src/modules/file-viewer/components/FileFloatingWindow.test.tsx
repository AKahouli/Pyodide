import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileFloatingWindow } from './FileFloatingWindow';

const setPositionMock = vi.hoisted(() => vi.fn());
const setSizeMock = vi.hoisted(() => vi.fn());
const setMinimizedPositionMock = vi.hoisted(() => vi.fn());
const closeViewerMock = vi.hoisted(() => vi.fn());

let modeState: 'open' | 'minimized' | 'closed' = 'open';
let displayModeState: 'floating' | 'sidebar' = 'floating';
let closeOnOutsideClickState = true;

vi.mock('../store', () => ({
  useFileViewerMode: () => modeState,
  useFileViewerDisplayMode: () => displayModeState,
  useFileViewerPosition: () => ({ x: 30, y: 40 }),
  useFileViewerSize: () => ({ width: 600, height: 400 }),
  useFileViewerStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        setPosition: setPositionMock,
        setSize: setSizeMock,
        setMinimizedPosition: setMinimizedPositionMock,
        closeViewer: closeViewerMock,
        closeOnOutsideClick: closeOnOutsideClickState,
      }),
    {
      getState: () => ({
        size: { width: 1000, height: 900 },
        position: { x: 9000, y: 9000 },
        minimizedPosition: { x: 9000, y: 9000 },
      }),
    },
  ),
}));

vi.mock('../hooks', () => ({
  useResizable: () => ({
    getResizeHandleProps: (edge: string) => ({ 'data-resize-edge': edge }),
  }),
}));

vi.mock('./FileWindowTitleBar', () => ({ FileWindowTitleBar: () => <div>titlebar</div> }));
vi.mock('./FileMinimizedWindow', () => ({ FileMinimizedWindow: () => <div>minimized-pill</div> }));
vi.mock('./FileViewerContent', () => ({ FileViewerContent: () => <div>floating-content</div> }));

describe('FileFloatingWindow', () => {
  beforeEach(() => {
    closeViewerMock.mockClear();
    closeOnOutsideClickState = true;
  });

  it('renders floating window with handles in open mode', () => {
    modeState = 'open';
    displayModeState = 'floating';

    const { container } = render(<FileFloatingWindow />);
    expect(screen.getByText('titlebar')).toBeInTheDocument();
    expect(screen.getByText('floating-content')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-resize-edge]').length).toBe(8);
  });

  it('renders minimized pill in minimized mode and clamps on resize', () => {
    modeState = 'minimized';
    displayModeState = 'floating';

    render(<FileFloatingWindow />);
    expect(screen.getByText('minimized-pill')).toBeInTheDocument();

    act(() => {
      globalThis.dispatchEvent(new Event('resize'));
    });

    expect(setSizeMock).toHaveBeenCalled();
    expect(setPositionMock).toHaveBeenCalled();
    expect(setMinimizedPositionMock).toHaveBeenCalled();
  });

  it('closes the floating viewer when the backdrop is clicked', () => {
    modeState = 'open';
    displayModeState = 'floating';

    render(<FileFloatingWindow />);
    fireEvent.click(screen.getByTestId('file-viewer-backdrop'));

    expect(closeViewerMock).toHaveBeenCalledOnce();
  });

  it('does not close a floating viewer that was not opened from playbook', () => {
    modeState = 'open';
    displayModeState = 'floating';
    closeOnOutsideClickState = false;

    render(<FileFloatingWindow />);
    fireEvent.click(screen.getByTestId('file-viewer-backdrop'));

    expect(closeViewerMock).not.toHaveBeenCalled();
  });

  it('returns null when closed or non-floating mode', () => {
    modeState = 'closed';
    displayModeState = 'floating';
    const { rerender, container } = render(<FileFloatingWindow />);
    expect(container).toBeEmptyDOMElement();

    modeState = 'open';
    displayModeState = 'sidebar';
    rerender(<FileFloatingWindow />);
    expect(container).toBeEmptyDOMElement();
  });
});
