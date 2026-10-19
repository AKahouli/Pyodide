import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { captureHtmlView, registerHtmlCapture } from './html-capture';
import { sanitizeHtmlCapture } from './html-sandbox';
const identity = { userId: 'actor', conversationId: 'conversation', messageId: 'message', componentId: 'part', programDigest: 'digest' };
describe('private static HtmlView capture', () => {
  it('requires a live exact actor/source/name registration and removes it on cleanup', async () => {
    const props = { html: '<p>Saved</p>', name: 'dashboard', value: { amount: 0, enabled: false } };
    const capture = vi.fn(async () => ({ html: '<p>Saved</p>', width: 640, height: 360, text: 'forged' }));
    const unregister = registerHtmlCapture(identity, props, capture);
    expect(await captureHtmlView(props, identity)).toMatchObject({ text: 'Saved' });
    expect(capture).toHaveBeenCalledWith(props.value);
    await expect(captureHtmlView(props, { ...identity, userId: 'foreign' })).rejects.toThrow('Open');
    await expect(captureHtmlView({ ...props, name: 'other' }, identity)).rejects.toThrow('Open');
    unregister(); await expect(captureHtmlView(props, identity)).rejects.toThrow('Open');
  });
  it('captures the exact trusted bootstrap DOM without rerunning generated code', () => {
    const doc = new DOMParser().parseFromString('<body><input data-state="count"><p>Visible</p><script src="/openui-html.js" data-token="test"></script></body>', 'text/html');
    Object.defineProperty(doc, 'currentScript', { value: doc.querySelector('script') });
    Object.defineProperty(doc.documentElement, 'clientWidth', { value: 640 });
    Object.defineProperty(doc.documentElement, 'scrollHeight', { value: 360 });
    const listeners: Record<string, (event: unknown) => void> = {}, parent = { postMessage: vi.fn() };
    const port = { postMessage: vi.fn(), start: vi.fn(), onmessage: undefined as undefined | ((event: { data: unknown }) => void) };
    const computed = { display: 'block', visibility: 'visible', *[Symbol.iterator]() { yield 'color'; }, getPropertyValue: () => 'rgb(0, 0, 0)' };
    new Function('window', 'document', 'parent', 'addEventListener', 'ResizeObserver', 'getComputedStyle', readFileSync('public/openui-html.js', 'utf8'))({}, doc, parent,
      (name: string, fn: (event: unknown) => void) => { listeners[name] ??= fn; }, class { observe() {} }, () => computed);
    listeners.message({ source: parent, data: { type: 'ys-html-init' }, ports: [port] });
    port.onmessage!({ data: { type: 'state', state: { count: 0 }, writable: true } });
    port.onmessage!({ data: { type: 'capture', id: 'request', state: { count: 0 } } });
    expect(port.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'capture', id: 'request', state: { count: 0 }, capture: expect.objectContaining({ width: 640, height: 360, html: expect.stringContaining('>0</span>') }) }));
    port.onmessage!({ data: { type: 'capture', id: 'stale', state: { count: 1 } } });
    expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'capture', id: 'stale', state: null });
  });
  it('sanitizes untrusted output and rejects oversized shapes and media', () => {
    const result = sanitizeHtmlCapture({ html: '<script>bad()</script><iframe src="https://evil"></iframe><p onclick="bad()" style="background:url(https://evil)">Visible</p><a href="https://evil">Label</a>', width: 640, height: 360 });
    expect(result.html).not.toMatch(/script|iframe|onclick|https:|url\(/);
    expect(result.text).toBe('VisibleLabel');
    expect(() => sanitizeHtmlCapture({ html: '<p>x</p>', width: 1601, height: 360 })).toThrow();
    expect(() => sanitizeHtmlCapture({ html: 'x'.repeat(1500001), width: 1, height: 1 })).toThrow();
  });
});
