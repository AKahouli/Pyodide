import { isDeepStrictEqual } from 'node:util';
import { BadRequestException, ForbiddenException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { hasPermission, Permissions } from '@modules/authorization/constants/permissions';
import type { McpSecurityPolicy } from '../connector.types';
import { canonicalMcpEndpoint as normalizeEndpoint } from './mcp-destination-policy.util';
import type { McpDestinationPolicyOptions } from './mcp-destination-policy.util';

export const DEFAULT_MCP_SECURITY_POLICY: McpSecurityPolicy = {
  version: 1, profile: 'configured', actorDelegation: 'none',
  allowPrivateNetwork: false, allowInsecureHttp: false, requiredPermissions: [],
};

export function normalizeMcpSecurityPolicy(value: unknown): McpSecurityPolicy {
  if (value === undefined) return { ...DEFAULT_MCP_SECURITY_POLICY, requiredPermissions: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const policy = value as Record<string, unknown>;
  if (Object.keys(policy).some(key => !['version', 'profile', 'audience', 'actorDelegation', 'allowPrivateNetwork', 'allowInsecureHttp', 'requiredPermissions', 'workspaceAuthorization'].includes(key))) invalid();
  if (policy.workspaceAuthorization !== undefined && typeof policy.workspaceAuthorization !== 'boolean') invalid();
  if (policy.version !== 1 || typeof policy.profile !== 'string' || !['configured', 'internal_jwt', 'public'].includes(policy.profile)
    || typeof policy.actorDelegation !== 'string' || !['none', 'verified_user'].includes(policy.actorDelegation)
    || typeof policy.allowPrivateNetwork !== 'boolean'
    || (policy.allowInsecureHttp !== undefined && typeof policy.allowInsecureHttp !== 'boolean')
    || !Array.isArray(policy.requiredPermissions)
    || policy.requiredPermissions.length > 100
    || policy.requiredPermissions.some(p => typeof p !== 'string' || !(Object.values(Permissions) as string[]).includes(p))) invalid();
  const audience = typeof policy.audience === 'string' ? policy.audience.trim() : '';
  if (policy.workspaceAuthorization === true && (policy.profile === 'public' || policy.actorDelegation !== 'verified_user')) invalid();
  if (policy.profile === 'internal_jwt' || policy.workspaceAuthorization === true) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(audience)) invalid();
  } else if (policy.audience !== undefined || policy.actorDelegation !== 'none') invalid();
  if (policy.profile === 'public' && (policy.allowPrivateNetwork || policy.allowInsecureHttp)) invalid();
  return {
    version: 1, profile: policy.profile as McpSecurityPolicy['profile'],
    ...(audience ? { audience } : {}), actorDelegation: policy.actorDelegation as McpSecurityPolicy['actorDelegation'],
    allowPrivateNetwork: policy.allowPrivateNetwork as boolean,
    allowInsecureHttp: policy.allowInsecureHttp === true,
    requiredPermissions: [...new Set(policy.requiredPermissions as string[])].sort(),
    ...(policy.workspaceAuthorization !== undefined ? { workspaceAuthorization: policy.workspaceAuthorization as boolean } : {}),
  };
}

function invalid(): never {
  throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Invalid MCP security policy');
}

export function isPrivilegedMcpPolicy(policy: McpSecurityPolicy): boolean {
  return policy.profile === 'internal_jwt' || policy.allowPrivateNetwork || policy.allowInsecureHttp
    || policy.actorDelegation !== 'none' || policy.requiredPermissions.length > 0;
}

/**
 * One destination-policy resolution shared by inspection, runtime and evidence
 * paths, so a configured grant (e.g. development insecure HTTP) cannot diverge
 * between enforcement points. `config` is the typed ConfigService.
 */
