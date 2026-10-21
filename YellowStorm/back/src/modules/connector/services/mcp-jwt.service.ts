import { Injectable, Optional } from '@nestjs/common';
import { WorkspaceShareService } from '@modules/workspace/workspace-share.service';
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
import { assertNoUrlCredentials } from '../utils/remote-mcp-transport.util';

export interface AdkExecutionAuthority {
  purpose: 'root-work' | 'playbook-artifact' | 'native-conversation';
  sub: string;
  executionId: string;
  generation: string;
  conversationId?: string;
  messageId?: string;
  parentExecutionId?: string;
  owner?: string;
  fence?: number;
  flowId?: string;
  dispatchStartedAt?: string;
}

/** Dedicated MCP signing key; never reuse the application's HS256 secret. */
@Injectable()
export class McpJwtService {
  private readonly jwt = new JwtService();
  private readonly privateKey?: string;
  private readonly publicKey?: string;
  private readonly issuer?: string;
  private readonly workspaceScopeTtl: number;

  constructor(private readonly config: ConfigService, private readonly users: UserService,
     private readonly connectors: PgConnectorStore, private readonly authorization: AuthorizationService,
     @Optional() private readonly workspaceShares?: WorkspaceShareService) {
      this.workspaceScopeTtl = Number(config.get<number>('MCP_WORKSPACE_SCOPE_TTL_SECONDS', 180));
      if (!Number.isInteger(this.workspaceScopeTtl) || this.workspaceScopeTtl < 1 || this.workspaceScopeTtl > 300) {
        throw new Error('MCP_WORKSPACE_SCOPE_TTL_SECONDS must be an integer between 1 and 300');
      }
       const path = config.get<string>('MCP_JWT_PRIVATE_KEY_FILE');
       const issuer = config.get<string>('MCP_JWT_ISSUER');
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

  /** Separate protocol: MCP assertions can never substitute for execution authority. */
  issueAdkExecutionAuthority(claims: AdkExecutionAuthority): string {
    this.assertSignerConfigured();
    return this.jwt.sign({ ...claims, jti: randomUUID() }, {
      privateKey: this.privateKey, algorithm: 'RS256', issuer: this.issuer,
      audience: `yellowstorm-adk:${claims.purpose}`, expiresIn: 300,
      header: { alg: 'RS256', typ: 'adk-execution+jwt' },
    });
  }

  verifyAdkExecutionAuthority(token: string | undefined, purpose: AdkExecutionAuthority['purpose']): AdkExecutionAuthority {
    this.assertSignerConfigured();
    try {
      if (!token) this.deny();
      const decoded = this.jwt.verify(token!, { publicKey: this.publicKey, algorithms: ['RS256'],
        issuer: this.issuer, audience: `yellowstorm-adk:${purpose}`, maxAge: '300s', complete: true }) as {
          header: { typ?: string }; payload: AdkExecutionAuthority & { iat: number; exp: number; jti: string };
        };
      const claims = decoded.payload;
      if (decoded.header.typ !== 'adk-execution+jwt' || claims.purpose !== purpose
        || !/^[0-9a-f]{24}$/.test(claims.sub) || !/^[0-9a-f]{24}$/.test(claims.executionId)
        || typeof claims.generation !== 'string' || !claims.generation || typeof claims.jti !== 'string'
        || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)
        || claims.iat > Math.floor(Date.now() / 1000) || claims.exp <= claims.iat || claims.exp - claims.iat > 300) this.deny();
      // Do not propagate exp/iat/jti into a renewed JWT.
      return { purpose, sub: claims.sub, executionId: claims.executionId, generation: claims.generation,
        ...(claims.conversationId ? { conversationId: claims.conversationId } : {}),
        ...(claims.messageId ? { messageId: claims.messageId } : {}),
        ...(claims.parentExecutionId ? { parentExecutionId: claims.parentExecutionId } : {}),
        ...(claims.owner ? { owner: claims.owner, fence: claims.fence } : {}),
        ...(claims.flowId ? { flowId: claims.flowId, dispatchStartedAt: claims.dispatchStartedAt } : {}) };
    } catch { return this.deny(); }
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
    if ((policy.profile === 'internal_jwt' || policy.workspaceAuthorization) && connector.mcpTransportType !== 'streamable_http') this.deny();
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
    if (policy.profile === 'internal_jwt' || policy.workspaceAuthorization) this.assertSignerConfigured();
    return policy;
  }

