import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConversationV2Store } from '../store';

const mockStart = vi.fn();
const mockSubscribe = vi.fn();
const mockDetach = vi.fn();
const mockAttach = vi.fn();
const mockRetry = vi.fn();

let hostState: {
  status: 'idle' | 'connecting' | 'registering' | 'hydrating' | 'installing' | 'starting' | 'ready' | 'error' | 'disconnected';
  previewUrl: string | null;
  error: string | null;
  files: Record<string, string> | null;
  revisionId: string;
} = {
  status: 'idle',
  previewUrl: null,
  error: null,
  files: null,
  revisionId: 'rev_0',
};
let listener: ((s: typeof hostState) => void) | null = null;

vi.mock('../runtime/BrowserRuntimeHost', () => ({
  getOrCreateHost: vi.fn(() => ({
    get state() {
      return hostState;
    },
    start: mockStart,
    retry: mockRetry,
    subscribe: (fn: (s: typeof hostState) => void) => {
      listener = fn;
      mockSubscribe(fn);
      return () => {
        listener = null;
      };
    },
    attachPreviewIframe: mockAttach,
    detachPreviewIframe: mockDetach,
  })),
}));

import { useNodepodPreview } from './useNodepodPreview';

describe('useNodepodPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listener = null;
    hostState = {
      status: 'idle',
      previewUrl: null,
      error: null,
      files: null,
      revisionId: 'rev_0',
    };
    useConversationV2Store.setState({ runtimeStatus: 'idle', rightPanelMode: 'closed' });
  });

  it('subscribes to the host and never calls start (no double boot)', () => {
    renderHook(() => useNodepodPreview({ sessionId: 'sess_1' }));

    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('mirrors host status into the Zustand runtimeStatus store', () => {
    renderHook(() => useNodepodPreview({ sessionId: 'sess_1' }));

    act(() => {
      hostState = {
        ...hostState,
        status: 'ready',
        previewUrl: 'https://nodepod.local/__virtual__/5173/',
      };
      listener?.(hostState);
    });

    expect(useConversationV2Store.getState().runtimeStatus).toBe('browser_active');
    expect(useConversationV2Store.getState().rightPanelMode).toBe('app');
  });

  it('maps hydrating host status to store hydrating and opens the app panel', () => {
    renderHook(() => useNodepodPreview({ sessionId: 'sess_1' }));

    act(() => {
      hostState = { ...hostState, status: 'installing' };
      listener?.(hostState);
    });

    expect(useConversationV2Store.getState().runtimeStatus).toBe('hydrating');
  });

  it('does not override an open tool panel when the runtime becomes ready', () => {
    useConversationV2Store.setState({
      rightPanelMode: 'tool',
      selectedToolCallId: 'tc_1',
    });
    renderHook(() => useNodepodPreview({ sessionId: 'sess_1' }));

    act(() => {
      hostState = { ...hostState, status: 'ready' };
      listener?.(hostState);
    });

    expect(useConversationV2Store.getState().rightPanelMode).toBe('tool');
  });

  it('wires previewIframeRef to attach/detach without booting', () => {
    const { result } = renderHook(() => useNodepodPreview({ sessionId: 'sess_1' }));
    const iframe = document.createElement('iframe');

    act(() => {
      result.current.previewIframeRef(iframe);
    });
    expect(mockAttach).toHaveBeenCalledWith(iframe);
    expect(mockStart).not.toHaveBeenCalled();

    act(() => {
      result.current.previewIframeRef(null);
    });
    expect(mockDetach).toHaveBeenCalled();
  });

  it('resets store runtimeStatus when sessionId becomes null', () => {
    useConversationV2Store.setState({ runtimeStatus: 'browser_active' });
    const { rerender } = renderHook(
      ({ sessionId }: { sessionId: string | null }) => useNodepodPreview({ sessionId }),
      { initialProps: { sessionId: 'sess_1' as string | null } },
    );

    rerender({ sessionId: null });
    expect(useConversationV2Store.getState().runtimeStatus).toBe('idle');
  });
});

describe('useNodepodPreview port resolution helpers', () => {
  it('extracts the internal port from a Nodepod virtual URL', async () => {
    const { extractNodepodPortFromPreviewUrl } = await import('./useNodepodPreview');
    expect(
      extractNodepodPortFromPreviewUrl(
        'https://poc.yellowmind.ai/__virtual__/podb174ceb4/3000',
      ),
    ).toBe(3000);
  });

  it('extracts the localhost port from dev-server output with ANSI codes', async () => {
    const { extractPortFromDevServerOutput } = await import('./useNodepodPreview');
    expect(
      extractPortFromDevServerOutput(
        '  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m3000\u001b[22m/\u001b[39m',
      ),
    ).toBe(3000);
  });

  it('prefers the preview URL port over the reported fallback port', async () => {
    const { resolvePreviewPort } = await import('./useNodepodPreview');
    expect(
      resolvePreviewPort({
        previewUrl: 'https://poc.yellowmind.ai/__virtual__/podb174ceb4/3000',
        reportedPort: 5173,
      }),
    ).toBe(3000);
  });
});
