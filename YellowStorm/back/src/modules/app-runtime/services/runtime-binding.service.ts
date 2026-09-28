import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import {
  CONVERSATION_V2_SESSION_STORE,
  type ConversationV2SessionStore,
} from '@modules/conversation-v2/persistence/conversation-v2-session.store';
import { type RuntimeBindingRecord } from '../persistence/runtime-binding.store';
import { RuntimeRevisionService } from './runtime-revision.service';
import { RuntimeTokenService } from './runtime-token.service';
import { DEFAULT_STARTER_REVISION_ID } from '../constants/starter-revisions';
import { PgRuntimeBindingStore } from '../persistence/pg-runtime-binding.store';

export interface BindRuntimeParams {
  conversationSessionId: string;
  userId: string;
}

/** Flat contract consumed by the APImanus OpenCode gateway. */
export interface BindRuntimeResult {
  bindingId: string;
  workspaceId: string;
  latestRevisionId: string;
  mcpUrl: string;
  mcpToken: string;
  /** Second MCP for persistent App Data (when APP_DATA_MCP_ENABLED). */
  appDataMcpUrl?: string;
}

export interface MarkBrowserActiveParams {
  workspaceId: string;
  browserRuntimeId: string;
  capabilities: Record<string, unknown>;
  lastHeartbeatAt: Date;
}

@Injectable()
export class RuntimeBindingService {
  private readonly logger = new Logger(RuntimeBindingService.name);

  constructor(
    private readonly store: PgRuntimeBindingStore,
    private readonly tokens: RuntimeTokenService,
    private readonly revisions: RuntimeRevisionService,
    private readonly config: ConfigService,
    @Optional()
    @Inject(CONVERSATION_V2_SESSION_STORE)
    private readonly sessions?: ConversationV2SessionStore,
  ) {}

  /**
   * Create or reuse the binding for a conversation session. Re-binding keeps
   * the same `bindingId` and revision but rotates the MCP token, because the
   * gateway overwrites its stored token on every remote bind.
   */
  async bind(params: BindRuntimeParams): Promise<BindRuntimeResult> {
    const { conversationSessionId, userId } = params;
    const { token, hash } = this.tokens.issue();

    // Seed a new binding from the session's template/starter revision so the
    // browser boots on the same revision the session was created with.
    const session = await this.sessions?.findByAiSessionId(conversationSessionId);
    const binding = await this.upsertWithRetry(
      conversationSessionId,
      userId,
      hash,
      session?.starterRevisionId ?? undefined,
    );
    await this.revisions.ensureWorkspaceRevision(
      binding.workspaceId,
      binding.latestRevisionId,
    );

    this.logger.log(
      `App runtime bound bindingId=${binding.bindingId} workspaceId=${binding.workspaceId} userId=${userId} revisionId=${binding.latestRevisionId}`,
    );

    return {
      bindingId: binding.bindingId,
      workspaceId: binding.workspaceId,
      latestRevisionId: binding.latestRevisionId,
      mcpUrl: this.resolveMcpUrl(),
      mcpToken: token,
      appDataMcpUrl: this.resolveAppDataMcpUrl(),
    };
  }

  /**
   * Guarantee a binding exists so the browser can obtain a runtime ticket
   * before APImanus has bound the session. Unlike {@link bind} this leaves
   * `mcpTokenHash` untouched, so it can never invalidate a live MCP token.
   */
  async ensureForSession(
    conversationSessionId: string,
    userId: string,
  ): Promise<RuntimeBindingRecord> {
    const session = await this.sessions?.findByAiSessionId(conversationSessionId);
    const binding = await this.upsertWithRetry(
      conversationSessionId,
      userId,
      null,
      session?.starterRevisionId ?? undefined,
    );
    await this.revisions.ensureWorkspaceRevision(
      binding.workspaceId,
      binding.latestRevisionId,
    );
    return binding;
  }

  findByWorkspaceId(workspaceId: string): Promise<RuntimeBindingRecord | null> {
    return this.store.findByWorkspaceId(workspaceId);
  }

  findByMcpTokenHash(mcpTokenHash: string): Promise<RuntimeBindingRecord | null> {
    return this.store.findByMcpTokenHash(mcpTokenHash);
  }

  async markBrowserActive(params: MarkBrowserActiveParams): Promise<void> {
    await this.store.updateStatus(params.workspaceId, null, 'browser_active', {
      browserRuntimeId: params.browserRuntimeId,
      browserCapabilities: params.capabilities,
      lastHeartbeatAt: params.lastHeartbeatAt,
    });
  }

  async markWaitingForBrowser(workspaceId: string): Promise<void> {
    await this.store.updateStatus(workspaceId, 'browser_active', 'waiting_for_browser');
  }

  async touchHeartbeat(workspaceId: string, at: Date): Promise<void> {
    await this.store.updateHeartbeat(workspaceId, at);
  }

  async updateRevision(workspaceId: string, revisionId: string): Promise<void> {
    await this.store.updateRevision(workspaceId, revisionId);
  }

  private async upsertWithRetry(
    conversationSessionId: string,
    userId: string,
    mcpTokenHash: string | null,
    starterRevisionId?: string,
  ): Promise<RuntimeBindingRecord> {
    let binding = await this.upsert(conversationSessionId, userId, mcpTokenHash, starterRevisionId);
    if (!binding) {
      binding = await this.upsert(conversationSessionId, userId, mcpTokenHash, starterRevisionId);
    }

    if (!binding) {
      throw new Error(
        `Failed to bind app runtime for session ${conversationSessionId}`,
      );
    }

    return binding;
  }

  /** Public MCP URL returned to APImanus for OpenCode remote MCP config. */
  private resolveMcpUrl(): string {
    const explicit = this.config.get<string>('appRuntime.mcpUrl', '').trim();
    if (explicit) return explicit;
    const publicBase = this.config.get<string>('appRuntime.publicBaseUrl', '').replace(/\/$/, '');
    if (publicBase) {
      return `${publicBase}/api/v1/mcp/app-runtime`;
    }
    return 'http://127.0.0.1:3000/api/v1/mcp/app-runtime';
  }

  private resolveAppDataMcpUrl(): string | undefined {
    if (!this.config.get<boolean>('appData.mcpEnabled', false)) return undefined;
    const explicit = this.config.get<string>('appData.mcpUrl', '').trim();
    if (explicit) return explicit;
    const publicBase = this.config.get<string>('appData.publicBaseUrl', '').replace(/\/$/, '')
      || this.config.get<string>('appRuntime.publicBaseUrl', '').replace(/\/$/, '');
    if (publicBase) {
      return `${publicBase}/api/v1/mcp/app-data`;
    }
    return 'http://127.0.0.1:3000/api/v1/mcp/app-data';
  }

  private get starterRevisionId(): string {
    return (
      this.config.get<string>('appRuntime.starterRevisionId') ||
      DEFAULT_STARTER_REVISION_ID
    );
  }

  private async upsert(
    conversationSessionId: string,
    userId: string,
    mcpTokenHash: string | null,
    starterRevisionId?: string,
  ): Promise<RuntimeBindingRecord | null> {
    return this.store.upsertByWorkspaceId({
      workspaceId: conversationSessionId,
      conversationSessionId,
      userId,
      mcpTokenHash,
      bindingId: `arb_${randomBytes(6).toString('hex')}`,
      status: 'created',
      latestRevisionId: starterRevisionId || this.starterRevisionId,
    });
  }
}
