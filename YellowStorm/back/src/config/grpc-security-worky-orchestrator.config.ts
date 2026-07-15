import { registerAs } from '@nestjs/config';

/**
 * Config namespace for the worky AgentOrchestrator gRPC security. This client
 * dials a **different** service than conversation-v2 (a dedicated worky API),
 * so it has its own cert, key and TLS mode — sourced from dedicated
 * `WORKY_ORCHESTRATOR_GRPC_*` env vars, kept separate from `grpcSecurityV2` and
 * the shared `grpcSecurity` namespace.
 *
 * Defaults preserve legacy plaintext/no-auth behavior until cutover.
 */
export const WORKY_ORCHESTRATOR_GRPC_SECURITY_NS = 'grpcSecurityWorkyOrchestrator';

export default registerAs(WORKY_ORCHESTRATOR_GRPC_SECURITY_NS, () => ({
  // Shared secret sent as `x-api-key` metadata on every call.
  apiKey: process.env.WORKY_ORCHESTRATOR_GRPC_API_KEY,
  // 'insecure' = plaintext (legacy). 'tls' = encrypted + verify server cert.
  tlsMode: process.env.WORKY_ORCHESTRATOR_GRPC_TLS_MODE || 'insecure',
  // PEM with the CA root that signed the orchestrator server cert. Unset in
  // tls mode → Node default public roots.
  tlsCaCertPath: process.env.WORKY_ORCHESTRATOR_GRPC_TLS_CA_CERT_PATH,
  // Sets grpc.ssl_target_name_override / grpc.default_authority when connecting
  // by IP or an internal name that doesn't match the orchestrator cert SAN.
  tlsServerNameOverride:
    process.env.WORKY_ORCHESTRATOR_GRPC_TLS_SERVER_NAME_OVERRIDE,
  // When true, refuse to start unless tlsMode === 'tls'.
  requireTls: process.env.WORKY_ORCHESTRATOR_GRPC_REQUIRE_TLS === 'true',
}));
