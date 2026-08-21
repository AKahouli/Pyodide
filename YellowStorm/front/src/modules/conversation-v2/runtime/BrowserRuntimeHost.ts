import { conversationV2Api } from '../api';
import { appRuntimeEnabled } from '../features';
import { useConversationV2Store } from '../store';
import type { FilesTreeNode } from '../types';
import { BrowserRuntimeClient } from './BrowserRuntimeClient';
import { RevisionHydrator, type VfsFiles } from './RevisionHydrator';
import { NodepodRuntimeAdapter, invalidateSession } from './NodepodRuntimeAdapter';
import { PreviewController } from './PreviewController';
import { dispatchTool, MUTATING_TOOLS, type ToolContext } from './RuntimeToolHandlers';
import { ToolError } from './ToolError';
import { WorkspaceRevisionStore } from './WorkspaceRevisionStore';
import { NODEPOD_CAPABILITIES } from './RuntimeCapabilities';
import {
  RuntimeErrorCodes,
  type RuntimeHostStatus,
  type ToolInvokePayload,
  type RuntimeRehydratePayload,
  type RuntimeTicketResponse,
} from './runtime.types';

const LOG = '[BrowserRuntimeHost]';
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 2_000;
const HIDDEN_IFRAME_LOAD_MS = 4_000;
const HIDDEN_IFRAME_STYLE =
  'position:fixed;width:640px;height:480px;opacity:0;pointer-events:none;left:-10000px;top:0;border:0';
const HIDDEN_IFRAME_SANDBOX =
  'allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts';

export type HostStateListener = (state: HostState) => void;

export interface HostState {
  status: RuntimeHostStatus;
  previewUrl: string | null;
  error: string | null;
  files: VfsFiles | null;
  revisionId: string;
}

/**
 * Long-lived orchestrator for one workspace (= conversation-v2 session).
 * Not a React hook — consumed via a thin hook or effect.
 */
export class BrowserRuntimeHost {
  private client = new BrowserRuntimeClient();
  private hydrator = new RevisionHydrator();
  private adapter = new NodepodRuntimeAdapter();
  private previewCtrl = new PreviewController();
  private revisions = new WorkspaceRevisionStore();

  private sessionId: string | null = null;
  private workspaceId: string | null = null;
  private ticket: RuntimeTicketResponse | null = null;
  private revisionId = 'rev_0';
  private _status: RuntimeHostStatus = 'idle';
  private _error: string | null = null;
  private _destroyed = false;
  private reconnectAttempts = 0;
  private listeners = new Set<HostStateListener>();
  private pendingIframe: HTMLIFrameElement | null = null;
  private appDataProxyInstalled = false;

  private buildAppDataViteEnv(): Record<string, string> | undefined {
    const env = this.ticket?.appDataRuntimeEnv;
    if (!env) return undefined;
    return {
      VITE_YM_APP_DATA_URL: env.publicUrl,
      VITE_YM_APP_DATA_ID: env.appDataId,
      VITE_YM_APP_DATA_ENV: env.environment,
      VITE_YM_APP_DATA_PROXY: 'true',
    };
  }

  private appDataBroadcast: BroadcastChannel | null = null;

