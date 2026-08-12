import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { Model } from 'mongoose';
import {
  AppRuntimeBinding,
  AppRuntimeBindingDocument,
} from '../schemas/app-runtime-binding.schema';
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

    let binding = await this.upsert(conversationSessionId, userId, hash);
    if (!binding) {
      // Lost an insert race against a concurrent bind for the same session:
      // the document now exists, so the retry takes the update path.
      binding = await this.upsert(conversationSessionId, userId, hash);
    }

    if (!binding) {
      throw new Error(
        `Failed to bind app runtime for session ${conversationSessionId}`,
      );
    }

    this.logger.log(
      `App runtime bound bindingId=${binding.bindingId} workspaceId=${binding.workspaceId} userId=${userId}`,
    );

    return {
      bindingId: binding.bindingId,
      workspaceId: binding.workspaceId,
      latestRevisionId: binding.latestRevisionId,
      mcpUrl: this.config.get<string>('appRuntime.mcpUrl', ''),
      mcpToken: token,
    };
  }

  private async upsert(
    conversationSessionId: string,
    userId: string,
    mcpTokenHash: string,
  ): Promise<AppRuntimeBinding | null> {
    try {
      return await this.model
        .findOneAndUpdate(
          { workspaceId: conversationSessionId },
          {
            $set: { conversationSessionId, userId, mcpTokenHash },
            $setOnInsert: {
              bindingId: `arb_${randomBytes(6).toString('hex')}`,
              workspaceId: conversationSessionId,
              status: 'created',
              latestRevisionId: 'rev_0',
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
