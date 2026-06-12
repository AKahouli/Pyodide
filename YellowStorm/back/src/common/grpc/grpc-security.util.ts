import * as fs from 'node:fs';
import * as grpc from '@grpc/grpc-js';
import { ConfigService } from '@nestjs/config';

/**
 * Shared gRPC channel security for every client that dials the AI service.
 *
 * - TLS encrypts the channel and verifies the server cert.
 * - The API key (`x-api-key` metadata) authenticates the caller.
 *
 * All settings come from the `grpcSecurity` config namespace, so the whole
 * backend shares one cert + one key for the one server. See
 * `config/grpc-security.config.ts`.
 */

export interface GrpcChannelSecurity {
  credentials: grpc.ChannelCredentials;
  options: Record<string, string>;
}

type WarnFn = (message: string) => void;

/**
 * Build channel credentials + options from config. Fails closed at startup so
 * misconfiguration is loud, never a silent downgrade to plaintext:
 * - requireTls but mode !== 'tls' → throw
 * - tls mode with an unreadable CA path → throw
 * - insecure in production → warn (via `warn`)
 */
export function buildGrpcChannelCredentials(
  config: ConfigService,
  warn: WarnFn = () => {},
): GrpcChannelSecurity {
  const tlsMode = config.get<string>('grpcSecurity.tlsMode', 'insecure');
  const requireTls = config.get<boolean>('grpcSecurity.requireTls', false);
  const caCertPath = config.get<string>('grpcSecurity.tlsCaCertPath');
  const serverNameOverride = config.get<string>(
    'grpcSecurity.tlsServerNameOverride',
  );
  const isProd = process.env.NODE_ENV === 'production';

  if (requireTls && tlsMode !== 'tls') {
    throw new Error(
      `CONVERSATION_GRPC_REQUIRE_TLS=true but CONVERSATION_GRPC_TLS_MODE='${tlsMode}'. Refusing to start with an insecure gRPC channel.`,
    );
  }

  if (tlsMode !== 'tls') {
    if (isProd) {
      warn(
        'gRPC channel to the AI service is INSECURE (plaintext). Traffic is sent in cleartext. Set CONVERSATION_GRPC_TLS_MODE=tls.',
      );
    }
    return { credentials: grpc.credentials.createInsecure(), options: {} };
  }

  // tls mode: load the CA root only if a private CA is configured. A bad path
  // must throw — never fall back to insecure.
  let rootCert: Buffer | null = null;
  if (caCertPath) {
    try {
      rootCert = fs.readFileSync(caCertPath);
    } catch (error) {
      throw new Error(
        `CONVERSATION_GRPC_TLS_CA_CERT_PATH='${caCertPath}' is unreadable: ${(error as Error).message}`,
      );
    }
  }

  const credentials = grpc.credentials.createSsl(rootCert);

  const options: Record<string, string> = {};
  if (serverNameOverride) {
    options['grpc.ssl_target_name_override'] = serverNameOverride;
    options['grpc.default_authority'] = serverNameOverride;
  }

  return { credentials, options };
}

/** The shared API key, or undefined when auth isn't configured yet. */
export function getGrpcApiKey(config: ConfigService): string | undefined {
  return config.get<string>('grpcSecurity.apiKey');
}

/**
 * Attach the `x-api-key` header required by the server interceptor. No-op until
 * the key is configured, so it's safe to call before the server enforces auth.
 */
export function attachGrpcApiKey(
  config: ConfigService,
  metadata: grpc.Metadata,
): grpc.Metadata {
  const apiKey = getGrpcApiKey(config);
  if (apiKey) {
    metadata.set('x-api-key', apiKey);
  }
  return metadata;
}

/**
 * Create a fresh Metadata pre-loaded with the API key. Pass an existing
 * Metadata as `base` to add the key to it instead of allocating a new one.
 */
export function createGrpcMetadata(
  config: ConfigService,
  base?: grpc.Metadata,
): grpc.Metadata {
  return attachGrpcApiKey(config, base ?? new grpc.Metadata());
}
