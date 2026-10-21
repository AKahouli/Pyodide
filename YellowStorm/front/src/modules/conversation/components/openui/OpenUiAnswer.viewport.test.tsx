import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenUiAnswer } from './OpenUiAnswer';

const observer = vi.hoisted(() => ({ callbacks: [] as IntersectionObserverCallback[], disconnect: vi.fn(), load: vi.fn() }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../store', () => ({ useConversationStore: Object.assign(
  (select: (state: { messages: unknown[] }) => unknown) => select({ messages: [] }),
  { getState: () => ({ sendMessage: vi.fn() }) },
) }));
vi.mock('./preload', () => ({ loadOpenUiRenderer: observer.load }));
const props = { content: 'root = Card("Saved", [])', isStreaming: false, conversationId: 'c', messageId: 'm', partId: 'p' };
function observe() {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { observer.callbacks.push(callback); }
    observe = vi.fn();
    disconnect = observer.disconnect;
  });
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); observer.callbacks = []; observer.load.mockClear(); observer.disconnect.mockClear(); });
observer.load.mockResolvedValue({ default: () => <input aria-label='Local value' defaultValue='initial' /> });

describe('historical OpenUI viewport activation', () => {
  it('does not load or mount untouched offscreen answers', () => {
    observe();
    const { container } = render(<>{Array.from({ length: 50 }, (_, i) => <OpenUiAnswer key={i} {...props} messageId={`m${i}`} />)}</>);
    expect(container.querySelectorAll('[data-openui-deferred]')).toHaveLength(50);
    expect(observer.load).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Local value')).not.toBeInTheDocument();
  });
  it('activates near the viewport once and retains edited values after scrolling away', async () => {
    observe();
    render(<OpenUiAnswer {...props} />);
    const callback = observer.callbacks[0];
    act(() => callback([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver));
    const input = await screen.findByLabelText('Local value');
    fireEvent.change(input, { target: { value: 'kept' } });
    act(() => callback([{ isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver));
    expect(input).toHaveValue('kept');
    expect(screen.queryByText('openui.viewAnswer')).not.toBeInTheDocument();
    expect(observer.disconnect).toHaveBeenCalled();
  });
  it('supports explicit keyboard/button activation', async () => {
    observe(); render(<OpenUiAnswer {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'openui.viewAnswer' }));
    expect(await screen.findByLabelText('Local value')).toBeInTheDocument();
  });
  it.each([true, false])('mounts streaming or private mini-app answers immediately (streaming=%s)', async streaming => {
    observe();
    render(<OpenUiAnswer {...props} isStreaming={streaming} content={streaming ? props.content : 'root = MiniApp("app", {})'} />);
    expect(await screen.findByLabelText('Local value')).toBeInTheDocument();
    expect(observer.callbacks).toHaveLength(0);
  });
  it('falls back to immediate rendering without IntersectionObserver', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<OpenUiAnswer {...props} />);
    expect(await screen.findByLabelText('Local value')).toBeInTheDocument();
  });
  it('disconnects observers on unmount and resets activation across message identity changes', async () => {
    observe(); const view = render(<OpenUiAnswer {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'openui.viewAnswer' }));
    await screen.findByLabelText('Local value');
    view.rerender(<OpenUiAnswer {...props} messageId='other' />);
    expect(screen.queryByLabelText('Local value')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'openui.viewAnswer' })).toBeInTheDocument();
    view.unmount(); expect(observer.disconnect).toHaveBeenCalled();
  });
});