  /**
   * Proxy fetch requests from the generated app — bypasses the Nodepod SW
   * which strips POST bodies when forwarding requests.
   *
   * Two transports:
   *  - `window.message` — used when the app runs in the preview iframe
   *  - `BroadcastChannel('ym-app-data-proxy')` — used when the user opens
   *    the preview in a new tab (window.parent === window)
   */
  private setupAppDataFetchProxy(): void {
    if (this.appDataProxyInstalled) return;
    this.appDataProxyInstalled = true;

    const handleProxyRequest = (
      data: Record<string, unknown>,
      reply: (response: Record<string, unknown>) => void,
    ) => {
      const { id, url, method, headers, body } = data;
      if (typeof url !== 'string' || !url.includes('/app-data/public/')) return;

      fetch(url, {
        method: (method as string) || 'GET',
        headers: (headers as HeadersInit) || undefined,
        body: (body as BodyInit) || undefined,
      })
        .then(async (res) => {
          const responseBody = await res.text();
          const responseHeaders: Record<string, string> = {};
          res.headers.forEach((v, k) => { responseHeaders[k] = v; });
          reply({ type: 'ym-app-data-response', id, status: res.status, headers: responseHeaders, body: responseBody });
        })
        .catch((err) => {
          reply({ type: 'ym-app-data-response', id, error: err instanceof Error ? err.message : String(err) });
        });
    };

    // Transport 1: postMessage from preview iframe
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.data?.type !== 'ym-app-data-fetch') return;
      const source = event.source as WindowProxy | null;
      if (!source) return;
      handleProxyRequest(event.data, (response) => source.postMessage(response, '*'));
    });

    // Transport 2: BroadcastChannel for new-tab previews
    try {
      this.appDataBroadcast = new BroadcastChannel('ym-app-data-proxy');
      this.appDataBroadcast.onmessage = (event: MessageEvent) => {
        if (event.data?.type !== 'ym-app-data-fetch') return;
        handleProxyRequest(event.data, (response) => this.appDataBroadcast?.postMessage(response));
      };
    } catch {
      // BroadcastChannel not supported — new-tab proxy unavailable
    }
  }

  /** Off-screen iframe so preview_inspect works when the user panel is closed. */
  private hiddenIframe: HTMLIFrameElement | null = null;

  /** Serializes mutating tools; the backend also serializes, this is depth. */
  private mutationLock: Promise<unknown> = Promise.resolve();
  private rehydrating = false;
  /** When true, Nodepod runs without Socket.IO (flag off / ticket failure + cephPath). */
  private legacyMode = false;

  get state(): HostState {
    return {
      status: this._status,
      previewUrl: this.previewCtrl.previewUrl,
      error: this._error,
      files: this.adapter.files,
      revisionId: this.revisionId,
    };
  }

  subscribe(listener: HostStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const s = this.state;
    for (const l of this.listeners) {
      try { l(s); } catch { /* noop */ }
    }
  }

  private setStatus(status: RuntimeHostStatus, error?: string): void {
    this._status = status;
    this._error = error ?? null;
    this.emit();
  }

  /**
   * Full lifecycle: ticket -> connect -> hydrate -> boot -> install -> dev server -> register -> heartbeat.
   *
   * Legacy path (VITE_APP_RUNTIME_ENABLED=false, or ticket API failure with an
   * existing cephPath): boot Nodepod only — no Socket.IO, no runtime.register.
   * Ticket / mcpToken never enter HostState, the Zustand store, or the preview iframe.
   */
  async start(
    sessionId: string,
    existingCephPath?: string | null,
    existingFilesTree?: unknown | null,
  ): Promise<void> {
    if (this._destroyed) return;
    if (this._status !== 'idle') return;
    this.sessionId = sessionId;
    this.reconnectAttempts = 0;
    this.legacyMode = false;
    this.setupAppDataFetchProxy();

    const cephPath = existingCephPath ?? null;
    const filesTree = (existingFilesTree as FilesTreeNode | null) ?? null;
    const canLegacy = !!cephPath && !!filesTree;

    // Flag off: legacy only when we have Ceph sources; otherwise stay idle.
    if (!appRuntimeEnabled) {
      if (canLegacy) {
        await this.startLegacy(sessionId, cephPath!, filesTree!);
      }
      return;
    }

    try {
      // 1. Get ticket (one-shot; kept private on this.host — never in HostState)
      this.setStatus('connecting');
      console.log(LOG, 'requesting ticket', { sessionId });
      this.ticket = await conversationV2Api.createRuntimeTicket(sessionId);
      this.revisionId = this.ticket.revisionId;
      this.workspaceId = this.ticket.workspaceId;

      // 2. Connect socket — ticket string is handed to the client then discarded from React surface
      await this.client.connect(this.ticket.ticket);
      if (this._destroyed) return;

      // 3. Wire event handlers
      this.wireClientEvents();

      // 4. Hydrate from ticket revision (Ceph starter / workspace), then legacy fallbacks
      this.setStatus('hydrating');
      const files = await this.resolveHydrationFiles(sessionId, {
        revisionId: this.revisionId,
        cephPath: canLegacy ? cephPath : null,
        filesTree: canLegacy ? filesTree : null,
      });
      if (this._destroyed) return;

      // 5. Boot Nodepod
      await this.adapter.boot(files, sessionId, this.revisionId);
      if (this._destroyed) return;

      // 6. Seed the local revision history at the backend's revision
      this.revisions.seed(await this.adapter.shaManifest(), this.revisionId);

      // 7. Install deps (skipped when the manifest fingerprint is unchanged)
      this.setStatus('installing');
      await this.adapter.ensureDeps({
        onProgress: (phase, msg) => console.log(LOG, 'install progress', { phase, msg }),
      });
      if (this._destroyed) return;

      // 8. Start dev server (refresh ticket so App Data env is present if already provisioned)
      this.setStatus('starting');
      const viteEnv = await this.refreshAppDataViteEnv();
      await this.adapter.startDevServer(this.previewCtrl, () => this._destroyed, undefined, viteEnv);
      if (this._destroyed) return;
      this.flushPendingIframe();
      await this.ensureHiddenPreviewIframe();

      // 9. Register
      this.setStatus('registering');
      const ack = await this.client.register({
        runtimeSessionId: this.ticket.runtimeSessionId,
        workspaceId: this.ticket.workspaceId,
        revisionId: this.revisionId,
        capabilities: NODEPOD_CAPABILITIES,
      });
      if (!ack.ok) {
        this.setStatus('error', `Registration failed: ${ack.error ?? 'unknown'}`);
        return;
      }

      // 10. Start heartbeat
      this.client.startHeartbeat(this.ticket.workspaceId, () => this.revisionId);

      this.setStatus('ready');
      this.reconnectAttempts = 0;
      console.log(LOG, 'ready', { previewUrl: this.previewCtrl.previewUrl });
    } catch (err) {
      if (this._destroyed) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(LOG, 'start failed', msg);
      // Ticket / connect failure with existing Ceph sources → legacy Nodepod boot.
      if (canLegacy) {
        console.warn(LOG, 'falling back to legacy Nodepod boot', { reason: msg });
        await this.startLegacy(sessionId, cephPath!, filesTree!);
        return;
      }
      this.setStatus('error', msg);
    }
  }

  /**
   * Rollback path for already-generated apps: hydrate from Ceph and run Nodepod
   * without a runtime ticket / Socket.IO. No MCP tool dispatch in this mode.
   */
  private async startLegacy(
    sessionId: string,
    cephPath: string,
    filesTree: FilesTreeNode,
  ): Promise<void> {
    this.legacyMode = true;
    this.ticket = null;
    try {
      this.setStatus('hydrating');
      const files = await this.hydrator.hydrateFromCeph(sessionId, cephPath, filesTree);
      if (this._destroyed) return;

      this.revisionId = 'rev_legacy';
      await this.adapter.boot(files, sessionId, this.revisionId);
      if (this._destroyed) return;

      this.revisions.seed(await this.adapter.shaManifest(), this.revisionId);

      this.setStatus('installing');
      await this.adapter.ensureDeps({
        onProgress: (phase, msg) => console.log(LOG, 'legacy install', { phase, msg }),
      });
      if (this._destroyed) return;

      this.setStatus('starting');
      await this.adapter.startDevServer(this.previewCtrl, () => this._destroyed, undefined, this.buildAppDataViteEnv());
      if (this._destroyed) return;
      this.flushPendingIframe();
      await this.ensureHiddenPreviewIframe();

      this.setStatus('ready');
      console.log(LOG, 'legacy ready', { previewUrl: this.previewCtrl.previewUrl });
    } catch (err) {
      if (this._destroyed) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(LOG, 'legacy start failed', msg);
      this.setStatus('error', msg);
    }
  }

  private wireClientEvents(): void {
    this.client.onToolInvoke((payload: ToolInvokePayload) => {
      void this.handleToolInvoke(payload);
    });

    this.client.onRehydrate((payload: RuntimeRehydratePayload) => {
      void this.handleRehydrate(payload);
    });

    this.client.onDisconnect((reason: string) => {
      if (this._destroyed) return;
      console.warn(LOG, 'disconnected', reason);
      this.setStatus('disconnected');
      void this.tryReconnect();
    });
  }

  /** Chain `task` onto the mutation lock so mutating tools never interleave. */
  private withMutationLock<T>(task: () => Promise<T>): Promise<T> {
    const run = this.mutationLock.then(task, task);
    // Swallow rejections on the chain itself; the caller still sees them.
    this.mutationLock = run.catch(() => undefined);
    return run;
  }

  private buildToolContext(toolCallId: string): ToolContext {
    return {
      adapter: this.adapter,
      previewCtrl: this.previewCtrl,
      revisions: this.revisions,
      workspaceId: this.workspaceId ?? this.sessionId ?? 'unknown',
      sessionId: this.sessionId ?? this.workspaceId ?? 'unknown',
      toolCallId,
      onProgress: (progress) => {
        if (this._destroyed) return;
        this.client.emitToolProgress({ toolCallId, ...progress });
      },
      ensurePreviewAttached: () => this.ensureHiddenPreviewIframe(),
      openPreviewPanel: () => {
        useConversationV2Store.getState().setRightPanelView('preview');
      },
      resolveAppDataViteEnv: () => this.refreshAppDataViteEnv(),
    };
  }

  /** Re-issue runtime ticket metadata so VITE_YM_* reflects a newly provisioned App Data store. */
  private async refreshAppDataViteEnv(): Promise<Record<string, string> | undefined> {
    if (this.sessionId && appRuntimeEnabled) {
      try {
        const fresh = await conversationV2Api.createRuntimeTicket(this.sessionId);
        if (fresh.appDataRuntimeEnv) {
          this.ticket = this.ticket
            ? { ...this.ticket, appDataRuntimeEnv: fresh.appDataRuntimeEnv }
            : fresh;
        }
      } catch (err) {
        console.warn(
          LOG,
          'refreshAppDataViteEnv failed',
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    return this.buildAppDataViteEnv();
  }

  /** Restart Vite after App Data provision so preview receives VITE_YM_* env. */
  async restartDevServerForAppData(): Promise<void> {
    if (this._destroyed || this.legacyMode) return;
    if (this._status !== 'ready' && this._status !== 'starting') return;
    const viteEnv = await this.refreshAppDataViteEnv();
    if (!viteEnv) return;
    console.log(LOG, 'restarting dev server for App Data env');
    await this.adapter.startDevServer(this.previewCtrl, () => this._destroyed, undefined, viteEnv);
    await this.refreshPreview();
  }

  private async handleToolInvoke(payload: ToolInvokePayload): Promise<void> {
    const { toolCallId, tool, arguments: args } = payload;
    console.log(LOG, 'tool.invoke', { toolCallId, tool });

    const isMutation = MUTATING_TOOLS.has(tool);
    try {
      if (isMutation && this.rehydrating) {
        throw new ToolError(
          RuntimeErrorCodes.REVISION_CONFLICT,
          'Workspace is rehydrating; retry once the runtime re-registers.',
          { tool, revisionId: this.revisionId },
        );
      }

      const ctx = this.buildToolContext(toolCallId);
      const run = () => dispatchTool(tool, args, ctx);
      const result = isMutation ? await this.withMutationLock(run) : await run();

      if (isMutation) {
        this.revisionId = this.revisions.latestRevisionId;
        await this.refreshSourceFiles();
        if (this.ticket) {
          const ack = await this.client.register({
            runtimeSessionId: this.ticket.runtimeSessionId,
            workspaceId: this.ticket.workspaceId,
            revisionId: this.revisionId,
            capabilities: NODEPOD_CAPABILITIES,
          });
          if (!ack.ok) {
            throw new ToolError(
              RuntimeErrorCodes.INTERNAL_ERROR,
              `Re-registration failed after mutation: ${ack.error ?? 'unknown'}`,
              { revisionId: this.revisionId, tool },
            );
          }
        }
      }
      if (this._destroyed) return;
      this.client.emitToolCompleted({ toolCallId, result });
      if (tool === 'finalize') {
        await this.refreshPreview();
      }
      this.emit();
    } catch (err) {
      if (this._destroyed) return;
      const error =
        err instanceof ToolError
          ? { code: err.code, message: err.message, data: err.data }
          : {
              code: RuntimeErrorCodes.INTERNAL_ERROR,
              message: err instanceof Error ? err.message : String(err),
            };
      this.client.emitToolFailed({ toolCallId, error });
    }
  }

  /**
   * The backend saw our revision drift. Re-pull the workspace sources, write
   * them into the live pod, reseed the revision history at the expected id,
   * then re-emit `runtime.register` — the backend has no `runtime.ready`
   * event, so re-registration is the readiness signal.
   */
  /** Refresh the split-view source cache from the live Nodepod VFS. */
  async refreshSourceFiles(): Promise<void> {
    if (this._destroyed || !this.adapter.currentPod) return;
    try {
      await this.adapter.refreshFileCache();
      this.emit();
    } catch (err) {
      console.warn(
        LOG,
        'refreshSourceFiles failed',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * Align the live pod + source cache with a persisted workspace revision (e.g.
   * after backend finalize pushes application_component with revision_id).
   */
  async syncRevisionSources(revisionId: string): Promise<void> {
    if (this._destroyed || !this.sessionId || !revisionId) return;
    const pod = this.adapter.currentPod;
    if (!pod) return;

    try {
      const appComp = useConversationV2Store.getState().applicationComponent;
      const files = await this.resolveHydrationFiles(this.sessionId, {
        revisionId,
        cephPath: appComp?.cephPath ?? null,
        filesTree: (appComp?.filesTree as FilesTreeNode | undefined) ?? null,
      });
      if (this._destroyed) return;

      await this.hydrator.syncToRevision(pod, files);
      this.revisionId = revisionId;
      this.revisions.seed(await this.adapter.shaManifest(), revisionId);
      await this.adapter.refreshFileCache();

      this.setStatus('starting');
      const viteEnv = await this.refreshAppDataViteEnv();
      await this.adapter.startDevServer(this.previewCtrl, () => this._destroyed, undefined, viteEnv);
      if (this._destroyed) return;

      await this.refreshPreview();
      this.setStatus('ready');
      console.log(LOG, 'syncRevisionSources ok', { revisionId });
    } catch (err) {
      console.warn(
        LOG,
        'syncRevisionSources failed, falling back to VFS refresh',
        err instanceof Error ? err.message : String(err),
      );
      await this.refreshSourceFiles();
      await this.refreshPreview();
      if (!this._destroyed && this._status === 'starting') {
        this.setStatus('ready');
      }
    }
  }

  private async handleRehydrate(payload: RuntimeRehydratePayload): Promise<void> {
    console.log(LOG, 'rehydrate', payload);
    if (this.rehydrating || this._destroyed || !this.sessionId) return;
    this.rehydrating = true;

    try {
      this.setStatus('hydrating');
      const files = await this.resolveHydrationFiles(this.sessionId, {
        revisionId: payload.expectedRevisionId,
        cephPath: useConversationV2Store.getState().applicationComponent?.cephPath ?? null,
        filesTree:
          (useConversationV2Store.getState().applicationComponent?.filesTree as
            | FilesTreeNode
            | undefined) ?? null,
      });
      if (this._destroyed) return;

      const pod = this.adapter.currentPod;
      if (pod) await this.hydrator.syncToRevision(pod, files);

      this.revisionId = payload.expectedRevisionId;
      this.revisions.seed(await this.adapter.shaManifest(), this.revisionId);
      this.adapter.markDepsDirty();

      if (this.ticket) {
        const ack = await this.client.register({
          runtimeSessionId: this.ticket.runtimeSessionId,
          workspaceId: this.ticket.workspaceId,
          revisionId: this.revisionId,
          capabilities: NODEPOD_CAPABILITIES,
        });
        if (!ack.ok) {
          this.setStatus('error', `Re-registration failed: ${ack.error ?? 'unknown'}`);
          return;
        }
      }
      this.setStatus('ready');
    } catch (err) {
      if (this._destroyed) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(LOG, 'rehydrate failed', msg);
      this.setStatus('error', msg);
    } finally {
      this.rehydrating = false;
    }
  }

  /**
   * Hydrate from Ceph revision APIs only. Legacy cephPath is a fallback for
   * already-generated apps; bundled starter files are never used.
   */
  private async resolveHydrationFiles(
    sessionId: string,
    opts: {
      revisionId: string;
      cephPath?: string | null;
      filesTree?: FilesTreeNode | null;
    },
  ): Promise<VfsFiles> {
    try {
      return await this.hydrator.hydrateFromRevision(sessionId, opts.revisionId);
    } catch (err) {
      console.warn(
        LOG,
        'revision hydration failed',
        { revisionId: opts.revisionId },
        err instanceof Error ? err.message : String(err),
      );
    }

    if (opts.cephPath && opts.filesTree) {
      return await this.hydrator.hydrateFromCeph(
        sessionId,
        opts.cephPath,
        opts.filesTree,
      );
    }

    throw new Error(
      `Cannot hydrate workspace from Ceph for revision ${opts.revisionId}. ` +
        'Ensure the starter manifest exists in Ceph and revision APIs are reachable.',
    );
  }

  // ---------------------------------------------------------------------------
  // Preview iframe wiring
  // ---------------------------------------------------------------------------

  /**
   * Register the preview iframe for `preview_inspect` / `preview_action`. The
   * iframe usually mounts before the pod exists, so it is queued until boot.
   */
  attachPreviewIframe(iframe: HTMLIFrameElement): void {
    this.removeHiddenPreviewIframe();
    this.pendingIframe = iframe;
    this.flushPendingIframe();
    this.reloadPreviewIframe(iframe);
  }

  /**
   * Re-probe the Nodepod SW route and reload attached preview iframes so the
   * visible panel matches what finalize / preview_inspect verified.
   */
  async refreshPreview(): Promise<void> {
    if (this._destroyed) return;
    const pod = this.adapter.currentPod;
    const url = this.previewCtrl.previewUrl;
    const port = this.previewCtrl.port;
    if (pod && url && port) {
      console.log(LOG, 'refreshPreview', { url });
      await this.previewCtrl.probeAndPromote(pod, url, port, () => this._destroyed);
    }
    if (this._destroyed) return;
    this.flushPendingIframe();
    if (this.pendingIframe) {
      this.reloadPreviewIframe(this.pendingIframe);
    }
    await this.ensureHiddenPreviewIframe();
    this.emit();
  }

  private reloadPreviewIframe(iframe: HTMLIFrameElement): void {
    const url = this.previewCtrl.previewUrl;
    if (!url) return;
    const current = iframe.src;
    if (!current || current === 'about:blank') {
      iframe.src = url;
      return;
    }
    if (current !== url) {
      iframe.src = url;
      return;
    }
    iframe.src = 'about:blank';
    window.requestAnimationFrame(() => {
      if (this._destroyed || this.previewCtrl.previewUrl !== url) return;
      iframe.src = url;
    });
  }

  detachPreviewIframe(): void {
    this.pendingIframe = null;
    this.previewCtrl.detachIframe(this.adapter.currentPod ?? undefined);
    void this.ensureHiddenPreviewIframe();
  }

  /**
   * Mount an off-screen iframe when the dev server is up but the user has not
   * opened the preview panel — required for `preview_inspect` / `finalize`.
   */
  async ensureHiddenPreviewIframe(): Promise<void> {
    const url = this.previewCtrl.previewUrl;
    const pod = this.adapter.currentPod;
    if (!url || !pod || this._destroyed) return;
    if (this.pendingIframe) {
      this.flushPendingIframe();
      return;
    }

    if (!this.hiddenIframe) {
      this.hiddenIframe = document.createElement('iframe');
      this.hiddenIframe.setAttribute('aria-hidden', 'true');
      this.hiddenIframe.setAttribute('sandbox', HIDDEN_IFRAME_SANDBOX);
      this.hiddenIframe.style.cssText = HIDDEN_IFRAME_STYLE;
      this.hiddenIframe.title = 'YellowMind runtime preview';
      document.body.appendChild(this.hiddenIframe);
    }

    if (this.hiddenIframe.src !== url) {
      await new Promise<void>((resolve) => {
        const iframe = this.hiddenIframe!;
        const timer = window.setTimeout(resolve, HIDDEN_IFRAME_LOAD_MS);
        const done = () => {
          window.clearTimeout(timer);
          iframe.removeEventListener('load', done);
          resolve();
        };
        iframe.addEventListener('load', done, { once: true });
        iframe.src = url;
      });
    }

    await this.previewCtrl.attachIframe(pod, this.hiddenIframe);
    console.log(LOG, 'hidden preview iframe attached', { url });
  }

  private removeHiddenPreviewIframe(): void {
    if (!this.hiddenIframe) return;
    this.previewCtrl.detachIframe(this.adapter.currentPod ?? undefined);
    this.hiddenIframe.remove();
    this.hiddenIframe = null;
  }

  private flushPendingIframe(): void {
    const pod = this.adapter.currentPod;
    if (!pod || !this.pendingIframe) return;
    void this.previewCtrl.attachIframe(pod, this.pendingIframe);
  }

  private async tryReconnect(): Promise<void> {
    if (this._destroyed || !this.sessionId || this.legacyMode) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.setStatus('error', 'Reconnection failed after multiple attempts.');
      return;
    }

    this.reconnectAttempts += 1;
    console.log(LOG, 'reconnecting', { attempt: this.reconnectAttempts });
    await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
    if (this._destroyed) return;

    try {
      this.setStatus('connecting');
      this.ticket = await conversationV2Api.createRuntimeTicket(this.sessionId);
      await this.client.connect(this.ticket.ticket);
      if (this._destroyed) return;

      this.wireClientEvents();

      const ack = await this.client.register({
        runtimeSessionId: this.ticket.runtimeSessionId,
        workspaceId: this.ticket.workspaceId,
        revisionId: this.revisionId,
        capabilities: NODEPOD_CAPABILITIES,
      });
      if (!ack.ok) {
        this.setStatus('error', `Re-registration failed: ${ack.error ?? 'unknown'}`);
        return;
      }

      this.client.startHeartbeat(this.ticket.workspaceId, () => this.revisionId);
      this.setStatus('ready');
      this.reconnectAttempts = 0;
    } catch (err) {
      if (this._destroyed) return;
      console.error(LOG, 'reconnect failed', err instanceof Error ? err.message : String(err));
      void this.tryReconnect();
    }
  }

  retry(): void {
    if (!this.sessionId) return;
    const sid = this.sessionId;
    this.teardownRuntime({ clearListeners: false, clearSession: false });
    this._destroyed = false;
    this.emit();
    void this.start(sid);
  }

  destroy(): void {
    this.teardownRuntime({ clearListeners: true, clearSession: true });
  }

  /**
   * Tear down sockets, preview, and pod state. Retry keeps React subscribers
   * so connecting/ready/error still reach the mounted preview hook.
   */
  private teardownRuntime(options: {
    clearListeners: boolean;
    clearSession: boolean;
  }): void {
    this._destroyed = true;
    this.client.disconnect();
    this.removeHiddenPreviewIframe();
    this.previewCtrl.detachIframe(this.adapter.currentPod ?? undefined);
    this.previewCtrl.reset();
    this.pendingIframe = null;
    if (this.sessionId) invalidateSession(this.sessionId);
    if (options.clearSession) this.sessionId = null;
    this.workspaceId = null;
    this.ticket = null;
    this.legacyMode = false;
    this.rehydrating = false;
    this.reconnectAttempts = 0;
    this.mutationLock = Promise.resolve();
    this.revisionId = 'rev_0';
    this._status = 'idle';
    this._error = null;
    if (options.clearListeners) this.listeners.clear();
  }
}

// ---------------------------------------------------------------------------
// Host registry — one host per session, reusable across component mounts.
// ---------------------------------------------------------------------------

const hostRegistry = new Map<string, BrowserRuntimeHost>();

export function getOrCreateHost(sessionId: string): BrowserRuntimeHost {
  let host = hostRegistry.get(sessionId);
  if (!host) {
    host = new BrowserRuntimeHost();
    hostRegistry.set(sessionId, host);
  }
  return host;
}

export function removeHost(sessionId: string): void {
  const host = hostRegistry.get(sessionId);
  if (host) {
    host.destroy();
    hostRegistry.delete(sessionId);
  }
}

/** Sync split-view sources after SSE application_component (best-effort). */
export function syncHostRevisionSources(sessionId: string, revisionId: string): void {
  const host = hostRegistry.get(sessionId);
  if (!host || !revisionId) return;
  void host.syncRevisionSources(revisionId);
}

/** Re-probe and reload preview iframes when the agent finishes (best-effort). */
export function refreshHostPreview(sessionId: string | null | undefined): void {
  if (!sessionId) return;
  const host = hostRegistry.get(sessionId);
  if (!host) return;
  void host.refreshPreview();
}

const APP_DATA_DEV_SERVER_RESTART_TOOL_MARKERS = [
  'yellowappdata_provision',
  'appdata_provision',
  'app_data_provision',
];

const APP_DATA_TOOL_SUCCESS_STATUSES = new Set(['success', 'completed', 'done', 'ok', 'finished']);

/** Restart Nodepod Vite when App Data provision completes so preview env is injected. */
export function maybeRestartDevServerAfterAppDataTool(
  sessionId: string | null | undefined,
  event: { type: string; function?: string; name?: string; status?: string },
): void {
  if (!sessionId || event.type !== 'tool') return;
  const status = (event.status ?? '').toLowerCase();
  if (status && !APP_DATA_TOOL_SUCCESS_STATUSES.has(status)) return;
  const label = `${event.function ?? ''} ${event.name ?? ''}`.toLowerCase();
  if (!APP_DATA_DEV_SERVER_RESTART_TOOL_MARKERS.some((marker) => label.includes(marker))) return;
  const host = hostRegistry.get(sessionId);
  if (!host) return;
  void host.restartDevServerForAppData();
}
