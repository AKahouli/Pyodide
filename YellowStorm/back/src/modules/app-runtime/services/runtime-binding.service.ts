import { Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import {
  RUNTIME_SESSION_SEED_SOURCE,
  type RuntimeSessionSeedSource,
} from '../ports/runtime-session-seed.port';
import { TEMPLATE_REVISION_PREFIX } from '../constants/revision-id.constants';
import { type RuntimeBindingRecord } from '../persistence/runtime-binding.store';
import { PlatformBaselineService } from '../platform-kit/platform-baseline.service';
import { RuntimeRevisionService } from './runtime-revision.service';
import { RuntimeTokenService } from './runtime-token.service';
import {
  DEFAULT_STARTER_REVISION_ID,
  isSystemStarterRevisionId,
} from '../constants/starter-revisions';
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

/** Workspace revision holding the template normalized with the Platform Kit. */
const BASELINE_REVISION_ID = 'rev_1';

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
    private readonly baseline: PlatformBaselineService,
    private readonly config: ConfigService,
    @Optional()
    @Inject(RUNTIME_SESSION_SEED_SOURCE)
    private readonly sessionSeeds?: RuntimeSessionSeedSource,
  ) {}

  /**
   * Create or reuse the binding for a conversation session. Re-binding keeps
   * the same `bindingId` and revision but rotates the MCP token, because the
   * gateway overwrites its stored token on every remote bind.
   */
  async bind(params: BindRuntimeParams): Promise<BindRuntimeResult> {
    const { conversationSessionId, userId } = params;
    const { token, hash } = this.tokens.issue();

    const binding = await this.seedBinding(conversationSessionId, userId, hash);

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
    return this.seedBinding(conversationSessionId, userId, null);
  }

  /**
   * Resolve the session's template/starter seed, upsert the binding, promote
   * off a stale system-starter row when needed, then apply the Platform Kit.
   */
  private async seedBinding(
    conversationSessionId: string,
    userId: string,
    mcpTokenHash: string | null,
  ): Promise<RuntimeBindingRecord> {
    const session = await this.sessionSeeds?.findSeedByAiSessionId(conversationSessionId);
    const seedRevisionId = session?.starterRevisionId ?? undefined;

    let binding = await this.upsertWithRetry(
      conversationSessionId,
      userId,
      mcpTokenHash,
      seedRevisionId,
    );
    binding = await this.promoteTemplateSeedIfNeeded(binding, seedRevisionId);

    await this.revisions.ensureWorkspaceRevision(
      binding.workspaceId,
      binding.latestRevisionId,
    );
    binding = await this.ensurePlatformBaseline(binding);

    if (seedRevisionId?.startsWith(TEMPLATE_REVISION_PREFIX)) {
      const revisionReady = await this.revisions.revisionExists(
        binding.workspaceId,
        binding.latestRevisionId,
      );
      if (!revisionReady) {
        this.logger.warn(
          `Revision ${binding.latestRevisionId} is missing for workspace ${binding.workspaceId}; ` +
            `falling back to template seed ${seedRevisionId}`,
        );
        await this.store.updateRevision(binding.workspaceId, seedRevisionId);
        await this.revisions.ensureWorkspaceRevision(binding.workspaceId, seedRevisionId);
        binding = { ...binding, latestRevisionId: seedRevisionId };
      } else if (binding.latestRevisionId !== seedRevisionId) {
        await this.revisions.ensureWorkspaceRevision(
          binding.workspaceId,
          binding.latestRevisionId,
        );
      }
    }

    return binding;
  }

  /**
   * Upsert on conflict intentionally leaves `latestRevisionId` alone so agent
   * work is never clobbered. If the row was created on the system starter
   * before the session's template seed was visible, promote it once.
   */
  private async promoteTemplateSeedIfNeeded(
    binding: RuntimeBindingRecord,
    seedRevisionId: string | undefined,
  ): Promise<RuntimeBindingRecord> {
    if (
      !seedRevisionId?.startsWith(TEMPLATE_REVISION_PREFIX) ||
      !this.isStaleSystemStarterRevision(binding.latestRevisionId)
    ) {
      return binding;
    }

    this.logger.log(
      `Promoting workspace ${binding.workspaceId} from ${binding.latestRevisionId} to template seed ${seedRevisionId}`,
    );
    await this.store.updateRevision(binding.workspaceId, seedRevisionId);
    return { ...binding, latestRevisionId: seedRevisionId };
  }

  private isStaleSystemStarterRevision(revisionId: string): boolean {
    return revisionId === this.starterRevisionId || isSystemStarterRevisionId(revisionId);
  }

  /**
   * Admin templates ship none of the platform files, so the workspace baseline
   * is the template plus the injected Platform Kit. The browser then boots on
   * that normalized revision instead of the raw template.
   */
  private async ensurePlatformBaseline(
    binding: RuntimeBindingRecord,
  ): Promise<RuntimeBindingRecord> {
    if (!binding.latestRevisionId.startsWith(TEMPLATE_REVISION_PREFIX)) {
      return binding;
    }

    try {
      const { revisionId, plan } = await this.baseline.applyBaseline({
        workspaceId: binding.workspaceId,
        baseRevisionId: binding.latestRevisionId,
        newRevisionId: BASELINE_REVISION_ID,
        mode: 'seed',
      });

      if (plan.violations.length) {
        this.logger.warn(
          `Template ${binding.latestRevisionId} cannot be normalized automatically: ${plan.violations.join(' ')}`,
        );
      }
      if (revisionId === binding.latestRevisionId) {
        return binding;
      }

      await this.store.updateRevision(binding.workspaceId, revisionId);
      return { ...binding, latestRevisionId: revisionId };
    } catch (error) {
      // A failed normalization must not block the session; deploy still gates.
      this.logger.error(
        `Platform baseline failed for workspaceId=${binding.workspaceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return binding;
    }
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
