import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { UnauthorizedException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { UserService } from '../../user/user.service';
import { assertAccountApproved } from '../../user/utils/assert-account-accessible';
import { AuthorizationService } from '@modules/authorization/authorization.service';
import { hasPermission } from '@modules/authorization/constants/permissions';
import { PgConnectorStore } from '../persistence/pg-connector.store';
import type { ConnectorRow } from '../persistence/connector.store';
import { canonicalMcpEndpoint, normalizeMcpSecurityPolicy, resolveMcpDestinationPolicyOptions } from '../utils/mcp-security-policy';
import { assertMcpDestinationAllowed } from '../utils/mcp-destination-policy.util';

/** Bounded deployment compatibility only: remove after legacy signer keys migrate.
 * Shared keys take precedence; this adapter never grants connector trust or selects recipients.
 */
function signerConfigWithLegacyCompatibility(config: ConfigService): { path?: string; issuer?: string } {
  return {
    path: config.get<string>('MCP_JWT_PRIVATE_KEY_FILE') || config.get<string>('SEMANTIC_MODEL_MCP_JWT_PRIVATE_KEY_FILE'),
    issuer: config.get<string>('MCP_JWT_ISSUER') || config.get<string>('SEMANTIC_MODEL_MCP_JWT_ISSUER'),
  };
}

/** Dedicated MCP signing key; never reuse the application's HS256 secret. */
@Injectable()
export class McpJwtService {
  private readonly jwt = new JwtService();
  private readonly privateKey?: string;
  private readonly publicKey?: string;
  private readonly issuer?: string;

  constructor(private readonly config: ConfigService, private readonly users: UserService,
    private readonly connectors: PgConnectorStore, private readonly authorization: AuthorizationService) {
      const { path, issuer } = signerConfigWithLegacyCompatibility(config);
      if (!path && !issuer) return;
      if (!path || !issuer) {
        throw new Error('MCP JWT mode requires a private key file and issuer');
      }
      const key = createPrivateKey(readFileSync(path));
      if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
        throw new Error('MCP JWT signing requires an RSA key of at least 2048 bits');
      }
      this.privateKey = key.export({ type: 'pkcs8', format: 'pem' }).toString();
      // Verification counterpart used for actor assertions (WP06.4).
      this.publicKey = createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();
      this.issuer = issuer;
  }

  assertSignerConfigured(): void {
    if (!this.privateKey || !this.issuer) this.deny();
  }

  private deny(): never { throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Invalid MCP authorization'); }

  private async load(id: string): Promise<ConnectorRow> {
    const row = await this.connectors.findById(id);
    if (!row) this.deny();
    return row;
  }

  async checkDestination(connector: ConnectorRow): Promise<void> {
    const policy = normalizeMcpSecurityPolicy(connector.mcpSecurityPolicy);
    canonicalMcpEndpoint(connector.mcpServerUrl);
    await assertMcpDestinationAllowed(connector.mcpServerUrl,
      resolveMcpDestinationPolicyOptions(policy, connector.mcpServerUrl, this.config));
  }

  async assertConnectorAccess(connector: ConnectorRow, userId: string) {
    if (!connector.isActive || !['streamable_http', 'sse'].includes(connector.mcpTransportType ?? '')) this.deny();
    const policy = normalizeMcpSecurityPolicy(connector.mcpSecurityPolicy);
    if (policy.profile === 'internal_jwt' && connector.mcpTransportType !== 'streamable_http') this.deny();
    await this.checkDestination(connector);
    if (typeof userId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(userId)) {
      throw new UnauthorizedException(ErrorCode.INVALID_TOKEN, 'Invalid MCP actor');
    }
    // Independent reads, refreshed on every check. Preserve account-denial
    // priority even if the speculative role read fails first.
    const [userResult, rolesResult] = await Promise.allSettled([
      this.users.findById(userId), this.authorization.getUserRoles(userId),
    ]);
    if (userResult.status === 'rejected') throw userResult.reason;
    const user = userResult.value;
    if (!user) throw new UnauthorizedException(ErrorCode.USER_NOT_FOUND, 'User not found');
    assertAccountApproved(user);
    if (rolesResult.status === 'rejected') throw rolesResult.reason;
    const roles = rolesResult.value;
    const permissions = await this.authorization.getUserPermissions(roles.map(role => role.id));
    if (policy.requiredPermissions.some(permission => !hasPermission(permissions, permission))) this.deny();
    if (policy.profile === 'internal_jwt') this.assertSignerConfigured();
    return policy;
  }

  async issue(connectorId: string, userId: string): Promise<{ token: string; expiresAt: number; serverUrl: string }> {
    const connector = await this.load(connectorId);
    const policy = await this.assertConnectorAccess(connector, userId);
    if (policy.profile !== 'internal_jwt') this.deny();
    const now = Math.floor(Date.now() / 1000);
    const token = this.jwt.sign({ sub: userId, connectorId: connector.id, securityRevision: connector.securityRevision ?? 1,
      iat: now, exp: now + 300, jti: randomUUID() }, {
      privateKey: this.privateKey, algorithm: 'RS256',
      issuer: this.issuer,
      audience: policy.audience,
    });
    return { token, expiresAt: now + 300, serverUrl: connector.mcpServerUrl! };
  }

  /**
   * Verify a forwarded MCP actor assertion (WP06.4): the original short-lived,
   * backend-issued JWT of the user the MCP server acts for. Returns the signed
   * subject, or null when the assertion is missing, unsigned by this backend,
   * foreign-audience or expired. The token itself is never logged.
   *
   * Connector-scoped callers (renewal, inspection, runtime binding) keep the
   * trusted expected audience here: the connector and this route must agree.
   */
  async verifyMcpAssertion(token: string | undefined, expectedAudience: string): Promise<{ sub: string; connectorId: string } | null> {
    if (!expectedAudience) return null;
    return this.verifyAssertion(token, expectedAudience);
  }

  /**
   * Verify the delegated-user credential on the platform-trusted internal MCP
   * surface (ADR-0024). Same credential and the same signature/lifetime/
   * connector/revision authority as {@link verifyMcpAssertion}, without a
   * per-route audience fence: a trusted MCP may act for the verified user on
   * any internal route, always bounded by that user's own permissions. The
   * audience claim stays in the token but is not enforced here.
   */
  async verifyDelegatedActor(token: string | undefined): Promise<{ sub: string; connectorId: string } | null> {
    return this.verifyAssertion(token);
  }

  private async verifyAssertion(token: string | undefined, expectedAudience?: string): Promise<{ sub: string; connectorId: string } | null> {
    if (!token || !this.publicKey || !this.issuer) return null;
    try {
      const claims = this.jwt.verify(token, {
        publicKey: this.publicKey,
        algorithms: ['RS256'],
        issuer: this.issuer,
        // Omitted for the ADR-0024 delegated credential; jsonwebtoken then does
        // not enforce an audience at all.
        ...(expectedAudience ? { audience: expectedAudience } : {}),
        // Backend minting allows at most five minutes; reject anything longer
        // even if it carries a valid signature.
        maxAge: '300s',
      }) as { sub?: unknown; connectorId?: unknown; securityRevision?: unknown; iat?: number; exp?: number; jti?: unknown };
      if (typeof claims?.sub !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(claims.sub)) return null;
      if (typeof claims.connectorId !== 'string' || typeof claims.jti !== 'string'
        || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)
        || claims.iat! > Math.floor(Date.now() / 1000) || claims.exp! <= claims.iat! || claims.exp! - claims.iat! > 300) return null;
      const connector = await this.load(claims.connectorId);
      const policy = await this.assertConnectorAccess(connector, claims.sub);
      if (policy.profile !== 'internal_jwt' || policy.actorDelegation !== 'verified_user'
        || (expectedAudience !== undefined && policy.audience !== expectedAudience)
        || claims.securityRevision !== (connector.securityRevision ?? 1)) return null;
      return { sub: claims.sub, connectorId: connector.id };
    } catch {
      return null;
    }
  }

  async renew(connectorId: string, assertion: string) {
    const connector = await this.load(connectorId);
    const policy = normalizeMcpSecurityPolicy(connector.mcpSecurityPolicy);
    if (policy.profile !== 'internal_jwt' || !policy.audience) this.deny();
    const proof = await this.verifyMcpAssertion(assertion, policy.audience);
    if (!proof || proof.connectorId !== connectorId) this.deny();
    return this.issue(connectorId, proof.sub);
  }

  async headers(serverUrl: string, userId: string, existing: Record<string, string> = {}, connectorId?: string): Promise<Record<string, string>> {
    if (!connectorId) return existing;
    const connector = await this.load(connectorId);
    if (canonicalMcpEndpoint(serverUrl) !== canonicalMcpEndpoint(connector.mcpServerUrl)) this.deny();
    const policy = await this.assertConnectorAccess(connector, userId);
    if (policy.profile === 'configured') return existing;
    if (policy.profile === 'public') {
      if (Object.keys(existing).some(name => !/^(accept|content-type|user-agent|x-correlation-id|mcp-protocol-version)$/i.test(name))) this.deny();
      return existing;
    }
    const { token, serverUrl: issuedEndpoint } = await this.issue(connectorId, userId);
    if (canonicalMcpEndpoint(issuedEndpoint) !== canonicalMcpEndpoint(serverUrl)) this.deny();
    return {
      ...Object.fromEntries(Object.entries(existing).filter(([name]) => name.toLowerCase() !== 'authorization')),
      Authorization: `Bearer ${token}`,
    };
  }

  async bindingAuth(serverUrl: string, userId: string, connectorId: string,
    headers: Record<string, string>, env: Record<string, string>) {
    const checkedHeaders = await this.headers(serverUrl, userId, headers, connectorId);
    const policy = await this.assertConnectorAccess(await this.load(connectorId), userId);
    const cleanEnv = Object.fromEntries(Object.entries(env).filter(([name]) => !/^YELLOWSTORM_MCP_JWT_/i.test(name)
      && name !== 'ADK_RUNTIME_MCP_RENEWAL_TOKEN'));
    if (policy.profile === 'public' && Object.keys(cleanEnv).length) this.deny();
    return { headers: checkedHeaders, env: policy.profile === 'internal_jwt'
      ? { ...cleanEnv, YELLOWSTORM_MCP_JWT_CONNECTOR_ID: connectorId } : cleanEnv };
  }
}
