import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import OpenUiRenderer from './OpenUiRenderer';
import { MiniAppWritableContext } from './actions';
import { htmlViewExamples } from './html-view-examples';
import { validateMiniAppState } from './mini-app-state';

vi.mock('../../hooks/useConversationSettings', () => ({ useConversationSettings: () => ({ generativeUi: { htmlMode: 'strict' } }) }));
vi.mock('@/modules/localization', async original => ({ ...await original<typeof import('@/modules/localization')>(), useModuleTranslation: () => ({ t: (key: string) => key }) }));
function announce(element: HTMLElement) {
  const frame = element as HTMLIFrameElement;
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type: 'ys-html-shell-ready', token: frame.srcdoc.match(/data-token="([a-f0-9]+)"/)![1] } }));
}
describe('HtmlView OpenUI state binding', () => {
  it('restores scoped object field edits while the variable default remains unchanged', async () => {
    let receive: ((event: MessageEvent) => void) | undefined;
    const postMessage = vi.fn();
    vi.stubGlobal('MessageChannel', class { port1 = { set onmessage(value: (event: MessageEvent) => void) { receive = value; }, postMessage, start() {}, close() {} }; port2 = {}; });
    const edited = { region: 'North', target: 0, notes: false };
    const initialState = { $view: { region: 'all', target: 70, notes: false }, html_sales: { view: { componentType: 'HtmlView', value: edited } } };
    render(<MiniAppWritableContext.Provider value><OpenUiRenderer content={htmlViewExamples.sales} initialState={initialState} isStreaming={false} onAction={vi.fn()} /></MiniAppWritableContext.Provider>);
    announce(await screen.findByTitle('Regional sales explorer'));
    act(() => receive?.({ data: { type: 'ready' } } as MessageEvent));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'state', state: edited, writable: true }));
  });
  it('hydrates a registered object variable and emits typed changes for autosave', async () => {
    let receive: ((event: MessageEvent) => void) | undefined;
    const postMessage = vi.fn();
    vi.stubGlobal('MessageChannel', class { port1 = { set onmessage(value: (event: MessageEvent) => void) { receive = value; }, postMessage, start() {}, close() {} }; port2 = {}; });
    const onStateUpdate = vi.fn();
    render(<StrictMode><MiniAppWritableContext.Provider value><OpenUiRenderer content={htmlViewExamples.sales} isStreaming={false} onAction={vi.fn()} onStateUpdate={onStateUpdate} /></MiniAppWritableContext.Provider></StrictMode>);
    const frame = await screen.findByTitle('Regional sales explorer');
    announce(frame);
    act(() => receive?.({ data: { type: 'ready' } } as MessageEvent));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'state', state: { region: 'all', target: 70, notes: false }, writable: true }));
    act(() => receive?.({ data: { type: 'state', state: { region: 'North', target: 0, notes: false } } } as MessageEvent));
    await waitFor(() => expect(JSON.stringify(onStateUpdate.mock.calls)).toContain('North'));
    for (const [state] of onStateUpdate.mock.calls) expect(() => validateMiniAppState(state)).not.toThrow();
  });
});
