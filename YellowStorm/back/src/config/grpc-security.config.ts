import { registerAs } from '@nestjs/config';

/**
 * Shared security settings for every gRPC client that dials the AI service
 * (conversation, a2a-admin, playbook-flow runtime + design). They all connect
 * to the **same** server, so TLS and the API key are a single shared secret —
 * one cert, one key, one TLS mode — sourced from the `CONVERSATION_GRPC_*`
 * env vars defined in the gRPC security integration guide.
 *
 * Defaults preserve legacy plaintext/no-auth behavior so local dev is
 * unaffected until cutover.
 */
export default registerAs('grpcSecurity', () => ({
  // Shared secret sent as `x-api-key` metadata on every call.
  apiKey: process.env.CONVERSATION_GRPC_API_KEY,
  // 'insecure' = plaintext (legacy). 'tls' = encrypted + verify server cert.
  tlsMode: process.env.CONVERSATION_GRPC_TLS_MODE || 'insecure',
  // PEM with the CA root that signed the server cert. Unset in tls mode → Node
  // default public roots.
  tlsCaCertPath: process.env.CONVERSATION_GRPC_TLS_CA_CERT_PATH,
  // Sets grpc.ssl_target_name_override / grpc.default_authority when connecting
  // by IP or an internal name that doesn't match the cert SAN.
  tlsServerNameOverride: process.env.CONVERSATION_GRPC_TLS_SERVER_NAME_OVERRIDE,
  // When true, refuse to start unless tlsMode === 'tls'.
  requireTls: process.env.CONVERSATION_GRPC_REQUIRE_TLS === 'true',
}));
