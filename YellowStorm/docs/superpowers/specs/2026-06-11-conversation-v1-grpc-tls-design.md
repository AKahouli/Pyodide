# Securing the Conversation v1 gRPC Channel (TLS)

**Status:** Design — approved approach, pending implementation
**Date:** 2026-06-11
**Author:** Backend team
**Audience:** YellowStorm backend engineers **and** the AI/chatbot service team (see [§9 For the AI Service Team](#9-for-the-ai-service-team))
**Scope:** `back/src/modules/conversation` (v1) gRPC **client** only

---

## 1. Problem

The v1 conversation module talks to the Python AI/chatbot service over gRPC. The
client is created with **insecure (plaintext) credentials**:

```ts
// back/src/modules/conversation/services/stream.service.ts:143
this.chatbotClient = new chatbotPackage.ChatbotService(
  grpcUrl,
  grpc.credentials.createInsecure(),   // ⚠️ no encryption, no server-identity check
);
```

Consequences:

- **No confidentiality.** All chat traffic — user queries, agent prompts, tool
  access tokens (`Tool.accessToken`), workspace document contents, model output —
  crosses the network in cleartext. Anyone able to observe the path (a
  compromised node, a misconfigured network hop, a sidecar) can read it.
- **No server-identity verification.** The backend does not verify it is talking
  to the real AI service. A process that occupies `CONVERSATION_GRPC_URL` (DNS
  spoofing, service-mesh misroute, a rogue pod) is trusted implicitly.

The only metadata currently attached to calls is a `user` header
(`stream.service.ts:810`), which exists for **LiteLLM usage logging** — it is
**not** a security control.

This is true of all five gRPC clients in the backend
(`conversation`, `conversation-v2`, `agent/a2a-admin`, two `playbook-flow`
clients), but this design is scoped to **conversation v1** per the current task.

## 2. Goals & Non-Goals

### Goals
- Encrypt the backend → AI-service gRPC channel with **TLS**.
- Let the client **verify the AI service's server certificate** (server
  authentication), so the backend knows it is talking to the right server.
- Be **configuration-driven** and **fail-closed on misconfiguration**, with a
  clear, loud signal when running insecurely in production.
- Keep an **opt-in insecure mode** so local development needs no certs.
- Be **reusable**: the core piece must be adoptable by the other four gRPC
  clients later with a near-one-line change.
- Be **well-documented** for both teams, including exactly what the AI service
  must enable server-side for this to take effect.

### Non-Goals (explicitly out of scope)
- **Mutual TLS (mTLS) / client certificates.** We do TLS only — the channel is
  encrypted and the *server* is authenticated, but the *client* is **not**
  cryptographically authenticated to the server. (Documented as a future step;
  see [§8](#8-future-work).)
- **Application-level caller authentication** (shared bearer token / JWT in
  metadata). Not in this iteration.
- **Server-side changes.** The AI service code is owned by another team and is
  not in this repo. We deliver a TLS-capable client and document the server
  requirement; the channel only becomes encrypted once the server terminates TLS
  (see [§9](#9-for-the-ai-service-team)).
- The other four gRPC clients. (Design is reusable for them; wiring is not part
  of this task.)

> **Important honesty note for both teams:** a TLS *client* alone secures
> nothing on the wire. TLS is a handshake. Encryption happens **only** when the
> **server** also presents a certificate and terminates TLS. Until the AI service
> does that, deployments must remain in `insecure` mode. This document is the
> coordination contract for flipping that switch.

## 3. Chosen Approach

**A dedicated, reusable gRPC credentials factory** that maps configuration to a
`grpc.ChannelCredentials` plus channel options. `StreamService` consumes it
instead of hardcoding `createInsecure()`.

Approaches considered:

| Approach | Summary | Verdict |
|---|---|---|
| **A. Inline in `StreamService`** | Add config + TLS/insecure branch directly in `initGrpcClient()`. | Rejected — `StreamService` is already ~1570 lines, not unit-testable in isolation, no reuse for the other four clients. |
| **B. Dedicated credentials factory** | Small focused unit: config → `{ credentials, channelOptions }`, with fail-closed validation. | **Chosen** — isolated, unit-testable, matches the repo's `registerAs` config pattern, reusable. |
| **C. Full gRPC client abstraction layer** | A base class all five clients extend. | Rejected — YAGNI for TLS-only; a risky 5-service refactor. |

## 4. Configuration

New environment variables, added to the existing `conversation` config
(`back/src/config/conversation.config.ts`, `registerAs('conversation', …)`).

| Env var | Values | Default | Meaning |
|---|---|---|---|
| `CONVERSATION_GRPC_TLS_MODE` | `insecure` \| `tls` | `insecure` | Selects the credential type. `insecure` = plaintext (legacy behavior). `tls` = encrypted + verify server cert. |
| `CONVERSATION_GRPC_TLS_CA_CERT_PATH` | file path | *(unset)* | PEM file with the CA root(s) used to verify the AI server's certificate. If unset in `tls` mode, falls back to Node's built-in public CA roots (use this only when the server cert is issued by a public CA). |
| `CONVERSATION_GRPC_TLS_SERVER_NAME_OVERRIDE` | hostname | *(unset)* | Sets `grpc.ssl_target_name_override` / `grpc.default_authority`. Needed when connecting by IP or an internal DNS name that does not match the certificate's SAN (common in Kubernetes). |
| `CONVERSATION_GRPC_REQUIRE_TLS` | `true` \| `false` | `false` | Enforcement switch. When `true`, the app **refuses to start** unless `TLS_MODE=tls`. Set this in production once the AI service supports TLS, to prevent silent insecure regressions. |

### Why `insecure` is the default
The AI service is plaintext **today** (server-side TLS is not yet enabled). If we
defaulted to `tls`, the TLS handshake would fail against the plaintext server and
break every existing deployment on the next deploy. Defaulting to `insecure`
keeps the system working and makes TLS a deliberate, coordinated flip:

1. AI team enables TLS termination + publishes the CA ([§9](#9-for-the-ai-service-team)).
2. Backend sets `CONVERSATION_GRPC_TLS_MODE=tls` (+ CA path if a private CA).
3. Backend sets `CONVERSATION_GRPC_REQUIRE_TLS=true` to lock it in.

### Validation rules (fail-closed)
Evaluated once, at client initialization:

- **Hard fail (throw → crash at boot, surfaces misconfiguration loudly):**
  - `REQUIRE_TLS=true` but `TLS_MODE != tls`.
  - `TLS_MODE=tls` and `TLS_CA_CERT_PATH` is set but the file is missing or
    unreadable. We never silently fall back to default roots or to insecure.
- **Soft warn (log prominently, keep running):**
  - `TLS_MODE=insecure` while `NODE_ENV=production` — emits a `warn`-level log on
    every startup: *"gRPC channel to AI service is UNENCRYPTED (insecure mode in
    production)."*

This separates **operator misconfiguration** (crash, so it's noticed) from a
**transient connection failure** (the existing graceful "gRPC unavailable"
degradation in `StreamService` is preserved — see `isGrpcAvailable`).

## 5. Components & Data Flow

### 5.1 `GrpcCredentialsFactory`
**Location:** `back/src/modules/conversation/grpc/grpc-credentials.factory.ts`
**Responsibility (single):** given the resolved TLS config, return the gRPC
credentials and channel options. No knowledge of streaming, messages, or NestJS
request flow.

**Interface (illustrative):**

```ts
export interface GrpcTlsConfig {
  mode: 'insecure' | 'tls';
  caCertPath?: string;
  serverNameOverride?: string;
  requireTls: boolean;
  isProduction: boolean;
}

export interface GrpcSecureChannel {
  credentials: grpc.ChannelCredentials;
  /** Channel options to spread into the client constructor (may be empty). */
  channelOptions: grpc.ClientOptions;
}

@Injectable()
export class GrpcCredentialsFactory {
  /** Validates config (fail-closed) and builds credentials + options. */
  create(config: GrpcTlsConfig): GrpcSecureChannel;
}
```

**Behavior:**
- `insecure` → `{ credentials: grpc.credentials.createInsecure(), channelOptions: {} }`
  (after the production soft-warn / `REQUIRE_TLS` hard-check).
- `tls` →
  - Read the CA PEM from `caCertPath` if set (else pass `null` → Node default
    roots). `createSsl(rootCert, null, null)` — `null` private key & cert chain
    because there is **no client certificate** (TLS only, not mTLS).
  - If `serverNameOverride` is set, add
    `{ 'grpc.ssl_target_name_override': name, 'grpc.default_authority': name }`
    to `channelOptions`.

### 5.2 `StreamService` wiring
**Location:** `back/src/modules/conversation/services/stream.service.ts`
**Change:** in `initGrpcClient()`, replace the hardcoded
`grpc.credentials.createInsecure()` with a call to `GrpcCredentialsFactory.create(...)`,
reading the new config values via the injected `ConfigService`, and pass the
returned `credentials` + `channelOptions` into the `ChatbotService` constructor.
No other behavior changes (idle timeout, health checks, buffering, etc. untouched).

### 5.3 Module registration
Register `GrpcCredentialsFactory` as a provider in `conversation.module.ts`.

### 5.4 Initialization sequence

```
StreamService.onModuleInit()
  → initGrpcClient()
      → resolve TLS config from ConfigService ('conversation.grpc*')
      → GrpcCredentialsFactory.create(config)
            ├─ validate (fail-closed) ──► throw on misconfig (app crashes loudly)
            ├─ build credentials (insecure | tls)
            └─ build channelOptions (+ server-name override)
      → new ChatbotService(grpcUrl, credentials, channelOptions)
      → waitForReady probe (existing behavior)
```

## 6. Testing (TDD)

Unit-test `GrpcCredentialsFactory` in isolation (it has no NestJS request
dependencies). Follow the existing pattern in
`conversation-v2.grpc-client.service.spec.ts`.

| Case | Expectation |
|---|---|
| `insecure` mode | returns insecure credentials, empty options, no throw |
| `insecure` + production | returns insecure credentials **and** logs the soft warning |
| `tls` + valid CA file | returns SSL credentials built from the file |
| `tls` + no CA path | returns SSL credentials using default roots |
| `tls` + `serverNameOverride` | options include `ssl_target_name_override` + `default_authority` |
| `tls` + CA path set but file missing/unreadable | **throws** |
| `REQUIRE_TLS=true` + `insecure` | **throws** |

CA-file cases use a temporary PEM fixture (or an injected file-reader seam) so the
tests touch no real network and no real certs.

## 7. Documentation Deliverables
- Update the **gRPC Integration** section of
  `back/src/modules/conversation/README.md` to describe the TLS config, the
  fail-closed rules, and the insecure-is-default rationale.
- Create `back/.env.example` (does not exist yet) **or** add the four vars to the
  canonical env template, with comments.
- This design doc serves as the cross-team reference.

## 8. Future Work
- **mTLS / client certificates** — cryptographically authenticate the backend to
  the AI service (eliminates the "any client can connect" gap that TLS-only
  leaves open). Adds a client cert + private key to the factory
  (`createSsl(root, clientKey, clientCert)`) and a server-side trust store.
- **Application-level caller auth** — shared bearer token or short-lived JWT in
  gRPC metadata, verified by a server interceptor, for fine-grained authz.
- **Promote the factory to `back/src/common/grpc/`** and adopt it in the other
  four clients (`conversation-v2`, `agent/a2a-admin`,
  `playbook-flow-runtime-client`, `playbook-flow-design-grpc`). The factory is
  intentionally dependency-free to make this a near-one-line change per client.

## 9. For the AI Service Team

This is the part you need. The backend will ship a TLS-**capable** gRPC client,
but **the channel stays plaintext until your gRPC server terminates TLS.** Here is
the contract.

### 9.1 What you must do
1. **Terminate TLS on the gRPC server** — either directly in the Python gRPC
   server (`grpc.ssl_server_credentials(...)`) or at a sidecar/ingress
   (Envoy/Linkerd/NGINX) that fronts it. Plain `add_insecure_port` will cause the
   backend's TLS handshake to **fail** once it switches to `tls` mode.
2. **Use a certificate whose SAN matches how the backend connects.** The backend
   connects via `CONVERSATION_GRPC_URL`. The certificate's **Subject Alternative
   Name** must include that host. If the backend connects by IP or by an internal
   name that can't be on the cert, tell us the cert's real hostname so we set
   `CONVERSATION_GRPC_TLS_SERVER_NAME_OVERRIDE` to match it.
3. **Tell us your CA.**
   - If the cert is signed by a **public CA**, we need nothing — Node's default
     roots will verify it.
   - If it's signed by a **private/internal CA** (or self-signed), give us the
     **CA root certificate (PEM)**. We mount it and point
     `CONVERSATION_GRPC_TLS_CA_CERT_PATH` at it. (Share the public CA cert only —
     never a private key.)
4. **Coordinate the cutover.** Because the backend defaults to `insecure`, both
   sides can move independently until the flip:
   - You can enable TLS while still accepting plaintext during a transition
     window (dual-listener), if your stack allows it.
   - Once your server requires TLS, we set `CONVERSATION_GRPC_TLS_MODE=tls`
     (+ CA path) and then `CONVERSATION_GRPC_REQUIRE_TLS=true`.

### 9.2 What this does and does not give you
- ✅ **Encryption in transit** — chat content, prompts, tool tokens, and document
  text are no longer cleartext on the wire.
- ✅ **Server authentication** — the backend verifies it's talking to *your*
  server (the one holding the cert for that SAN, signed by the agreed CA).
- ❌ **Client authentication** — TLS-only does **not** verify *which* client is
  calling you. Any client that trusts your CA can still open a connection. If you
  need to restrict callers, we'll need a follow-up: mTLS (client certs) and/or a
  shared token your server validates. Flag this if it matters on your side.

### 9.3 Quick reference: backend config once you're ready

```bash
# Backend deployment, after the AI service terminates TLS:
CONVERSATION_GRPC_URL=ai-service.internal:50051
CONVERSATION_GRPC_TLS_MODE=tls
# Only if you use a private/internal CA:
CONVERSATION_GRPC_TLS_CA_CERT_PATH=/etc/tls/ai-service-ca.pem
# Only if the connect host differs from the cert SAN:
CONVERSATION_GRPC_TLS_SERVER_NAME_OVERRIDE=ai-service.svc.cluster.local
# Lock it in (refuse to boot if not TLS):
CONVERSATION_GRPC_REQUIRE_TLS=true
```

## 10. Acceptance Criteria
- [ ] `GrpcCredentialsFactory` exists, is provider-registered, and is covered by
      unit tests for all cases in [§6](#6-testing-tdd).
- [ ] `StreamService.initGrpcClient()` builds its client via the factory; no
      hardcoded `createInsecure()` remains in the v1 conversation module.
- [ ] With no new env vars set, behavior is identical to today (insecure),
      preserving backward compatibility.
- [ ] `CONVERSATION_GRPC_TLS_MODE=tls` against a TLS-terminating server produces
      an encrypted, server-verified channel; streaming works end-to-end.
- [ ] Misconfiguration (disallowed insecure under `REQUIRE_TLS`, unreadable CA
      file) crashes at boot with an actionable message.
- [ ] `insecure` + `NODE_ENV=production` logs the prominent warning.
- [ ] README and env template updated; this doc committed.
```