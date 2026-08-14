import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { Model } from 'mongoose';
import {
  AppRuntimeBinding,
  AppRuntimeBindingDocument,
} from '../schemas/app-runtime-binding.schema';
import { RuntimeRevisionService } from './runtime-revision.service';
import { RuntimeTokenService } from './runtime-token.service';

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
}

export interface MarkBrowserActiveParams {
  workspaceId: string;
  browserRuntimeId: string;
  capabilities: Record<string, unknown>;
  lastHeartbeatAt: Date;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000;
}

@Injectable()
export class RuntimeBindingService {
  private readonly logger = new Logger(RuntimeBindingService.name);

  constructor(
    @InjectModel(AppRuntimeBinding.name)
    private readonly model: Model<AppRuntimeBindingDocument>,
    private readonly tokens: RuntimeTokenService,
    private readonly revisions: RuntimeRevisionService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Create or reuse the binding for a conversation session. Re-binding keeps
   * the same `bindingId` and revision but rotates the MCP token, because the
   * gateway overwrites its stored token on every remote bind.
   */
  async bind(params: BindRuntimeParams): Promise<BindRuntimeResult> {
    const { conversationSessionId, userId } = params;
    const { token, hash } = this.tokens.issue();

    const binding = await this.upsertWithRetry(conversationSessionId, userId, hash);
    await this.revisions.ensureStarterRevision(binding.workspaceId);

    this.logger.log(
      `App runtime bound bindingId=${binding.bindingId} workspaceId=${binding.workspaceId} userId=${userId} revisionId=${binding.latestRevisionId}`,
    );

    return {
      bindingId: binding.bindingId,
      workspaceId: binding.workspaceId,
      latestRevisionId: binding.latestRevisionId,
      mcpUrl: this.resolveMcpUrl(),
      mcpToken: token,
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
  ): Promise<AppRuntimeBinding> {
    const binding = await this.upsertWithRetry(conversationSessionId, userId, null);
    await this.revisions.ensureStarterRevision(binding.workspaceId);
    return binding;
  }

  findByWorkspaceId(workspaceId: string): Promise<AppRuntimeBinding | null> {
    return this.model.findOne({ workspaceId }).lean().exec();
  }

  findByMcpTokenHash(mcpTokenHash: string): Promise<AppRuntimeBinding | null> {
    return this.model.findOne({ mcpTokenHash }).lean().exec();
  }

  async markBrowserActive(params: MarkBrowserActiveParams): Promise<void> {
    await this.model
      .updateOne(
        { workspaceId: params.workspaceId },
        {
          $set: {
            status: 'browser_active',
            browserRuntimeId: params.browserRuntimeId,
            browserCapabilities: params.capabilities,
            lastHeartbeatAt: params.lastHeartbeatAt,
          },
        },
      )
      .exec();
  }

  async markWaitingForBrowser(workspaceId: string): Promise<void> {
    await this.model
      .updateOne(
        { workspaceId, status: 'browser_active' },
        { $set: { status: 'waiting_for_browser' } },
      )
      .exec();
  }

  async touchHeartbeat(workspaceId: string, at: Date): Promise<void> {
    await this.model
      .updateOne({ workspaceId }, { $set: { lastHeartbeatAt: at } })
      .exec();
  }

  async updateRevision(workspaceId: string, revisionId: string): Promise<void> {
    await this.model
      .updateOne({ workspaceId }, { $set: { latestRevisionId: revisionId } })
      .exec();
  }

  private async upsertWithRetry(
    conversationSessionId: string,
    userId: string,
    mcpTokenHash: string | null,
  ): Promise<AppRuntimeBinding> {
    let binding = await this.upsert(conversationSessionId, userId, mcpTokenHash);
    if (!binding) {
      // Lost an insert race against a concurrent bind for the same session:
      // the document now exists, so the retry takes the update path.
      binding = await this.upsert(conversationSessionId, userId, mcpTokenHash);
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

  private get starterRevisionId(): string {
    return (
      this.config.get<string>('appRuntime.starterRevisionId') ||
      'starter_react_vite_v1'
    );
  }

  private async upsert(
    conversationSessionId: string,
    userId: string,
    mcpTokenHash: string | null,
  ): Promise<AppRuntimeBinding | null> {
    try {
      return await this.model
        .findOneAndUpdate(
          { workspaceId: conversationSessionId },
          {
            $set: {
              conversationSessionId,
              userId,
              // A field may not appear in both $set and $setOnInsert.
              ...(mcpTokenHash === null ? {} : { mcpTokenHash }),
            },
            $setOnInsert: {
              bindingId: `arb_${randomBytes(6).toString('hex')}`,
              workspaceId: conversationSessionId,
              status: 'created',
              // New workspaces start on the Ceph-seeded React/Vite starter.
              latestRevisionId: this.starterRevisionId,
              // Empty hash matches no token, so a binding created for a ticket
              // stays unusable over MCP until APImanus actually binds it.
              ...(mcpTokenHash === null ? { mcpTokenHash: '' } : {}),
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
        .lean()
        .exec();
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return null;
      }
      throw error;
    }
  }
}
