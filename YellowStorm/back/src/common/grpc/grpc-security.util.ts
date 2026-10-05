import * as fs from 'node:fs';
import * as grpc from '@grpc/grpc-js';
import { ConfigService } from '@nestjs/config';

/**
 * Shared gRPC channel security for every client that dials an AI service.
 *
 * - TLS encrypts the channel and verifies the server cert.
 * - The API key (`x-api-key` metadata) authenticates the caller.
 *
 * Settings come from a config namespace (default `grpcSecurity`, used by every
 * client that shares the one AI service). Pass a different `namespace` for a
 * client that dials a *different* server with its own cert/key — e.g.
 * conversation-v2 uses `grpcSecurityV2`. See `config/grpc-security.config.ts`
 * and `config/grpc-security-v2.config.ts`.
 */

export interface GrpcChannelSecurity {
  credentials: grpc.ChannelCredentials;
  options: Record<string, string>;
}

type WarnFn = (message: string) => void;

/** Default config namespace — the shared AI service every other client dials. */
export const DEFAULT_GRPC_SECURITY_NAMESPACE = 'grpcSecurity';

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
  namespace: string = DEFAULT_GRPC_SECURITY_NAMESPACE,
): GrpcChannelSecurity {
  const tlsMode = config.get<string>(`${namespace}.tlsMode`, 'insecure');
  const requireTls = config.get<boolean>(`${namespace}.requireTls`, false);
  const caCertPath = config.get<string>(`${namespace}.tlsCaCertPath`);
  const serverNameOverride = config.get<string>(
    `${namespace}.tlsServerNameOverride`,
  );
  const isProd = process.env.NODE_ENV === 'production';

  if (requireTls && tlsMode !== 'tls') {
    throw new Error(
      `gRPC channel [${namespace}] requires TLS but tlsMode='${tlsMode}'. Refusing to start with an insecure gRPC channel.`,
    );
  }

  if (tlsMode !== 'tls') {
    if (isProd) {
      warn(
        `gRPC channel [${namespace}] is INSECURE (plaintext). Traffic is sent in cleartext. Set its TLS mode to 'tls'.`,
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
        `gRPC channel [${namespace}] CA cert '${caCertPath}' is unreadable: ${(error as Error).message}`,
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

/** The API key for a namespace, or undefined when auth isn't configured yet. */
export function getGrpcApiKey(
  config: ConfigService,
  namespace: string = DEFAULT_GRPC_SECURITY_NAMESPACE,
): string | undefined {
  return config.get<string>(`${namespace}.apiKey`);
}

/**
 * Per-call correlation headers attached to every outgoing gRPC call. Produced by
 * RequestContextService (W3C traceparent + request/correlation ids) and injected
 * here via `setGrpcCorrelationProvider` so each of the many call sites propagates
 * context without per-site plumbing (plan P05).
 */
export interface GrpcCorrelation {
  traceparent?: string;
  requestId?: string;
  correlationId?: string;
}

let grpcCorrelationProvider: () => GrpcCorrelation | undefined = () => undefined;

/** Called once by RequestContextService to make ALS context flow into gRPC metadata. */
export function setGrpcCorrelationProvider(provider: () => GrpcCorrelation | undefined): void {
  grpcCorrelationProvider = provider;
}

/**
 * Attach the `x-api-key` header required by the server interceptor. No-op until
 * the key is configured, so it's safe to call before the server enforces auth.
 */
export function attachGrpcApiKey(
  config: ConfigService,
  metadata: grpc.Metadata,
  namespace: string = DEFAULT_GRPC_SECURITY_NAMESPACE,
): grpc.Metadata {
  const apiKey = getGrpcApiKey(config, namespace);
  if (apiKey) {
    metadata.set('x-api-key', apiKey);
  }
  return metadata;
}

/**
 * Create a fresh Metadata pre-loaded with the API key for `namespace` and the
 * current request's correlation headers (traceparent / x-request-id /
 * correlation-id) when the ALS provider is registered.
 *
 * IMPORTANT: pass the returned Metadata to a gRPC call as the *positional*
 * metadata argument — `client.Method(request, createGrpcMetadata(cfg), ...)`.
 * Do NOT wrap it as `{ metadata }`; grpc-js then treats it as call options and
 * silently drops the headers (this was a real bug in conversation v1).
 */
export function createGrpcMetadata(
  config: ConfigService,
  namespace: string = DEFAULT_GRPC_SECURITY_NAMESPACE,
): grpc.Metadata {
  const metadata = attachGrpcApiKey(config, new grpc.Metadata(), namespace);
  const correlation = grpcCorrelationProvider();
  if (correlation) {
    // gRPC metadata values must be printable ASCII; echo-able inbound ids could
    // otherwise carry control chars and make grpc-js reject the outgoing call.
    const safe = (value: string | undefined) =>
      value && /^[\x20-\x7E]{1,200}$/.test(value) ? value : undefined;
    const traceparent = safe(correlation.traceparent);
    const requestId = safe(correlation.requestId);
    const correlationId = safe(correlation.correlationId);
    if (traceparent) metadata.set('traceparent', traceparent);
    if (requestId) metadata.set('x-request-id', requestId);
    if (correlationId) metadata.set('correlation-id', correlationId);
  }
  return metadata;
}
