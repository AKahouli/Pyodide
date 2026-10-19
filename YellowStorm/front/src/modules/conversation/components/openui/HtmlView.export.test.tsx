import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HtmlViewContent } from './HtmlView';
import { registerMiniAppExportGuard, type MiniAppStateSnapshot } from './mini-app-state';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), create: vi.fn(), download: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock('../../api', () => ({ fetchOpenUiAppState: mocks.fetch }));
vi.mock('../../utils/standalone-html-export', () => ({ createStandaloneHtmlExport: mocks.create }));
vi.mock('../../utils/docx-export', () => ({ downloadBlob: mocks.download }));
vi.mock('../../utils/document-export', () => ({ buildExportFilename: (title: string) => `${title}.html` }));
vi.mock('@/lib/notifications', () => ({ showError: mocks.error, showSuccess: mocks.success }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));
const identity = { userId: 'actor', conversationId: 'conversation', messageId: 'message', componentId: 'part', programDigest: 'digest' };
const value = { count: 0, enabled: false, filter: 'North', empty: null };
const props = { identity, name: 'dashboard', html: '<input data-state="count"><p data-text="filter"></p>', title: 'Dashboard', value, onChange: vi.fn(), writable: true };
let saved: MiniAppStateSnapshot;
let receiver: ((event: { data: unknown }) => void) | undefined;
const unregister: Array<() => void> = [];
function mount(guard = true) {
  const view = render(<HtmlViewContent {...props} />);
  if (guard) unregister.push(registerMiniAppExportGuard(identity, async () => {}));
  const frame = screen.getByTitle('Dashboard') as HTMLIFrameElement;
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type: 'ys-html-shell-ready', token: frame.srcdoc.match(/data-token="([a-f0-9]+)"/)![1] } }));
  act(() => receiver?.({ data: { type: 'ready' } }));
  return view;
}
beforeEach(() => {
  vi.clearAllMocks();
  saved = { schemaVersion: 1, libraryVersion: 'yellowstorm-miniapp-v1', programDigest: 'digest', stateRevision: 2,
    state: { app: { dashboard: { componentType: 'HtmlView', value } }, unrelatedPrivateField: 'must-not-export' }, updatedAt: null, canWrite: true };
  mocks.fetch.mockImplementation(async () => structuredClone(saved));
  mocks.create.mockResolvedValue(new Blob(['offline']));
  receiver = undefined;
  vi.stubGlobal('MessageChannel', class {
    port1 = { set onmessage(fn: typeof receiver) { receiver = fn; }, postMessage: vi.fn(), close: vi.fn(), start: vi.fn() };
    port2 = {};
  });
});
afterEach(() => { cleanup(); unregister.splice(0).forEach(fn => fn()); vi.unstubAllGlobals(); });

describe('saved standalone HtmlView download', () => {
  it('exports only scoped typed values after two authenticated snapshot checks', async () => {
    mount(); fireEvent.click(screen.getByText('openui.html.exportInteractive'));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ state: value, mode: 'strict', scheme: 'light' }));
    expect(JSON.stringify(mocks.create.mock.calls)).not.toMatch(/must-not-export|conversationId|programDigest/);
  });
  it.each(['missing-guard', 'readonly', 'revision', 'state', 'denied'])('rejects %s without downloading', async reason => {
    mount(reason !== 'missing-guard');
    if (reason === 'readonly') saved.canWrite = false;
    if (reason === 'denied') mocks.fetch.mockRejectedValue(new Error('403'));
    if (reason === 'revision' || reason === 'state') mocks.create.mockImplementation(async () => {
      if (reason === 'revision') saved.stateRevision++;
      else saved.state = { changed: true };
      return new Blob(['offline']);
    });
    fireEvent.click(screen.getByText('openui.html.exportInteractive'));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it.each(['actor', 'source', 'mode', 'value', 'unmount'])('cancels a pending export after %s changes', async reason => {
    const view = mount();
    let resolve!: (blob: Blob) => void;
    mocks.create.mockImplementation(() => new Promise<Blob>(done => { resolve = done; }));
    fireEvent.click(screen.getByText('openui.html.exportInteractive'));
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    if (reason === 'unmount') view.unmount();
    else view.rerender(<HtmlViewContent {...props}
      identity={reason === 'actor' ? { ...identity, userId: 'other' } : identity}
      html={reason === 'source' ? '<p>Changed</p>' : props.html}
      mode={reason === 'mode' ? 'interactive' : 'strict'}
      value={reason === 'value' ? { ...value, count: 1 } : value} />);
    await act(async () => { resolve(new Blob(['offline'])); });
    if (reason !== 'unmount') await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
