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

      // 8. Start dev server
      this.setStatus('starting');
      await this.adapter.startDevServer(this.previewCtrl, () => this._destroyed);
      if (this._destroyed) return;
      this.flushPendingIframe();

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
      await this.adapter.startDevServer(this.previewCtrl, () => this._destroyed);
      if (this._destroyed) return;
      this.flushPendingIframe();

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
      onProgress: (progress) => {
        if (this._destroyed) return;
        this.client.emitToolProgress({ toolCallId, ...progress });
      },
    };
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
        this.emit();
      }
      if (this._destroyed) return;
      this.client.emitToolCompleted({ toolCallId, result });
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
   * Prefer revision APIs (starter_react_vite_v1 / workspace revision). Fall back
   * to legacy cephPath+filesTree, then bundled starter only as last resort.
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
      try {
        return await this.hydrator.hydrateFromCeph(
          sessionId,
          opts.cephPath,
          opts.filesTree,
        );
      } catch (err) {
        console.warn(
          LOG,
          'cephPath hydration failed, falling back to bundled starter',
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    return this.hydrator.hydrateStarter();
  }

  // ---------------------------------------------------------------------------
  // Preview iframe wiring
  // ---------------------------------------------------------------------------

  /**
   * Register the preview iframe for `preview_inspect` / `preview_action`. The
   * iframe usually mounts before the pod exists, so it is queued until boot.
   */
  attachPreviewIframe(iframe: HTMLIFrameElement): void {
    this.pendingIframe = iframe;
    this.flushPendingIframe();
  }

  detachPreviewIframe(): void {
    this.pendingIframe = null;
    this.previewCtrl.detachIframe(this.adapter.currentPod ?? undefined);
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
    this.destroy();
    this._destroyed = false;
    void this.start(sid);
  }

  destroy(): void {
    this._destroyed = true;
    this.client.disconnect();
    this.previewCtrl.detachIframe(this.adapter.currentPod ?? undefined);
    this.previewCtrl.reset();
    this.pendingIframe = null;
    if (this.sessionId) invalidateSession(this.sessionId);
    this.sessionId = null;
    this.workspaceId = null;
    this.ticket = null;
    this.legacyMode = false;
    this.rehydrating = false;
    this._status = 'idle';
    this._error = null;
    this.listeners.clear();
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
