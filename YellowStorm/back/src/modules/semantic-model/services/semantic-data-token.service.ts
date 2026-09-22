import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import semanticModelConfig from '@config/semantic-model.config';
import { LoggerService } from '@modules/logger';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { ServiceUnavailableException } from '@modules/exceptions';
import { SemanticDataGrantService } from './semantic-data-grant.service';

export interface SemanticDataToken {
  capabilities: { dataApi: boolean; realtime: boolean };
  token: string | null;
  realtimeToken: string | null;
  topic: string | null;
  restUrl: string | null;
  realtimeUrl: string | null;
  expiresAt: string | null;
}

// P2.SB06: existing-auth token bridge. The browser keeps its Yellowmind
// session; NestJS checks model membership and mints short-lived,
// model-scoped data-plane tokens. No database role is caller-selectable.
@Injectable()
export class SemanticDataTokenService {
  constructor(
    @Inject(semanticModelConfig.KEY)
    private readonly config: ConfigType<typeof semanticModelConfig>,
    private readonly grants: SemanticDataGrantService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(SemanticDataTokenService.name);
  }

  async issue(userId: string, modelId: string): Promise<SemanticDataToken> {
    if (!this.config.dataApiEnabled) {
      return {
        capabilities: { dataApi: false, realtime: false },
        token: null,
        realtimeToken: null,
        topic: null,
        restUrl: null,
        realtimeUrl: null,
        expiresAt: null,
      };
    }
    const dataSecret = this.config.dataJwtSecret;
    const realtimeSecret = this.config.realtimeJwtSecret;
    if (!dataSecret || (this.config.realtimeEnabled && !realtimeSecret)) {
      throw new ServiceUnavailableException(
        ErrorCode.SEMANTIC_MODEL_UNAVAILABLE,
        'Semantic data plane is not configured',
      );
    }
    const grant = await this.grants.issue(userId, modelId, this.config.dataTokenTtlSeconds);
    const expiresAt = grant.expiresAt;
    const exp = Math.floor(expiresAt.getTime() / 1000);
    return {
      capabilities: { dataApi: true, realtime: this.config.realtimeEnabled },
      token: signHs256(dataSecret, {
        sub: userId,
        role: 'semantic_api_user',
        model_id: modelId,
        grant_id: grant.grantId,
        scope_hash: grant.scopeHash,
        jti: grant.jti,
        aud: 'yellowmind-semantic-data',
        iss: 'yellowmind',
        exp,
      }),
      realtimeToken: this.config.realtimeEnabled ? signHs256(realtimeSecret, {
        sub: userId,
        role: 'authenticated',
        model_id: modelId,
        exp,
      }) : null,
      topic: this.config.realtimeEnabled ? `semantic-model:${modelId}` : null,
      restUrl: this.config.dataRestUrl,
      realtimeUrl: this.config.realtimeEnabled ? this.config.dataRealtimeUrl : null,
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
