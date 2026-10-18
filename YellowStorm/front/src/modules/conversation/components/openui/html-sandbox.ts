import { validateMiniAppState } from './mini-app-state';

// This is browser-origin isolation, not a CPU/memory container. Never pass credentials or document bodies.
export type HtmlMode = 'strict' | 'interactive';
export const HTML_CSP = "default-src 'none'; script-src __SCRIPTS__; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'";

export function htmlState(value: unknown, declared?: Record<string, unknown>): Record<string, unknown> {
  const state = validateMiniAppState(value);
  if (Object.keys(state).length > 40 || (declared && (Object.keys(state).length !== Object.keys(declared).length || Object.keys(state).some(key => !Object.hasOwn(declared, key))))) throw new Error('Invalid HTML state');
  return state;
}

/** Policy precedes model markup; strict mode allows only our bootstrap script. */
export function htmlDocument(html: string, scheme: 'light' | 'dark', nonce: string, mode: HtmlMode = 'strict'): string {
  if (html.length > 100_000 || !/^[a-f0-9]{32}$/.test(nonce)) throw new Error('Invalid HTML document');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (doc.querySelectorAll('*').length > 3000) throw new Error('HTML complexity limit');
  doc.querySelectorAll('iframe,frame,frameset,object,embed,base,meta,link,form,template,foreignObject,use,image,animate,animateTransform,animateMotion,set,script[src]').forEach(node => node.remove());
  if (mode === 'strict') doc.querySelectorAll('script').forEach(node => node.remove());
  doc.querySelectorAll('*').forEach(node => {
    for (const attr of Array.from(node.attributes)) {
      if (/^on|href$/i.test(attr.name) || ['nonce', 'src', 'srcset', 'action', 'formaction', 'target', 'download', 'ping'].includes(attr.name.toLowerCase())) {
        if (node.tagName === 'IMG' && attr.name === 'src' && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(attr.value) && attr.value.length < 80_000) continue;
        node.removeAttribute(attr.name);
      }
    }
    if (node.tagName.toUpperCase() === 'SCRIPT') {
      // External and module scripts are unsupported; CSP also denies dynamic code and external requests.
      if (node.hasAttribute('type') && !['text/javascript', 'application/javascript'].includes(node.getAttribute('type') ?? '')) node.remove();
    }
  });
  const bootstrap = new URL('/openui-html.js', location.origin).href;
  // Inert generated scripts are evaluated only by the trusted loader in interactive mode.
  doc.querySelectorAll('script').forEach(script => script.setAttribute('type', 'application/yellowmind'));
  const policy = HTML_CSP.replace('__SCRIPTS__', bootstrap + (mode === 'interactive' ? " 'unsafe-eval'" : ''));
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{color-scheme:${scheme}}body{margin:0;font:14px/1.5 system-ui;overflow-wrap:anywhere}*,*::before,*::after{box-sizing:border-box}img,svg,canvas{max-width:100%}</style>${doc.head.innerHTML}</head><body>${doc.body.innerHTML}<script src="${bootstrap}" data-token="${nonce}" data-mode="${mode}"></script></body></html>`;
}

/** Captured markup stays untrusted and is rendered only in a passive isolated document. */
export function sanitizeHtmlCapture(value: unknown): { html: string; width: number; height: number; text: string } {
  if (!value || typeof value !== 'object') throw new Error('Invalid HTML capture');
  const item = value as Record<string, unknown>;
  if (typeof item.html !== 'string' || item.html.length > 1_500_000
    || typeof item.width !== 'number' || !Number.isFinite(item.width) || item.width < 1 || item.width > 1600
    || typeof item.height !== 'number' || !Number.isFinite(item.height) || item.height < 1 || item.height > 10000) throw new Error('HTML capture limit exceeded');
  const doc = new DOMParser().parseFromString(item.html, 'text/html');
  if (doc.querySelectorAll('*').length > 3000) throw new Error('HTML capture complexity limit');
  doc.querySelectorAll('script,style,link,meta,base,iframe,frame,frameset,object,embed,form,template,foreignObject,use,image,animate,animateTransform,animateMotion,set').forEach(node => node.remove());
  let images = 0;
  doc.querySelectorAll('*').forEach(node => {
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      if (name === 'style') {
        if (/url\s*\(|@import|expression\s*\(|\\/i.test(attr.value)) node.removeAttribute(attr.name);
      } else if (name !== 'src' && /url\s*\(|\\/i.test(attr.value)) node.removeAttribute(attr.name);
      else if (name === 'src' && node.tagName === 'IMG' && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(attr.value)) {
        images += attr.value.length; if (images > 1_000_000) throw new Error('HTML capture image limit');
      } else if (/^on/i.test(name) || ['src','srcset','href','xlink:href','action','formaction','target','download','ping','nonce'].includes(name)) node.removeAttribute(attr.name);
    }
  });
  const text = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
  return { html: doc.body.innerHTML, width: Math.ceil(item.width), height: Math.ceil(item.height), text };
}