  async issue(connectorId: string, userId: string): Promise<{ token: string; expiresAt: number; serverUrl: string }> {
    const connector = await this.load(connectorId);
    // A legacy operational query must not escape through JWT responses. Do not
    // silently sign for a different (query-stripped) destination during migration.
    assertNoUrlCredentials(connector.mcpServerUrl);
    const policy = await this.assertConnectorAccess(connector, userId);
    if (policy.profile !== 'internal_jwt' && !policy.workspaceAuthorization) this.deny();
    const now = Math.floor(Date.now() / 1000);
    const workspaceScope = policy.workspaceAuthorization ? {
      version: 1, permission: 'read', ids: await this.workspaceShares?.readableWorkspaceScope(userId) ?? this.deny(),
    } : undefined;
    const lifetime = workspaceScope ? this.workspaceScopeTtl : 300;
    const token = this.jwt.sign({ sub: userId, connectorId: connector.id, securityRevision: connector.securityRevision ?? 1,
      ...(workspaceScope ? { workspaceScope } : {}),
      iat: now, exp: now + lifetime, jti: randomUUID() }, {
      privateKey: this.privateKey, algorithm: 'RS256',
      issuer: this.issuer,
      audience: policy.audience,
    });
    return { token, expiresAt: now + lifetime, serverUrl: connector.mcpServerUrl! };
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
  async verifyMcpAssertion(token: string | undefined, expectedAudience: string | string[]): Promise<{ sub: string; connectorId: string; aud: string } | null> {
    if (!expectedAudience || (Array.isArray(expectedAudience) && !expectedAudience.length)) return null;
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

  private async verifyAssertion(token: string | undefined, expectedAudience?: string | string[]): Promise<{ sub: string; connectorId: string; aud: string } | null> {
    if (!token || !this.publicKey || !this.issuer) return null;
    try {
      const claims = this.jwt.verify(token, {
        publicKey: this.publicKey,
        algorithms: ['RS256'],
        issuer: this.issuer,
        // Omitted for the ADR-0024 delegated credential; jsonwebtoken then does
        // not enforce an audience at all. Route-declared sets pass the allowed
        // audience list (jsonwebtoken accepts string[] at runtime).
        ...(expectedAudience
          ? { audience: Array.isArray(expectedAudience) ? [...expectedAudience] as [string, ...string[]] : expectedAudience }
          : {}),
        // Backend minting allows at most five minutes; reject anything longer
        // even if it carries a valid signature.
        maxAge: '300s',
      }) as { sub?: unknown; connectorId?: unknown; securityRevision?: unknown; iat?: number; exp?: number; jti?: unknown; aud?: string | string[] };
      if (typeof claims?.sub !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(claims.sub)) return null;
      if (typeof claims.connectorId !== 'string' || typeof claims.jti !== 'string'
        || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)
        || claims.iat! > Math.floor(Date.now() / 1000) || claims.exp! <= claims.iat! || claims.exp! - claims.iat! > 300) return null;
      const connector = await this.load(claims.connectorId);
      const policy = await this.assertConnectorAccess(connector, claims.sub);
      const policyAudience = policy.audience;
      const audienceMatches = Array.isArray(expectedAudience)
        ? policyAudience !== undefined && expectedAudience.includes(policyAudience)
        : policyAudience === expectedAudience;
      if ((policy.profile !== 'internal_jwt' && !policy.workspaceAuthorization) || policy.actorDelegation !== 'verified_user'
        || (expectedAudience !== undefined && !audienceMatches)
        || claims.securityRevision !== (connector.securityRevision ?? 1)) return null;
      return { sub: claims.sub, connectorId: connector.id, aud: Array.isArray(claims.aud) ? String(claims.aud[0]) : String(claims.aud) };
    } catch {
      return null;
    }
  }

  async renew(connectorId: string, assertion: string) {
    const connector = await this.load(connectorId);
    const policy = normalizeMcpSecurityPolicy(connector.mcpSecurityPolicy);
    if ((policy.profile !== 'internal_jwt' && !policy.workspaceAuthorization) || !policy.audience) this.deny();
    const proof = await this.verifyMcpAssertion(assertion, policy.audience);
    if (!proof || proof.connectorId !== connectorId) this.deny();
    return this.issue(connectorId, proof.sub);
  }

  async headers(serverUrl: string, userId: string, existing: Record<string, string> = {}, connectorId?: string): Promise<Record<string, string>> {
    if (!connectorId) return existing;
    const connector = await this.load(connectorId);
    if (canonicalMcpEndpoint(serverUrl) !== canonicalMcpEndpoint(connector.mcpServerUrl)) this.deny();
    const policy = await this.assertConnectorAccess(connector, userId);
    if (policy.profile === 'configured' && !policy.workspaceAuthorization) return existing;
    if (policy.profile === 'public') {
      if (Object.keys(existing).some(name => !/^(accept|content-type|user-agent|x-correlation-id|mcp-protocol-version)$/i.test(name))) this.deny();
      return existing;
    }
    const { token, serverUrl: issuedEndpoint } = await this.issue(connectorId, userId);
    if (canonicalMcpEndpoint(issuedEndpoint) !== canonicalMcpEndpoint(serverUrl)) this.deny();
    return {
      ...Object.fromEntries(Object.entries(existing).filter(([name]) => !['authorization', 'x-yellowstorm-mcp-assertion'].includes(name.toLowerCase()))),
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
    return { headers: checkedHeaders, env: policy.profile === 'internal_jwt' || policy.workspaceAuthorization
      ? { ...cleanEnv, YELLOWSTORM_MCP_JWT_CONNECTOR_ID: connectorId } : cleanEnv };
  }

  /** Same receiver, fixed standalone read routes; never sign for an arbitrary URL. */
  async workspaceReadHeaders(connectorId: string, userId: string, endpoint: string,
    workspaceIds: string[], existing: Record<string, string>): Promise<Record<string, string>> {
    const connector = await this.load(connectorId);
    const policy = normalizeMcpSecurityPolicy(connector.mcpSecurityPolicy);
    const destination = new URL(canonicalMcpEndpoint(endpoint));
    const mcp = new URL(canonicalMcpEndpoint(connector.mcpServerUrl));
    if (!policy.workspaceAuthorization || !['configured', 'internal_jwt'].includes(policy.profile)
      || destination.origin !== mcp.origin || !['/search_native', '/search_native/batch'].includes(destination.pathname)
      || !workspaceIds.length || workspaceIds.length > 100 || !this.workspaceShares) this.deny();
    await this.workspaceShares.assertUserHasAccess(userId, workspaceIds);
    const headers = await this.headers(connector.mcpServerUrl!, userId, existing, connectorId);
    return { ...headers, 'Workspace-Id': [...new Set(workspaceIds)].join(',') };
  }
}