export function resolveMcpDestinationPolicyOptions(
  policy: McpSecurityPolicy,
  serverUrl: string,
  config?: { get: <T = string>(propertyPath: string, defaultValue?: T) => T },
): McpDestinationPolicyOptions {
  const nodeEnv = config?.get<string>('NODE_ENV');
  return {
    ...(config ? { allowedPorts: config.get<string>('MCP_EGRESS_ALLOWED_PORTS', '80,443,8443').split(',').map(Number) } : {}),
    allowInsecureHttp: nodeEnv !== 'production'
      && (config?.get<boolean>('MCP_EGRESS_ALLOW_INSECURE_HTTP', false) || policy.allowInsecureHttp),
    requireTls: nodeEnv === 'production',
    allowExactEndpoints: policy.allowPrivateNetwork ? [serverUrl] : [],
  };
}

export function assertMcpSecurityManager(permissions: readonly string[] = []): void {
  if (!hasPermission([...permissions], Permissions.CONNECTORS_SECURITY_MANAGE)) {
    throw new ForbiddenException(ErrorCode.PERMISSION_DENIED);
  }
}

/** Binding-affecting mutations fence credentials and stale editor drafts. */
export const MCP_BINDING_FIELDS = ['mcpSecurityPolicy', 'mcpServerUrl', 'mcpTransportType',
  'mcpServerConfig', 'runtimeAuthConfig', 'authSourceType', 'connectedAppKey',
  'dynamicHeaders', 'isActive'] as const;

export function mcpBindingChanged(before: object, patch: object): boolean {
  const old = before as Record<string, unknown>;
  const next = patch as Record<string, unknown>;
  return MCP_BINDING_FIELDS.some(key => next[key] !== undefined && !isDeepStrictEqual(old[key], next[key]));
}

export function canonicalMcpEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.trim() !== value) invalid();
  return normalizeEndpoint(value) ?? invalid();
}

/** Reserved authority is set by policy, never by editable server/header JSON. */
export function assertNoReservedMcpOverrides(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/^x-yellowstorm-(?:user|service|mcp)/i.test(key) || /^YELLOWSTORM_MCP_JWT_/i.test(key)
      || /^(?:ADK_RUNTIME_MCP_RENEWAL_TOKEN|SEMANTIC_MODEL_MCP_SERVICE_TOKEN|INTERNAL_SERVICE_SECRET)$/i.test(key)) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Reserved MCP identity configuration');
    }
    assertNoReservedMcpOverrides(child);
  }
}

/** Trace/routing headers are not evidence of a resolved credential. */
function isCredentialHeader(name: string, header: unknown): boolean {
  return typeof header === 'string' && Boolean(header.trim())
    && !/^(?:accept(?:-.*)?|content-type|user-agent|traceparent|tracestate|baggage|mcp-.*|x-correlation-id|x-request-id|x-yellowstorm-.*|x-user-.*|x-workspace-.*|x-sandbox-.*)$/i.test(name)
    && !/^(?:bearer|basic)\s*$/i.test(header);
}

export function hasMcpCredentialHeaders(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).some(([name, header]) => isCredentialHeader(name, header));
}

/**
 * ADR-0026: with the assertion profile the ingress credential owns the
 * `Authorization` slot, so the provider credential must arrive in its own
 * header. A provider value sitting in `Authorization` is overwritten by the
 * assertion later (`McpJwtService.headers()`) and must not be counted as a
 * delivered credential — not even when a mapping also carries an unrelated
 * metadata header such as a client id.
 */
export function hasSeparateProviderCredential(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  const occupiesAuthorizationSlot = entries.some(([name, header]) =>
    /^authorization$/i.test(name) && typeof header === 'string' && Boolean(header.trim()));
  return !occupiesAuthorizationSlot && entries.some(([name, header]) => isCredentialHeader(name, header));
}

export function hasConfiguredMcpCredential(connector: {
  authSourceType: string; mcpServerConfig?: Record<string, unknown>;
}, resolvedHeaders: Record<string, string>): boolean {
  // A connected-account failure cannot fall back to a different stored identity.
  if (hasMcpCredentialHeaders(resolvedHeaders)) return true;
  return connector.authSourceType !== 'connected_app'
    && hasMcpCredentialHeaders(connector.mcpServerConfig?.headers);
}
