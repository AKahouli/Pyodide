import { Injectable, Logger } from '@nestjs/common';
import { AppRuntimeBinding } from '../schemas/app-runtime-binding.schema';
import { RuntimeBindingService } from '../services/runtime-binding.service';
import { RuntimeTokenService } from '../services/runtime-token.service';
import { AuthError } from '../mcp/runtime-mcp.errors';

@Injectable()
export class RuntimeMcpAuthService {
  private readonly logger = new Logger(RuntimeMcpAuthService.name);

  constructor(
    private readonly bindings: RuntimeBindingService,
    private readonly tokens: RuntimeTokenService,
  ) {}

  /**
   * Resolve a Bearer MCP token to a persisted binding.
   * The model never supplies workspace/user identifiers — they come from the token.
   */
  async resolveBinding(authorization: string | undefined): Promise<AppRuntimeBinding> {
    const token = this.extractBearerToken(authorization);
    const hash = this.tokens.hash(token);
    const binding = await this.bindings.findByMcpTokenHash(hash);
    if (!binding) {
      this.logger.warn('Runtime MCP auth rejected: invalid bearer token');
      throw new AuthError(401, 'Invalid or expired bearer token');
    }
    return binding;
  }

  extractBearerToken(authorization: string | undefined): string {
    if (!authorization?.trim()) {
      throw new AuthError(401, 'Missing Authorization header');
    }
    const lower = authorization.toLowerCase();
    if (!lower.startsWith('bearer ')) {
      throw new AuthError(401, 'Expected Bearer authorization scheme');
    }
    const token = authorization.slice('bearer '.length).trim();
    if (!token) {
      throw new AuthError(401, 'Empty bearer token');
    }
    return token;
  }
}
