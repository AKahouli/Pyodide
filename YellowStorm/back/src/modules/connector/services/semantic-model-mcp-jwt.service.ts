import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createPrivateKey, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BadRequestException, UnauthorizedException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { UserService } from '../../user/services/user.service';
import { assertAccountApproved } from '../../user/utils/assert-account-accessible';

/** Dedicated MCP signing key; never reuse the application's HS256 secret. */
@Injectable()
export class SemanticModelMcpJwtService {
  private readonly jwt = new JwtService();
  private readonly privateKey?: string;

  constructor(private readonly config: ConfigService, private readonly users: UserService) {
    if (['SEMANTIC_MODEL', 'PLAYBOOK', 'AGENT'].some((name) => config.get<string>(`${name}_MCP_AUTH_MODE`, 'Bearer') === 'JWT')) {
      const path = config.get<string>('MCP_JWT_PRIVATE_KEY_FILE') || config.get<string>('SEMANTIC_MODEL_MCP_JWT_PRIVATE_KEY_FILE');
      if (!path || !(config.get<string>('MCP_JWT_ISSUER') || config.get<string>('SEMANTIC_MODEL_MCP_JWT_ISSUER'))) {
        throw new Error('MCP JWT mode requires a private key file and issuer');
      }
      const key = createPrivateKey(readFileSync(path));
      if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
        throw new Error('MCP JWT signing requires an RSA key of at least 2048 bits');
      }
      this.privateKey = key.export({ type: 'pkcs8', format: 'pem' }).toString();
    }
  }

  isJwtServer(serverUrl: unknown): boolean {
    return this.serverConfig(serverUrl) !== null;
  }

  private serverConfig(serverUrl: unknown): { audience: string } | null {
    const servers = [
      ['SEMANTIC_MODEL', 'http://localhost:8027/mcp', 'mcp-semantic-model'],
      ['PLAYBOOK', 'http://localhost:8025/mcp', 'mcp-playbook'],
      ['AGENT', 'http://localhost:8026/mcp', 'mcp-agent'],
    ] as const;
    try {
      const normalize = (value: string) => {
        if (!value) return '';
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '';
        return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
      };
      const actual = typeof serverUrl === 'string' ? normalize(serverUrl) : '';
      if (!actual) return null;
      for (const [name, defaultUrl, defaultAudience] of servers) {
        if (this.config.get<string>(`${name}_MCP_AUTH_MODE`, 'Bearer') !== 'JWT') continue;
        const expected = normalize(this.config.get<string>(`${name}_MCP_SERVER_URL`, defaultUrl) ?? '');
        if (expected && actual === expected) {
          return { audience: this.config.get<string>(`${name}_MCP_JWT_AUDIENCE`, defaultAudience) ?? defaultAudience };
        }
      }
      return null;
    } catch { return null; }
  }

  async issue(serverUrl: string, userId: string): Promise<{ token: string; expiresAt: number; serverUrl: string }> {
    const server = this.serverConfig(serverUrl);
    if (!server || !this.privateKey) {
      throw new BadRequestException(ErrorCode.INVALID_TOKEN, 'JWT issuance is restricted to configured MCP servers');
    }
    if (typeof userId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(userId)) {
      throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Invalid MCP actor');
    }
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException(ErrorCode.USER_NOT_FOUND, 'User not found');
    assertAccountApproved(user);
    const now = Math.floor(Date.now() / 1000);
    const token = this.jwt.sign({ sub: userId, iat: now, exp: now + 300, jti: randomUUID() }, {
      privateKey: this.privateKey, algorithm: 'RS256',
      issuer: this.config.get<string>('MCP_JWT_ISSUER') || this.config.get<string>('SEMANTIC_MODEL_MCP_JWT_ISSUER'),
      audience: server.audience,
    });
    return { token, expiresAt: now + 300, serverUrl };
  }

  async headers(serverUrl: string, userId: string, existing: Record<string, string> = {}): Promise<Record<string, string>> {
    if (!this.isJwtServer(serverUrl)) return existing;
    const { token } = await this.issue(serverUrl, userId);
    return {
      ...Object.fromEntries(Object.entries(existing).filter(([name]) => name.toLowerCase() !== 'authorization')),
      Authorization: `Bearer ${token}`,
    };
  }

  async bindingAuth(serverUrl: string, userId: string, connectorId: string,
    headers: Record<string, string>, env: Record<string, string>) {
    if (!this.isJwtServer(serverUrl)) return { headers, env };
    return { headers: await this.headers(serverUrl, userId, headers), env: {
      ...env,
      YELLOWSTORM_MCP_JWT_CONNECTOR_ID: connectorId,
      YELLOWSTORM_MCP_JWT_USER_ID: userId,
    } };
  }
}
