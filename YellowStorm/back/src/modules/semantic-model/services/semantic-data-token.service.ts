import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import semanticModelConfig from '@config/semantic-model.config';
import { LoggerService } from '@modules/logger';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { ServiceUnavailableException } from '@modules/exceptions';
import { SemanticModelService } from './semantic-model.service';

export interface SemanticDataToken {
  token: string;
  realtimeToken: string;
  topic: string;
  restUrl: string;
  realtimeUrl: string;
  expiresAt: string;
}

// P2.SB06: existing-auth token bridge. The browser keeps its Yellowmind
// session; NestJS checks model membership and mints short-lived,
// model-scoped data-plane tokens. No database role is caller-selectable.
@Injectable()
export class SemanticDataTokenService {
  constructor(
    @Inject(semanticModelConfig.KEY)
    private readonly config: ConfigType<typeof semanticModelConfig>,
    private readonly models: SemanticModelService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(SemanticDataTokenService.name);
  }

  async issue(userId: string, modelId: string): Promise<SemanticDataToken> {
    await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const dataSecret = this.config.dataJwtSecret;
    const realtimeSecret = this.config.realtimeJwtSecret;
    if (!dataSecret || !realtimeSecret) {
      throw new ServiceUnavailableException(
        ErrorCode.SEMANTIC_MODEL_UNAVAILABLE,
        'Semantic data plane is not configured',
      );
    }
    const expiresAt = new Date(Date.now() + this.config.dataTokenTtlSeconds * 1000);
    const exp = Math.floor(expiresAt.getTime() / 1000);
    return {
      token: signHs256(dataSecret, {
        sub: userId,
        role: 'semantic_api_user',
        model_id: modelId,
        iss: 'yellowmind',
        exp,
      }),
      realtimeToken: signHs256(realtimeSecret, {
        sub: userId,
        role: 'authenticated',
        model_id: modelId,
        exp,
      }),
      topic: `semantic-model:${modelId}`,
      restUrl: this.config.dataRestUrl,
      realtimeUrl: this.config.dataRealtimeUrl,
      expiresAt: expiresAt.toISOString(),
    };
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function signHs256(secret: string, claims: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(claims));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}
