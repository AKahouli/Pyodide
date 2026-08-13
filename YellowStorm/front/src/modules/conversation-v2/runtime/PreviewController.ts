import type { Nodepod } from '@scelar/nodepod';
import { ToolError } from './ToolError';
import {
  RuntimeErrorCodes,
  type DomSummaryNode,
  type PreviewActionName,
  type PreviewActionResult,
  type PreviewInspectResult,
} from './runtime.types';
import { DOM_SUMMARY_MAX_DEPTH, DOM_SUMMARY_MAX_NODES } from './limits';

const LOG = '[PreviewController]';
export const PREVIEW_PORTS = [5173, 3000, 8080] as const;

const VISIBLE_TEXT_MAX_CHARS = 8_000;
const NODE_TEXT_MAX_CHARS = 120;

function log(phase: string, details?: Record<string, unknown>) {
  if (details) {
    console.log(`${LOG} [${phase}]`, details);
  } else {
    console.log(`${LOG} [${phase}]`);
  }
}

function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}

export function extractNodepodPortFromPreviewUrl(url: string | null | undefined): number | null {
  if (!url) return null;
  const parsePort = (value: string): number | null => {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
  };
  try {
    const parsed = new URL(url, window.location.href);
    const virtualMatch = parsed.pathname.match(/\/__virtual__\/[^/]+\/(\d+)(?:\/|$)/i);
    if (virtualMatch) return parsePort(virtualMatch[1]);
    if ((parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') && parsed.port) {
      return parsePort(parsed.port);
    }
    if (parsed.port) return parsePort(parsed.port);
  } catch {
    const virtualMatch = url.match(/\/__virtual__\/[^/]+\/(\d+)(?:\/|$)/i);
    if (virtualMatch) return parsePort(virtualMatch[1]);
    const localMatch = url.match(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/i);
    if (localMatch) return parsePort(localMatch[1]);
  }
  return null;
}

export function extractPortFromDevServerOutput(text: string): number | null {
  const cleaned = stripAnsi(text);
  const match = cleaned.match(/Local:\s+https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/i);
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isInteger(port) && port > 0 ? port : null;
}

export function resolvePreviewPort(args: {
  previewUrl?: string | null;
  reportedPort?: number | null;
  stdoutText?: string | null;
}): number | null {
  return (
    extractNodepodPortFromPreviewUrl(args.previewUrl) ??
    extractPortFromDevServerOutput(args.stdoutText ?? '') ??
    args.reportedPort ??
    null
  );
}

export function looksLikeDevServerReady(text: string): boolean {
  return /ready in /i.test(text) || /Local:\s+https?:\/\//i.test(text) || /VITE\s+v?\d/i.test(text);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PodLike = { proxy: { handleRequest: (...args: any[]) => Promise<{ statusCode?: number; statusMessage?: string }> }; instanceId: string; port: (p: number) => string | null };

/** The subset of `Nodepod` the inspection bridge needs. */
type InspectablePod = PodLike & Pick<Nodepod, 'inspect'>;

function hasInspector(pod: PodLike): pod is InspectablePod {
  return typeof (pod as Partial<InspectablePod>).inspect?.attach === 'function';
}

/* -------------------------------------------------------------------------
 * Normalizers — PreviewInspector types its payloads as `unknown`, so every
 * field is coerced defensively rather than trusted.
 * ---------------------------------------------------------------------- */

function normalizeVisibleText(raw: unknown): string {
  if (typeof raw === 'string') return raw.slice(0, VISIBLE_TEXT_MAX_CHARS);
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === 'string' ? item : String((item as { text?: unknown })?.text ?? '')))
      .filter(Boolean)
      .join('\n')
      .slice(0, VISIBLE_TEXT_MAX_CHARS);
  }
  if (raw && typeof raw === 'object') {
    const text = (raw as { text?: unknown }).text;
    if (typeof text === 'string') return text.slice(0, VISIBLE_TEXT_MAX_CHARS);
  }
  return '';
}

/** The contract wants plain strings, so the level is folded into the text. */
function normalizeConsole(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    if (typeof entry === 'string') return entry;
    const rec = (entry ?? {}) as { level?: unknown; args?: unknown; text?: unknown };
    const text =
      typeof rec.text === 'string'
        ? rec.text
        : Array.isArray(rec.args)
          ? rec.args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ')
          : safeStringify(entry);
    const level = typeof rec.level === 'string' ? rec.level : 'log';
    return `[${level}] ${text}`;
  });
}

