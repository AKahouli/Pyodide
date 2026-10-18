import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { htmlDocument, htmlState } from './html-sandbox';
import { htmlViewExamples } from './html-view-examples';
import { projectOpenUiProgram } from './plain-text';

const nonce = 'a'.repeat(32);
describe('HtmlView policy and state', () => {
  it('strict mode removes generated execution, navigation and nested documents while retaining visuals', () => {
    const result = htmlDocument(`<h2>Sales</h2><script>alert(1)</script><script src="https://bad.test/a.js"></script><button onclick="location='https://bad.test'">Go</button><a href="https://bad.test">link</a><svg><a xlink:href="https://bad.test">x</a><rect width="10" /></svg><template><a href="https://bad.test">hidden</a></template><meta http-equiv="refresh" content="0;url=https://bad.test"><iframe src="https://bad.test"></iframe>`, 'dark', nonce);
    const doc = new DOMParser().parseFromString(result, 'text/html');
    expect(doc.querySelectorAll('script')).toHaveLength(1);
    expect(doc.querySelector('script')?.getAttribute('src')).toContain('/openui-html.js');
    expect(doc.querySelector('meta[http-equiv]')?.getAttribute('content')).toContain('/openui-html.js');
    expect(doc.querySelector('meta[http-equiv]')?.getAttribute('content')).not.toContain('unsafe-eval');
    expect(doc.querySelector('[onclick],[href],[xlink\\:href],iframe,template')).toBeNull();
    expect(doc.querySelector('rect')).not.toBeNull();
    expect(result).toContain('color-scheme:dark');
  });
  it('interactive mode permits inline code without giving external scripts a nonce capability', () => {
    const result = htmlDocument('<script>yellowmind.ready.then(()=>console.log("ready"))</script><script src="https://bad.test/x.js"></script>', 'light', nonce, 'interactive');
    const doc = new DOMParser().parseFromString(result, 'text/html');
    expect(doc.querySelectorAll('script')).toHaveLength(2);
    expect(doc.querySelectorAll('script[src]')).toHaveLength(1);
    expect(doc.querySelector('script[type="application/yellowmind"]')).not.toBeNull();
    const policy = doc.querySelector('meta[http-equiv]')?.getAttribute('content');
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).not.toContain('unsafe-inline; script');
    expect(policy).not.toContain('nonce-');
    expect(policy).toContain("connect-src 'none'");
  });
  it('roundtrips declared typed false, zero, blank and null; rejects unsafe or oversized state', () => {
    const initial = { region: '', count: 0, enabled: false, empty: null };
    expect(htmlState(JSON.parse(JSON.stringify(initial)), initial)).toEqual(initial);
    expect(() => htmlState({ ...initial, foreign: true }, initial)).toThrow();
    expect(() => htmlState({ region: '' }, initial)).toThrow();
    expect(() => htmlState(JSON.parse('{"__proto__":{"x":1}}'))).toThrow();
    expect(() => htmlState({ text: 'x'.repeat(21_000) })).toThrow();
    expect(() => htmlState({ count: Infinity })).toThrow();
    expect(() => htmlDocument('x'.repeat(100_001), 'light', nonce)).toThrow();
    expect(() => htmlDocument('<p></p>'.repeat(3001), 'light', nonce)).toThrow();
  });
  it('executes only the trusted bridge to hydrate typed controls and update strict visuals', () => {
    const source = htmlDocument('<input aria-label="Count" type="number" data-state="count"><input type="checkbox" data-state="enabled"><span data-text="count"></span><p data-show="enabled">Detail</p><div data-progress="count"></div><section data-filter="region" data-filter-value="North">North</section>', 'light', nonce);
    const doc = new DOMParser().parseFromString(source, 'text/html');
    const listeners: Record<string, (event: { target?: Element; filename?: string; source?: unknown; data?: { type: string }; ports?: unknown[] }) => void> = {};
    const port = { postMessage: vi.fn(), start: vi.fn(), onmessage: undefined as undefined | ((event: { data: unknown }) => void) };
    const frameWindow = { __ysHtmlPort: port } as { __ysHtmlPort?: typeof port; yellowmind?: { state: unknown } };
    // Execute the exact trusted bootstrap, never generated HTML code.
    Object.defineProperty(doc, 'currentScript', { value: doc.querySelector('script[src]') });
    const bootstrap = readFileSync('public/openui-html.js', 'utf8');
    const parent = { postMessage: vi.fn() };
    new Function('window', 'document', 'parent', 'addEventListener', 'ResizeObserver', bootstrap)(frameWindow, doc, parent, (name: string, fn: typeof listeners[string]) => { if (!listeners[name]) listeners[name] = fn; }, class { observe() {} });
    listeners.message({ source: parent, data: { type: 'ys-html-init' }, ports: [port] });
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'ready' });
    port.onmessage!({ data: { type: 'state', state: { count: 0, enabled: false, region: 'South' }, writable: true } });
    expect(doc.querySelector('input')?.value).toBe('0');
    expect(doc.querySelector('span')?.textContent).toBe('0');
    expect(doc.querySelector('p')?.hidden).toBe(true);
    expect(doc.querySelector('section')?.hidden).toBe(true);
    const input = doc.querySelector('input')!; input.value = '75'; listeners.input({ target: input });
    expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'state', state: { count: 75, enabled: false, region: 'South' } });
    port.postMessage.mockClear();
    listeners.error({ target: input, filename: 'chrome-extension://test/inpage.js' });
    expect(port.postMessage).not.toHaveBeenCalled();
    listeners.error({ target: input, filename: location.href });
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'error' });
    expect(doc.querySelector('div')?.style.width).toBe('75%');
  });
  it.each(['throw Error("generated failure")', 'const = invalid'])('reports generated failures only after the private channel is ready: %s', async code => {
    const doc = new DOMParser().parseFromString(htmlDocument(`<script>${code}</script>`, 'light', nonce, 'interactive'), 'text/html');
    Object.defineProperty(doc, 'currentScript', { value: doc.querySelector('script[src]') });
    let initialize: ((event: unknown) => void) | undefined;
    const port = { postMessage: vi.fn(), start: vi.fn(), onmessage: undefined as undefined | ((event: { data: unknown }) => void) };
    const parent = { postMessage: vi.fn() };
    new Function('window', 'document', 'parent', 'addEventListener', 'ResizeObserver', readFileSync('public/openui-html.js', 'utf8'))({}, doc, parent,
      (name: string, fn: (event: unknown) => void) => { if (name === 'message' && !initialize) initialize = fn; }, class { observe() {} });
    await Promise.resolve();
    expect(port.postMessage).not.toHaveBeenCalled();
    initialize!({ source: parent, data: { type: 'ys-html-init' }, ports: [port] });
    port.onmessage!({ data: { type: 'state', state: {}, writable: true } });
    await Promise.resolve();
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'error' });
  });
  it.each(Object.entries(htmlViewExamples))('registers the %s fixture and explicitly rejects unsupported visual export', async (_name, program) => {
    await expect(projectOpenUiProgram(program, undefined, undefined, { reactiveState: {} })).rejects.toThrow('Saved mounted HtmlView required');
  });
});
