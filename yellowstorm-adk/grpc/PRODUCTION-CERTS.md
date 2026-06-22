# gRPC TLS in Production — DevOps Runbook

**Audience:** DevOps / Platform team provisioning and operating the AI-service (yellowstorm-adk) gRPC endpoint.
**Goal:** stand up the gRPC server in its **secure-by-default** mode: TLS-encrypted and API-key authenticated.

The application enforces this automatically — it **refuses to start** unless it has a
certificate, a private key, and an API key (the only bypass is `GRPC_ALLOW_INSECURE=true`,
which must **never** be set in production). Your job is to provision those three things and
mount them correctly.

---

## 1. What the server needs (the deliverables)

| Item | Env var | Notes |
|---|---|---|
| Server certificate (PEM) | `GRPC_TLS_CERT_PATH` | Full chain (leaf + intermediates). SAN **must** match the host clients dial. |
| Server private key (PEM) | `GRPC_TLS_KEY_PATH` | Secret. Mode `0400`/`0600`. Never leaves the server/secret store. |
| Shared API key | `GRPC_API_KEY` | Random high-entropy string. Distinct per environment. |

Plus, for the client teams to trust the server:

| Item | Goes to | Notes |
|---|---|---|
| CA certificate (PEM) | the gRPC **client** teams | **Public CA cert only.** Needed only if you sign with a private/internal CA. |

> The gRPC port serves **three services on one listener** (Chatbot, A2AAdmin,
> PlaybookFlowRuntime). One cert + one key + one API key secures all of them.

---

## 2. The non-negotiable rule: SAN must match the dial host

Clients connect to the value of `CONVERSATION_GRPC_URL` (host **without** the port). The
server certificate's **Subject Alternative Name (SAN)** must contain that exact host, or TLS
verification fails.

- Example: clients dial `ai-service.internal:50051` → cert SAN must include
  `DNS:ai-service.internal`.
- In Kubernetes, clients usually dial the Service DNS name, e.g.
  `ai-service.<namespace>.svc.cluster.local` → that must be a SAN.
- If clients connect by **IP**, the cert needs an `IP:` SAN, or the client must set
  `CONVERSATION_GRPC_TLS_SERVER_NAME_OVERRIDE` to a name that *is* on the cert. Coordinate
  this with the client team.

**Tell the client team the exact SAN(s) you issue.**

---

## 3. How to obtain the certificate (pick one)

### Option A — Kubernetes with cert-manager (recommended for k8s)
Issue from your internal ClusterIssuer/Issuer; the cert + key land in a Secret automatically.

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: ai-service-grpc
  namespace: ai
spec:
  secretName: ai-service-grpc-tls        # creates a kubernetes.io/tls secret (tls.crt, tls.key)
  duration: 2160h                        # 90d
  renewBefore: 360h                      # 15d
  privateKey:
    algorithm: ECDSA
    size: 256
  dnsNames:
    - ai-service.internal
    - ai-service.ai.svc.cluster.local    # add every name clients may dial
  issuerRef:
    name: internal-ca                     # your ClusterIssuer / Issuer
    kind: ClusterIssuer
```

cert-manager renews automatically. The **CA cert** to hand clients is your issuer's CA
(`ca.crt`), available from the issuer or the generated Secret.

### Option B — Corporate / internal PKI
Submit a CSR (CN = the dial host, SAN = all dial hosts) to your PKI and receive `server.crt`
(+ chain) and the issuing `ca.crt`. Keep `server.key` on the server side only.

### Option C — Manual openssl (small/standalone deployments)
Use the repo's generator with the **production hostname**:

```bash
./grpc/gen-certs.sh ai-service.internal /secure/out/dir
# produces: ca.crt (give clients), ca.key (SECRET, keep offline),
#           server.crt (GRPC_TLS_CERT_PATH), server.key (GRPC_TLS_KEY_PATH)
```
For multiple SANs, edit the `subjectAltName` line in `grpc/gen-certs.sh`
(e.g. `DNS:ai-service.internal,DNS:ai-service.ai.svc.cluster.local`).

> Whatever option: the file content is **PEM** (`-----BEGIN CERTIFICATE-----`). The
> extension (`.crt`/`.pem`) is cosmetic.

---

## 4. Generate the API key

A random, high-entropy secret. Generate once per environment, store in the secret manager:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
# or: openssl rand -base64 48
```

Do **not** reuse the dev/staging key in production.

---

## 5. Mount the secrets & set config

### Kubernetes (Secret + env + volume)