function normalizeRuntimeErrors(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const rec = (entry ?? {}) as { message?: unknown; stack?: unknown };
    if (typeof rec.message === 'string') {
      return typeof rec.stack === 'string' ? `${rec.message}\n${rec.stack}` : rec.message;
    }
    return safeStringify(entry);
  });
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

interface DomNodeLike {
  tag?: unknown;
  id?: unknown;
  class?: unknown;
  role?: unknown;
  text?: unknown;
  children?: unknown;
}

/**
 * Flatten the inspector's DOM tree into the list of node records the contract
 * expects, keeping only the attributes a model needs to pick a selector.
 */
function normalizeDomSummary(raw: unknown): DomSummaryNode[] {
  const nodes: DomSummaryNode[] = [];

  const walk = (node: unknown, depth: number) => {
    if (nodes.length >= DOM_SUMMARY_MAX_NODES || depth > DOM_SUMMARY_MAX_DEPTH) return;
    if (!node || typeof node !== 'object') return;
    const rec = node as DomNodeLike;
    const tag = typeof rec.tag === 'string' ? rec.tag : null;

    if (tag) {
      const entry: DomSummaryNode = { tag, depth };
      if (typeof rec.id === 'string' && rec.id) entry.id = rec.id;
      if (typeof rec.class === 'string' && rec.class) entry.class = rec.class;
      if (typeof rec.role === 'string' && rec.role) entry.role = rec.role;
      const text = typeof rec.text === 'string' ? rec.text.trim() : '';
      if (text) entry.text = text.slice(0, NODE_TEXT_MAX_CHARS);
      nodes.push(entry);
    }

    if (Array.isArray(rec.children)) {
      for (const child of rec.children) walk(child, tag ? depth + 1 : depth);
    }
  };

  walk(Array.isArray(raw) ? { children: raw } : raw, 0);
  return nodes;
}

export async function waitUntilDirectServerReady(
  pod: PodLike,
  port: number,
  isStale: () => boolean,
): Promise<boolean> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (isStale()) return false;
    try {
      const res = await pod.proxy.handleRequest(pod.instanceId, port, 'GET', '/', { accept: 'text/html,*/*' });
      log('direct-probe', { attempt, statusCode: res.statusCode, statusMessage: res.statusMessage });
      if (res.statusCode && res.statusCode !== 503) return true;
    } catch (err) {
      log('direct-probe:error', { attempt, error: err instanceof Error ? err.message : String(err) });
    }
    await new Promise((r) => window.setTimeout(r, 500));
  }
  return false;
}

export async function waitUntilPreviewReachable(
  url: string,
  isStale: () => boolean,
  maxAttempts = 60,
): Promise<{ ok: boolean; lastStatus: number | null; bodyHint: string | null }> {
  let lastStatus: number | null = null;
  let bodyHint: string | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (isStale()) return { ok: false, lastStatus, bodyHint };
    try {
      const res = await fetch(url, { cache: 'no-store', redirect: 'follow' });
      lastStatus = res.status;
      if (res.status !== 503) return { ok: true, lastStatus, bodyHint };
      try {
        const text = await res.text();
        bodyHint = text.includes('Powered by Nodepod')
          ? text.includes('still initializing')
            ? 'nodepod-sw-initializing'
            : text.includes('no longer connected')
              ? 'nodepod-sw-disconnected'
              : 'nodepod-sw-503'
          : 'non-nodepod-503';
      } catch {
        bodyHint = '503-body-unreadable';
      }
      log('sw-probe', { attempt, lastStatus, bodyHint });
    } catch {
      // Transient network / SW race — retry.
    }
    await new Promise((r) => window.setTimeout(r, 500));
  }
  return { ok: false, lastStatus, bodyHint };
}

export class PreviewController {
  private _previewUrl: string | null = null;
  private _port: number | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private attachedPort: number | null = null;
  private inspectorEnabled = false;

  get previewUrl(): string | null {
    return this._previewUrl;
  }

  get port(): number | null {
    return this._port;
  }

  get hasIframe(): boolean {
    return this.iframe !== null;
  }

  setPreview(url: string, port: number): void {
    this._previewUrl = url;
    this._port = port;
  }

  reset(): void {
    this._previewUrl = null;
    this._port = null;
  }

