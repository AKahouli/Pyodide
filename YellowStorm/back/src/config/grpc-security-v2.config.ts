import { registerAs } from '@nestjs/config';

/**
 * Security settings for the conversation-v2 (Manus) gRPC client. v2 dials a
 * **different** AI service than the v1/a2a/playbook clients, so it has its own
 * cert, key and TLS mode — sourced from dedicated `CONVERSATION_V2_GRPC_*`
 * env vars, kept separate from the shared `grpcSecurity` namespace.
 *
 * Defaults preserve legacy plaintext/no-auth behavior until cutover.
 */
export default registerAs('grpcSecurityV2', () => ({
  // Shared secret sent as `x-api-key` metadata on every call.
  apiKey: process.env.CONVERSATION_V2_GRPC_API_KEY,
  // 'insecure' = plaintext (legacy). 'tls' = encrypted + verify server cert.
  tlsMode: process.env.CONVERSATION_V2_GRPC_TLS_MODE || 'insecure',
  // PEM with the CA root that signed the v2 server cert. Unset in tls mode →
  // Node default public roots.
  tlsCaCertPath: process.env.CONVERSATION_V2_GRPC_TLS_CA_CERT_PATH,
  // Sets grpc.ssl_target_name_override / grpc.default_authority when connecting
  // by IP or an internal name that doesn't match the v2 cert SAN.
  tlsServerNameOverride:
    process.env.CONVERSATION_V2_GRPC_TLS_SERVER_NAME_OVERRIDE,
  // When true, refuse to start unless tlsMode === 'tls'.
  requireTls: process.env.CONVERSATION_V2_GRPC_REQUIRE_TLS === 'true',
}));