```yaml
# API key as a Secret
apiVersion: v1
kind: Secret
metadata: { name: ai-service-grpc-auth, namespace: ai }
type: Opaque
stringData:
  GRPC_API_KEY: "<value from §4>"
---
# Deployment excerpt
spec:
  template:
    spec:
      containers:
        - name: ai-service
          env:
            - name: GRPC_TLS_CERT_PATH
              value: /etc/grpc-tls/tls.crt
            - name: GRPC_TLS_KEY_PATH
              value: /etc/grpc-tls/tls.key
            - name: GRPC_ALLOW_INSECURE
              value: "false"               # explicit; never true in prod
            - name: GRPC_API_KEY
              valueFrom:
                secretKeyRef: { name: ai-service-grpc-auth, key: GRPC_API_KEY }
          volumeMounts:
            - name: grpc-tls
              mountPath: /etc/grpc-tls
              readOnly: true
      volumes:
        - name: grpc-tls
          secret:
            secretName: ai-service-grpc-tls   # cert-manager's tls.crt / tls.key
            defaultMode: 0400
```

### Docker / docker-compose

```yaml
services:
  ai-service:
    environment:
      GRPC_TLS_CERT_PATH: /etc/grpc-tls/server.crt
      GRPC_TLS_KEY_PATH:  /etc/grpc-tls/server.key
      GRPC_ALLOW_INSECURE: "false"
      GRPC_API_KEY: ${GRPC_API_KEY}            # from a secrets backend, not committed
    volumes:
      - /secure/host/grpc-tls:/etc/grpc-tls:ro
```

> Use **absolute paths** in production (certs live outside the repo). Relative paths are
> resolved against the app's repo root and are only for local dev.

---

## 6. What to hand the gRPC client teams

Deliver via the secret store / vault (not chat/email):

1. **`ca.crt`** — the CA public cert (only if you used a private/internal CA). With a public
   CA, clients need nothing. **Never** share `ca.key` or `server.key`.
2. **The `GRPC_API_KEY` value.**
3. **The exact SAN host(s)** you issued (so they set `CONVERSATION_GRPC_URL` to match, or a
   `*_SERVER_NAME_OVERRIDE` if they must dial a different name/IP).

Clients then set: `CONVERSATION_GRPC_TLS_MODE=tls`, `CONVERSATION_GRPC_TLS_CA_CERT_PATH=<ca.crt>`
(private CA only), `CONVERSATION_GRPC_API_KEY=<key>`, `CONVERSATION_GRPC_REQUIRE_TLS=true`.

> **All five backend gRPC clients** (conversation, conversation-v2, a2a-admin, two
> playbook-flow clients) dial this same server, so they all need the key + TLS before
> enforcement. Confirm with the backend team that every client is updated.

---

## 7. Verify before/after deploy

```bash
# Cert SAN and validity:
openssl x509 -in server.crt -noout -subject -ext subjectAltName -dates

# Chain validates against the CA you'll hand clients:
openssl verify -CAfile ca.crt server.crt

# Live server presents TLS and the right cert (run from a host that can reach it):
openssl s_client -connect ai-service.internal:50051 -servername ai-service.internal \
  -CAfile ca.crt -alpn h2 </dev/null 2>/dev/null | grep -E "subject=|Verify return code"
# expect: Verify return code: 0 (ok)
```

App logs on a healthy secure boot show: `[gRPC] TLS enabled — server certificate presented`
and `[gRPC] API-key authentication enabled`.

---

## 8. Rotation

- **TLS cert:** with cert-manager, automatic (`renewBefore`). Otherwise re-issue before
  expiry and redeploy. The server reads certs **at startup**, so rotation requires a
  rolling restart (no hot reload yet).
- **API key:** rotate by setting the new value and restarting. To avoid downtime, coordinate
  a window with the client teams, or roll clients first (they can send the new key before the
  server requires it only if the server still accepts the old one — single static key has no
  overlap, so plan a brief synchronized switch).
- **CA:** long-lived; rotating it means redistributing `ca.crt` to all clients.

---

## 9. Guardrails / do-not

- ❌ Never set `GRPC_ALLOW_INSECURE=true` in production (runs plaintext **and** disables
  auth). Treat its presence in a prod manifest as a blocking misconfig.
- ❌ Never commit or transmit `server.key` / `ca.key`. Secret store only.
- ❌ Don't reuse keys/certs across environments.
- ✅ A misconfig (missing/unreadable cert/key, missing API key) makes the gRPC server **fail
  to start** rather than expose an open port — that's intended. Check startup logs if the
  gRPC endpoint is down after a deploy.

---

## 10. Quick checklist

- [ ] Cert issued with SAN = every host clients dial (`CONVERSATION_GRPC_URL`).
- [ ] `server.crt` (+chain) and `server.key` mounted; `GRPC_TLS_CERT_PATH` / `GRPC_TLS_KEY_PATH` set (absolute).
- [ ] `GRPC_API_KEY` set from the secret store (prod-only value).
- [ ] `GRPC_ALLOW_INSECURE` unset or `false`.
- [ ] `ca.crt` + API key + SAN delivered to client teams (private CA case).
- [ ] `openssl verify` and live `s_client` checks pass.
- [ ] Renewal/rotation automated or calendared.