  async probeAndPromote(
    pod: PodLike,
    url: string,
    port: number,
    isStale: () => boolean,
  ): Promise<{ ok: boolean; error?: string }> {
    const probePort = resolvePreviewPort({ previewUrl: url, reportedPort: port }) ?? port;
    log('probe:start', { url, port: probePort });

    const directOk = await waitUntilDirectServerReady(pod, probePort, isStale);
    if (isStale()) return { ok: false };
    if (!directOk) {
      return { ok: false, error: 'Dev server started but did not answer HTTP requests inside Nodepod.' };
    }

    const sw = await waitUntilPreviewReachable(url, isStale);
    if (isStale()) return { ok: false };
    log('probe:sw', sw);

    if (!sw.ok) {
      const isSwTransient = sw.bodyHint === 'nodepod-sw-initializing' || sw.bodyHint === 'nodepod-sw-disconnected';
      if (isSwTransient) {
        log('probe:sw-retry', { bodyHint: sw.bodyHint });
        await new Promise((r) => window.setTimeout(r, 1_000));
        const sw2 = await waitUntilPreviewReachable(url, isStale, 40);
        if (isStale()) return { ok: false };
        if (!sw2.ok) {
          const msg =
            sw2.bodyHint === 'nodepod-sw-initializing' || sw2.bodyHint === 'nodepod-sw-disconnected'
              ? 'Nodepod service worker cannot reach this preview (503). Hard-refresh the page (Ctrl+Shift+R) so /__sw__.js reconnects.'
              : `Preview URL stayed unreachable (HTTP ${sw2.lastStatus ?? '???'}).`;
          return { ok: false, error: msg };
        }
      } else {
        return { ok: false, error: `Preview URL stayed unreachable (HTTP ${sw.lastStatus ?? '???'}).` };
      }
    }

    this._previewUrl = url;
    this._port = probePort;
    log('probe:ready', { previewUrl: url });
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Inspection bridge (Nodepod PreviewInspector)
  // ---------------------------------------------------------------------------

  /**
   * Register the live preview iframe so `preview_inspect` / `preview_action`
   * can reach the running app's DOM. Safe to call repeatedly.
   */
  async attachIframe(pod: PodLike, iframe: HTMLIFrameElement): Promise<void> {
    const port = this._port ?? PREVIEW_PORTS[0];
    if (this.iframe === iframe && this.attachedPort === port) return;

    this.detachIframe(pod);
    this.iframe = iframe;

    if (!hasInspector(pod)) {
      log('inspect:attach-skipped', { reason: 'pod-has-no-inspector' });
      return;
    }
    try {
      if (!this.inspectorEnabled) {
        await pod.inspect.enable();
        this.inspectorEnabled = true;
      }
      pod.inspect.attach({ port, iframe });
      this.attachedPort = port;
      log('inspect:attached', { port });
    } catch (err) {
      // Inspection is best-effort: a failure must not break the preview itself.
      log('inspect:attach-error', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  detachIframe(pod?: PodLike): void {
    if (pod && hasInspector(pod) && this.attachedPort !== null) {
      try {
        pod.inspect.detach(this.attachedPort);
      } catch {
        // Already detached or the pod is gone.
      }
    }
    this.iframe = null;
    this.attachedPort = null;
  }

  /**
   * `preview_inspect` payload. Falls back to an HTTP health probe when no
   * iframe is attached, so the tool still returns the contract shape instead
   * of failing.
   */
  async inspectPreview(pod: PodLike, port?: number): Promise<PreviewInspectResult> {
    const inspectPort = port ?? this.attachedPort ?? this._port ?? PREVIEW_PORTS[0];
    const url = this._previewUrl ?? pod.port(inspectPort) ?? '';
    const base: PreviewInspectResult = {
      url,
      title: this.readIframeTitle(),
      visibleText: '',
      domSummary: [],
      console: [],
      runtimeErrors: [],
      screenshotArtifactId: null,
      capabilities: { screenshot: false, interaction: this.iframe !== null },
    };

    if (!this.iframe || !hasInspector(pod) || this.attachedPort === null) {
      const healthy = await this.probeHealth(pod, inspectPort);
      base.runtimeErrors = healthy
        ? []
        : ['Preview is not reachable; no inspection bridge attached.'];
      return base;
    }

    const target = { port: this.attachedPort, timeout: 5_000 };
    const [snapshot, dom] = await Promise.all([
      this.safeInspect(() =>
        pod.inspect.snapshot({ ...target, include: ['text', 'console', 'errors'] }),
      ),
      this.safeInspect(() =>
        pod.inspect.dom({
          ...target,
          maxDepth: DOM_SUMMARY_MAX_DEPTH,
          maxNodes: DOM_SUMMARY_MAX_NODES,
        }),
      ),
    ]);

    const snap = (snapshot ?? {}) as { text?: unknown; console?: unknown; errors?: unknown };
    base.visibleText = normalizeVisibleText(snap.text);
    base.console = normalizeConsole(snap.console);
    base.runtimeErrors = normalizeRuntimeErrors(snap.errors);
    base.domSummary = normalizeDomSummary(dom);
    return base;
  }

  /**
   * `preview_action`. Interaction goes through `iframe.contentDocument` — the
   * preview is served same-origin via the Nodepod service worker, and
   * `PreviewInspector` is read-only.
   */
  async performAction(
    action: PreviewActionName,
    opts: { selector?: string; value?: string; x?: number; y?: number } = {},
  ): Promise<PreviewActionResult> {
    const iframe = this.iframe;
    if (!iframe) {
      throw new ToolError(
        RuntimeErrorCodes.UNSUPPORTED_CAPABILITY,
        'No preview iframe is attached; open the preview panel to interact with the app.',
        { requiredCapability: 'previewInteraction', action },
      );
    }

    if (action === 'reload') {
      // Re-assigning src forces a fresh load even when the URL is unchanged.
      iframe.src = iframe.src;
      return { ok: true, action };
    }

    const doc = this.requireDocument(iframe, action);

    if (action === 'scroll') {
      const target = opts.selector ? this.requireElement(doc, opts.selector, action) : null;
      if (target) {
        target.scrollIntoView({ block: 'center' });
      } else {
        iframe.contentWindow?.scrollTo(opts.x ?? 0, opts.y ?? 0);
      }
      return { ok: true, action };
    }

    if (!opts.selector) {
      throw new ToolError(
        RuntimeErrorCodes.INVALID_PARAMS,
        `selector is required for preview_action "${action}"`,
        { action },
      );
    }
    const element = this.requireElement(doc, opts.selector, action);

    switch (action) {
      case 'click':
        (element as HTMLElement).click();
        break;

      case 'input': {
        const field = element as HTMLInputElement | HTMLTextAreaElement;
        this.setNativeValue(field, opts.value ?? '');
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }

      case 'select': {
        const select = element as HTMLSelectElement;
        select.value = opts.value ?? '';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }

      case 'press_key': {
        const key = opts.value ?? 'Enter';
        const init = { key, bubbles: true, cancelable: true };
        (element as HTMLElement).focus?.();
        element.dispatchEvent(new KeyboardEvent('keydown', init));
        element.dispatchEvent(new KeyboardEvent('keyup', init));
        break;
      }
    }

    return { ok: true, action };
  }

  private setNativeValue(
    field: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ): void {
    // React installs a value setter on the instance; bypass it so the
    // controlled-component tracker sees a real change.
    const proto = Object.getPrototypeOf(field) as object;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(field, value);
    else field.value = value;
  }

  private requireDocument(
    iframe: HTMLIFrameElement,
    action: PreviewActionName,
  ): Document {
    let doc: Document | null = null;
    try {
      doc = iframe.contentDocument;
    } catch {
      doc = null;
    }
    if (!doc) {
      throw new ToolError(
        RuntimeErrorCodes.UNSUPPORTED_CAPABILITY,
        'Preview document is not reachable (cross-origin or not yet loaded).',
        { requiredCapability: 'previewInteraction', action },
      );
    }
    return doc;
  }

  private requireElement(
    doc: Document,
    selector: string,
    action: PreviewActionName,
  ): Element {
    let element: Element | null;
    try {
      element = doc.querySelector(selector);
    } catch {
      throw new ToolError(
        RuntimeErrorCodes.INVALID_PARAMS,
        `Invalid selector: ${selector}`,
        { selector, action },
      );
    }
    if (!element) {
      throw new ToolError(
        RuntimeErrorCodes.INVALID_PARAMS,
        `No element matches selector: ${selector}`,
        { selector, action },
      );
    }
    return element;
  }

  private readIframeTitle(): string {
    try {
      return this.iframe?.contentDocument?.title ?? '';
    } catch {
      return '';
    }
  }

  private async safeInspect(
    call: () => Promise<{ data: unknown }>,
  ): Promise<unknown> {
    try {
      return (await call()).data;
    } catch (err) {
      log('inspect:error', { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  private async probeHealth(pod: PodLike, port: number): Promise<boolean> {
    try {
      const res = await pod.proxy.handleRequest(pod.instanceId, port, 'GET', '/', {
        accept: 'text/html,*/*',
      });
      return (res.statusCode ?? 0) > 0 && (res.statusCode ?? 0) < 500;
    } catch {
      return false;
    }
  }
}
