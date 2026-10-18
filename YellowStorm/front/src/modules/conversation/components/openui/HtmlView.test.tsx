import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HtmlViewContent } from './HtmlView';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));
class Port {
  onmessage?: (event: MessageEvent) => void;
  postMessage = vi.fn(); close = vi.fn(); start = vi.fn();
}
const channels: { port1: Port; port2: Port }[] = [];
function announce(element: HTMLElement) {
  const frame = element as HTMLIFrameElement;
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type: 'ys-html-shell-ready', token: frame.srcdoc.match(/data-token="([a-f0-9]+)"/)![1] } }));
}
describe('HtmlView instance channel', () => {
  beforeEach(() => {
    channels.length = 0;
    vi.stubGlobal('MessageChannel', class { port1 = new Port(); port2 = new Port(); constructor() { channels.push(this); } });
  });
  const renderView = (extra: Record<string, unknown> = {}) => render(<HtmlViewContent html='<h2>View</h2>' title='View' value={{ count: 0, enabled: false }} onChange={vi.fn()} writable {...extra} />);
  function send(data: unknown, index = 0) { act(() => channels[index].port1.onmessage?.({ data } as MessageEvent)); }
  it('rejects a forged shell source, origin or token before transferring a port', () => {
    renderView();
    const frame = screen.getByTitle('View') as HTMLIFrameElement;
    const token = frame.srcdoc.match(/data-token="([a-f0-9]+)"/)![1];
    for (const event of [
      { source: window, origin: 'null', token },
      { source: frame.contentWindow, origin: 'https://foreign.test', token },
      { source: frame.contentWindow, origin: 'null', token: 'wrong' },
    ]) fireEvent(window, new MessageEvent('message', { source: event.source, origin: event.origin, data: { type: 'ys-html-shell-ready', token: event.token } }));
    expect(channels).toHaveLength(0);
    announce(frame);
    expect(channels).toHaveLength(1);
  });
  it('never mounts an executable frame while streaming', () => {
    renderView({ streaming: true });
    expect(screen.queryByTitle('View')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('openui.html.preparing');
  });
  it('hydrates privately, accepts bounded typed updates, and blocks changes when read only', () => {
    const onChange = vi.fn();
    const view = renderView({ onChange });
    announce(screen.getByTitle('View'));
    send({ type: 'ready' });
    expect(channels[0].port1.postMessage).toHaveBeenLastCalledWith({ type: 'state', state: { count: 0, enabled: false }, writable: true });
    send({ type: 'state', state: { count: 4, enabled: false } });
    expect(onChange).toHaveBeenCalledWith({ count: 4, enabled: false });
    view.rerender(<HtmlViewContent html='<h2>View</h2>' title='View' value={{ count: 4, enabled: false }} onChange={onChange} writable={false} />);
    send({ type: 'state', state: { count: 9, enabled: true } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
  it('rejects unknown keys and never transfers a second capability to the same frame', () => {
    const onChange = vi.fn(); renderView({ onChange });
    const frame = screen.getByTitle('View'); announce(frame);
    send({ type: 'state', state: { count: 4, enabled: false, foreign: 'x' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeVisible();
    fireEvent.click(screen.getByText('openui.html.restart'));
    const newFrame = screen.getByTitle('View'); announce(newFrame); announce(newFrame);
    expect(channels).toHaveLength(2);
    expect(channels[1].port1.close).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('closes on stop, shows escaped source, and ignores a stale instance after unmount', () => {
    const onChange = vi.fn(); const view = renderView({ onChange });
    announce(screen.getByTitle('View'));
    view.unmount(); send({ type: 'state', state: { count: 1, enabled: false } });
    expect(onChange).not.toHaveBeenCalled();
    renderView(); announce(screen.getByTitle('View'));
    fireEvent.click(screen.getByText('openui.html.source'));
    expect(screen.getByText('<h2>View</h2>')).toBeVisible();
    fireEvent.click(screen.getByText('openui.html.stop'));
    expect(screen.queryByTitle('View')).toBeNull();
    expect(channels[1].port1.close).toHaveBeenCalled();
  });
  it('keeps the replacement channel open after restart and ignores old queued messages', () => {
    const onChange = vi.fn(); renderView({ onChange });
    announce(screen.getByTitle('View')); send({ type: 'ready' });
    fireEvent.click(screen.getByText('openui.html.restart'));
    announce(screen.getByTitle('View')); send({ type: 'ready' }, 1);
    expect(channels[0].port1.close).toHaveBeenCalled();
    expect(channels[1].port1.close).not.toHaveBeenCalled();
    send({ type: 'state', state: { count: 9, enabled: false } }, 0);
    expect(onChange).not.toHaveBeenCalled();
    send({ type: 'state', state: { count: 2, enabled: false } }, 1);
    expect(onChange).toHaveBeenCalledWith({ count: 2, enabled: false });
  });
});
