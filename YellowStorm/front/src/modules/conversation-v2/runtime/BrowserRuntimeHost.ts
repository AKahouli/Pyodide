import { conversationV2Api } from '../api';
import { BrowserRuntimeClient } from './BrowserRuntimeClient';
import { RevisionHydrator, type VfsFiles } from './RevisionHydrator';
import { NodepodRuntimeAdapter, invalidateSession } from './NodepodRuntimeAdapter';
import { PreviewController } from './PreviewController';
import { dispatchTool, ToolError } from './RuntimeToolHandlers';
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

  private sessionId: string | null = null;
  private ticket: RuntimeTicketResponse | null = null;
  private revisionId = 'rev_0';
  private _status: RuntimeHostStatus = 'idle';
  private _error: string | null = null;
  private _destroyed = false;
  private reconnectAttempts = 0;
  private listeners = new Set<HostStateListener>();

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
   */
  async start(sessionId: string, existingCephPath?: string | null, existingFilesTree?: unknown | null): Promise<void> {
    if (this._destroyed) return;
    this.sessionId = sessionId;
    this.reconnectAttempts = 0;

    try {
      // 1. Get ticket
      this.setStatus('connecting');
      console.log(LOG, 'requesting ticket', { sessionId });
      this.ticket = await conversationV2Api.createRuntimeTicket(sessionId);
      this.revisionId = this.ticket.revisionId;

      // 2. Connect socket
      await this.client.connect(this.ticket.ticket);
      if (this._destroyed) return;

      // 3. Wire event handlers
      this.wireClientEvents();

      // 4. Hydrate files
      this.setStatus('hydrating');
      let files: VfsFiles;
      if (existingCephPath && existingFilesTree) {
        files = await this.hydrator.hydrateFromCeph(
          sessionId,
          existingCephPath as string,
          existingFilesTree as import('../types').FilesTreeNode,
        );
      } else {
        files = this.hydrator.hydrateStarter();
      }
      if (this._destroyed) return;

      // 5. Boot Nodepod
      await this.adapter.boot(files, sessionId, this.revisionId);
      if (this._destroyed) return;

      // 6. Install deps
      this.setStatus('installing');
      await this.adapter.installDeps((phase, msg) => {
        console.log(LOG, 'install progress', { phase, msg });
      });
      if (this._destroyed) return;

      // 7. Start dev server
      this.setStatus('starting');
      await this.adapter.startDevServer(this.previewCtrl, () => this._destroyed);
      if (this._destroyed) return;

      // 8. Register
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

      // 9. Start heartbeat
      this.client.startHeartbeat(this.ticket.workspaceId, () => this.revisionId);

      this.setStatus('ready');
      this.reconnectAttempts = 0;
      console.log(LOG, 'ready', { previewUrl: this.previewCtrl.previewUrl });
    } catch (err) {
      if (this._destroyed) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(LOG, 'start failed', msg);
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

  private async handleToolInvoke(payload: ToolInvokePayload): Promise<void> {
    const { toolCallId, tool, arguments: args } = payload;
    console.log(LOG, 'tool.invoke', { toolCallId, tool });

    try {
      const result = await dispatchTool(tool, args, this.adapter, this.previewCtrl);
      this.client.emitToolCompleted({ toolCallId, result });
    } catch (err) {
      if (err instanceof ToolError) {
        this.client.emitToolFailed({
          toolCallId,
          error: { code: err.code, message: err.message, data: err.data },
        });
      } else {
        this.client.emitToolFailed({
          toolCallId,
          error: {
            code: RuntimeErrorCodes.INTERNAL_ERROR,
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  }

  private async handleRehydrate(payload: RuntimeRehydratePayload): Promise<void> {
    console.log(LOG, 'rehydrate', payload);
    // For now, if the revision drifted, we need new files from Ceph.
    // In the MVP this is a placeholder — the full rehydration flow requires
    // the backend to provide the new files via Ceph or a revision endpoint.
    this.revisionId = payload.expectedRevisionId;
    this.emit();
  }

  private async tryReconnect(): Promise<void> {
    if (this._destroyed || !this.sessionId) return;
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
    this.previewCtrl.reset();
    if (this.sessionId) invalidateSession(this.sessionId);
    this.sessionId = null;
    this.ticket = null;
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
