import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createStandaloneHtmlExport } from './standalone-html-export';
const bridge = readFileSync('public/openui-html.js', 'utf8');
const read = (blob: Blob): Promise<string> => new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
class Port {
  peer!: Port;
  onmessage?: (event: { data: unknown }) => void;
  postMessage(data: unknown) { this.peer.onmessage?.({ data }); }
  start() {} close() {}
}
class Channel { static created = 0; port1 = new Port(); port2 = new Port(); constructor() { Channel.created++; this.port1.peer = this.port2; this.port2.peer = this.port1; } }
afterEach(() => { window.dispatchEvent(new Event('pagehide')); document.body.innerHTML = ''; vi.restoreAllMocks(); });
async function execute(html: string, state: Record<string, unknown>, mode: 'strict' | 'interactive') {
  const file = await read(await createStandaloneHtmlExport({ html, state, mode, scheme: 'light', title: 'Offline dashboard', labels: { error: 'Offline view failed' } }));
  const outer = new DOMParser().parseFromString(file, 'text/html');
  document.body.innerHTML = outer.body.innerHTML;
  const hostScript = document.querySelector('script')!.textContent!;
  Channel.created = 0;
  new Function('window', 'document', 'MessageChannel', hostScript)(window, document, Channel);
  const frame = document.querySelector('iframe')!, childWindow = frame.contentWindow!;
  const child = new DOMParser().parseFromString(frame.srcdoc, 'text/html');
  const loader = child.querySelector('script[nonce]')!;
  Object.defineProperty(child, 'currentScript', { value: loader });
  const listeners: Record<string, (event: Record<string, unknown>) => void> = {};
  const parent = { postMessage: vi.fn() };
  function GeneratedFunction(code: string) { return () => new Function('window', code)(childWindow); }
  new Function('window','document','parent','addEventListener','ResizeObserver','Function', loader.textContent!)(childWindow,child,parent,
    (name: string, listener: (event: Record<string, unknown>) => void) => { listeners[name] ??= listener; }, class { observe() {} }, GeneratedFunction);
  vi.spyOn(childWindow, 'postMessage').mockImplementation((data: unknown, _origin?: string | WindowPostMessageOptions, ports?: Transferable[]) => { listeners.message({ source: parent, data, ports }); });
  for (const forged of [{ source: window, origin: 'null', token: loader.getAttribute('data-token') }, { source: childWindow, origin: 'https://foreign.test', token: loader.getAttribute('data-token') }, { source: childWindow, origin: 'null', token: 'wrong' }]) window.dispatchEvent(new MessageEvent('message', { source: forged.source, origin: forged.origin, data: { type: 'ys-html-shell-ready', token: forged.token } }));
  expect(Channel.created).toBe(0);
  window.dispatchEvent(new MessageEvent('message', { source: childWindow, origin: 'null', data: { type: 'ys-html-shell-ready', token: loader.getAttribute('data-token') } }));
  await Promise.resolve(); await Promise.resolve();
  return { file, child, childWindow, listeners, frame };
}
describe('standalone offline HtmlView packaging', () => {
  it('executes the exact trusted bridge and restores strict controls, filters and SVG without an app server', async () => {
    const html = '<input type="number" data-state="amount"><input type="checkbox" data-state="enabled"><select data-state="region"><option>North</option><option>South</option></select><p data-text="amount"></p><section data-filter="region" data-filter-value="North">North</section><svg><rect data-attr-width="amount"></rect></svg><script>window.generatedRan=true</script>';
    const result = await execute(html, { amount: 0, enabled: false, region: 'South' }, 'strict');
    expect(result.file).not.toMatch(/localhost|src="https?:|localStorage|sessionStorage/);
    expect(result.child.querySelector('script[nonce]')!.textContent).toBe(bridge.replace(/\r\n/g, '\n'));
    expect(result.child.querySelector('input')!.value).toBe('0');
    expect(result.child.querySelector('section')!.hidden).toBe(true);
    expect(result.child.querySelector('rect')!.getAttribute('width')).toBe('0');
    expect((result.childWindow as unknown as Record<string, unknown>).generatedRan).toBeUndefined();
    const input = result.child.querySelector('input')!; input.value = '25'; result.listeners.input({ target: input });
    expect(result.child.querySelector('p')!.textContent).toBe('25');
    expect(result.child.querySelector('rect')!.getAttribute('width')).toBe('25');
    result.childWindow.close();
  });
  it('runs allowed generated redraw code after saved state initialization in interactive mode', async () => {
    const result = await execute('<input type="number" data-state="count"><script>window.yellowmind.ready.then(()=>{window.redraw=window.yellowmind.state.count;window.yellowmind.subscribe(s=>{window.redraw=s.count})})</script>', { count: 7 }, 'interactive');
    await Promise.resolve(); await Promise.resolve();
    expect((result.childWindow as unknown as Record<string, unknown>).redraw).toBe(7);
    const input = result.child.querySelector('input')!; input.value = '12'; result.listeners.input({ target: input });
    expect((result.childWindow as unknown as Record<string, unknown>).redraw).toBe(12);
    result.childWindow.close();
  });
  it('resets local edits to the exported snapshot on reopening without browser storage', async () => {
    const html = '<input type="number" data-state="count"><p data-text="count"></p>';
    const first = await execute(html, { count: 4 }, 'strict');
    const input = first.child.querySelector('input')!; input.value = '99'; first.listeners.input({ target: input });
    expect(first.child.querySelector('p')!.textContent).toBe('99');
    first.childWindow.close();
    const reopened = await execute(html, { count: 4 }, 'strict');
    expect(reopened.child.querySelector('input')!.value).toBe('4');
    reopened.childWindow.close();
  });
  it('fails closed on undeclared state keys from generated code', async () => {
    const result = await execute('<p data-text="count"></p>', { count: 0 }, 'interactive');
    (result.childWindow as unknown as { yellowmind: { setState(value: unknown): void } }).yellowmind.setState({ foreign: true });
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.getElementById('status')!.textContent).toBe('Offline view failed');
  });
  it('encodes hostile titles, state and nested HTML without escaping the outer script or iframe', async () => {
    const file = await read(await createStandaloneHtmlExport({ html: '<p data-text="label"></p>', state: { label: '</script><script>bad()</script>' }, mode: 'strict', scheme: 'dark', title: '"><img src=x onerror=bad()>' }));
    const doc = new DOMParser().parseFromString(file, 'text/html');
    expect(doc.querySelectorAll('iframe')).toHaveLength(1);
    expect(doc.querySelectorAll('script')).toHaveLength(1);
    expect(doc.querySelectorAll('img')).toHaveLength(0);
    expect(doc.querySelector('script')!.textContent).toContain('\\u003c/script');
    expect(doc.querySelector('iframe')!.getAttribute('sandbox')).toBe('allow-scripts');
  });
  it.each([
    '<img src="https://remote.test/image.png">', '<script src="/runtime.js"></script>',
    '<style>p{background:url(/private.png)}</style>', '<style>@IMPORT \"/private.css\";</style>', '<script>fetch("/api/documents")</script>',
    '<p>conversation-asset:opaque</p>', '<form><input></form>',
  ])('rejects unavailable resources or privileged dependencies: %s', async html => {
    await expect(createStandaloneHtmlExport({ html, state: {}, mode: 'interactive', scheme: 'light', title: 'Offline' })).rejects.toThrow();
  });
  it('rejects private state and excessive bounds', async () => {
    const options = { html: '<p>View</p>', state: {}, mode: 'strict' as const, scheme: 'light' as const, title: 'View' };
    await expect(createStandaloneHtmlExport({ ...options, state: { workspaceId: 'private' } })).rejects.toThrow('Private');
    await expect(createStandaloneHtmlExport({ ...options, state: Object.fromEntries(Array.from({ length: 41 }, (_, i) => ['key'+i, i])) })).rejects.toThrow();
    await expect(createStandaloneHtmlExport({ ...options, html: 'x'.repeat(100001) })).rejects.toThrow();
  });
});
