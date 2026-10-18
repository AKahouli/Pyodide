import trustedBridge from '../../../../public/openui-html.js?raw';
import { HTML_CSP, htmlState, sanitizeHtmlSource, type HtmlMode } from '../components/openui/html-sandbox';
import { translateConversation } from '../translation';

interface StandaloneHtmlOptions { html: string; state: unknown; mode: HtmlMode; scheme: 'light' | 'dark'; title: string; labels?: { interactiveWarning?: string; error?: string; localOnly?: string } }
interface LocalConfig { source: string; token: string; state: Record<string, unknown>; error: string }
const jsonScript = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));

/** Self-contained offline owner: no storage, credentials, endpoints or application RPC. */
function standaloneHost(config: LocalConfig) {
  const frame = document.querySelector('iframe')!;
  const status = document.getElementById('status')!;
  let connected = false, count = 0, interval = Date.now();
  const declared = Object.keys(config.state).sort();
  const timeout = setTimeout(() => fail(), 30000);
  const fail = () => { clearTimeout(timeout); status.textContent = config.error; frame.remove(); };
  function state(value: unknown): Record<string, unknown> {
    let nodes = 0;
    function visit(item: unknown, depth: number): void {
      if (++nodes > 200 || depth > 8) throw Error('Invalid state');
      if (typeof item === 'string') { if (/[\u0000\uD800-\uDFFF]/u.test(item)) throw Error('Invalid state'); return; }
      if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return;
      if (Array.isArray(item)) { item.forEach(child => visit(child, depth + 1)); return; }
      if (!item || typeof item !== 'object' || Object.getPrototypeOf(item) !== Object.prototype) throw Error('Invalid state');
      for (const [key, child] of Object.entries(item)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw Error('Invalid state');
        if (/[\u0000\uD800-\uDFFF]/u.test(key)) throw Error('Invalid state');
        visit(child, depth + 1);
      }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid state');
    visit(value, 0);
    const encoded = JSON.stringify(value), keys = Object.keys(value).sort();
    if (new TextEncoder().encode(encoded).length > 20_000 || keys.length > 40 || JSON.stringify(keys) !== JSON.stringify(declared)) throw Error('Invalid state');
    return JSON.parse(encoded);
  }
  const ready = (event: MessageEvent) => {
    if (connected || event.source !== frame.contentWindow || event.origin !== 'null' || event.data?.type !== 'ys-html-shell-ready' || event.data.token !== config.token) return;
    connected = true;
    const channel = new MessageChannel();
    let initialized = false;
    window.addEventListener('pagehide', () => { clearTimeout(timeout); channel.port1.close(); window.removeEventListener('message', ready); }, { once: true });
    channel.port1.onmessage = event => {
      if (Date.now() - interval > 1000) { interval = Date.now(); count = 0; }
      try {
        if (++count > 60 || !event.data || typeof event.data !== 'object') throw Error('Invalid message');
        if (event.data.type === 'ready' && !initialized) { initialized = true; clearTimeout(timeout); channel.port1.postMessage({ type: 'state', state: config.state, writable: true }); }
        else if (event.data.type === 'state') channel.port1.postMessage({ type: 'state', state: state(event.data.state), writable: true });
        else if (event.data.type === 'height' && typeof event.data.height === 'number' && Number.isFinite(event.data.height)) frame.style.height = Math.max(80, Math.min(2400, event.data.height)) + 'px';
        else throw Error('Invalid message');
      } catch { channel.port1.close(); fail(); }
    };
    channel.port1.start();
    frame.contentWindow!.postMessage({ type: 'ys-html-init' }, '*', [channel.port2]);
  };
  window.addEventListener('message', ready);
  frame.addEventListener('load', () => { if (!connected) frame.contentWindow?.postMessage({ type: 'ys-html-probe', token: config.token }, '*'); });
  frame.srcdoc = config.source;
}

function assertOfflineDependencies(html: string, state: Record<string, unknown>): void {
  const privateSelector = /conversation-asset:|generated-image:|(?:project|library)-file:|\b(?:AskAgent|MiniDocument|MiniTaskResult)\s*\(|\/(?:api|conversations|workspaces)\//i;
  if (privateSelector.test(html) || privateSelector.test(JSON.stringify(state))) throw new Error('HTML artifact requires application access');
  const forbiddenKeys = /^(?:conversationId|workspaceId|documentId|accessToken|refreshToken|authorization|password|apiKey|credentials)$/i;
  const checkKeys = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(checkKeys);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { if (forbiddenKeys.test(key)) throw new Error('Private application state cannot be exported'); checkKeys(child); }
  };
  checkKeys(state);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (doc.querySelector('iframe,frame,object,embed,link,form,script[src],image,use,foreignObject')) throw new Error('HTML artifact has unsupported resource dependencies');
  for (const node of doc.querySelectorAll('*')) for (const attr of node.attributes) {
    if (['src', 'srcset', 'href', 'xlink:href', 'action', 'formaction'].includes(attr.name.toLowerCase()) && attr.value
      && !(node.tagName === 'IMG' && attr.name === 'src' && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(attr.value) && attr.value.length < 80_000)) throw new Error('HTML artifact has unsupported resource dependencies');
  }
  for (const node of doc.querySelectorAll('style,[style]')) if (/url\s*\(|@import|\\/i.test(node.tagName === 'STYLE' ? node.textContent ?? '' : node.getAttribute('style') ?? '')) throw new Error('HTML artifact has unsupported style resources');
  for (const node of doc.querySelectorAll('script')) if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts)\b|\bimport\s*\(|https?:|localhost|\byellowmind\.(?:requestTask|readDocument|invoke)/i.test(node.textContent ?? '')) throw new Error('HTML artifact requires unavailable network or actions');
}

/** One detached download. Reopening always starts at the exported saved snapshot. */
export async function createStandaloneHtmlExport(options: StandaloneHtmlOptions): Promise<Blob> {
  if (!['strict', 'interactive'].includes(options.mode) || !['light', 'dark'].includes(options.scheme) || options.title.length > 200) throw new Error('Invalid standalone HTML options');
  if (typeof options.html !== 'string' || options.html.length > 100_000) throw new Error('Invalid HTML document');
  const state = htmlState(options.state);
  assertOfflineDependencies(options.html, state);
  const doc = sanitizeHtmlSource(options.html, options.mode);
  const token = crypto.randomUUID().replaceAll('-', '');
  const scripts = `'nonce-${token}'` + (options.mode === 'interactive' ? " 'unsafe-eval'" : '');
  const policy = HTML_CSP.replace('__SCRIPTS__', scripts);
  const bridge = trustedBridge.replace(/<\/script/gi, '<\\/script');
  const source = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{color-scheme:${options.scheme}}body{margin:0;font:14px/1.5 system-ui;overflow-wrap:anywhere}*,*::before,*::after{box-sizing:border-box}img,svg,canvas{max-width:100%}</style>${doc.head.innerHTML}</head><body>${doc.body.innerHTML}<script nonce="${token}" data-token="${token}" data-mode="${options.mode}">${bridge}</script></body></html>`;
  const script = `(${standaloneHost.toString()})(${jsonScript({ source, token, state, error: options.labels?.error ?? translateConversation('openui.html.error') ?? 'This HTML view could not be opened.' })});`;
  const warning = options.mode === 'interactive' ? `<p>${escapeHtml(options.labels?.interactiveWarning ?? translateConversation('openui.html.scriptWarning') ?? 'Interactive scripts can navigate away and transmit exported data.')}</p>` : '';
  const hostPolicy = `default-src 'none'; script-src ${scripts}; style-src 'unsafe-inline'; frame-src 'self' about:; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  return new Blob([`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${hostPolicy}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(options.title)}</title><style>body{margin:0;padding:16px;font:14px system-ui}iframe{display:block;width:100%;height:600px;border:0}#status{color:#b91c1c}</style></head><body>${warning}${options.labels?.localOnly ? `<p>${escapeHtml(options.labels.localOnly)}</p>` : ''}<p id="status" role="status"></p><iframe sandbox="allow-scripts" referrerpolicy="no-referrer" title="${escapeHtml(options.title)}"></iframe><script nonce="${token}">${script}</script></body></html>`], { type: 'text/html;charset=utf-8' });
}
