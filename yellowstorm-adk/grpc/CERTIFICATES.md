# gRPC TLS Certificates — how to create them & what to give the client

The gRPC server is **secure by default**: it terminates TLS and requires an API key.
This guide covers the TLS half — creating the certificate the server presents, and what the
client (the YellowStorm backend) needs to verify it.

> The API-key half is separate: the server requires `GRPC_API_KEY`; the client sends it as
> `x-api-key` metadata. See `docs/grpc-auth-and-tls-client-guide.md`.

---

## The model: one private CA, three roles

We act as our own **Certificate Authority (CA)** because we don't buy a public cert for an
internal service. Four files are produced:

| File | What it is | Who holds it |
|---|---|---|
| `ca.crt` | CA **public** cert (the issuer) | **Server keeps it; a copy goes to the client** |
| `ca.key` | CA **private** key | Server side only — **never share** |
| `server.crt` | Server cert, signed by the CA | Server → `GRPC_TLS_CERT_PATH` |
| `server.key` | Server **private** key | Server → `GRPC_TLS_KEY_PATH` — **never share** |

At connection time: the server presents `server.crt`; the client checks who signed it (the
CA) and trusts it **because it was given `ca.crt`**.

### The one rule that always trips people up
The server cert's **Subject Alternative Name (SAN)** must match the host the client connects
to (`CONVERSATION_GRPC_URL`, without the port). Connect to `localhost` → SAN must be
`localhost`. Connect to `ai-service.internal` → SAN must be `ai-service.internal`. If the
client connects by an IP or a name not on the cert, it must set
`CONVERSATION_GRPC_TLS_SERVER_NAME_OVERRIDE` to a name that *is* on the cert.

---

## How to create the certs

Use the script in this folder. The argument is the host the client connects to.

```bash
# Local development (SAN = localhost), writes to grpc/certs/
./grpc/gen-certs.sh

# Production (SAN = your real hostname)
./grpc/gen-certs.sh ai-service.internal
```

Output lands in `grpc/certs/` (gitignored — keys are never committed):

```
grpc/certs/
├── ca.crt       → give to the client
├── ca.key       → SECRET (server side only)
├── server.crt   → GRPC_TLS_CERT_PATH
└── server.key   → SECRET, GRPC_TLS_KEY_PATH
```

Verify the SAN if unsure:

```bash
openssl x509 -in grpc/certs/server.crt -noout -ext subjectAltName
```

---

## Wire it up — server (this service)

In `.env` (relative paths are resolved against the repo root; absolute paths also work):

```bash
GRPC_TLS_CERT_PATH=grpc/certs/server.crt
GRPC_TLS_KEY_PATH=grpc/certs/server.key
GRPC_API_KEY=<your shared secret>
GRPC_ALLOW_INSECURE=false       # secure mode (TLS + API key enforced)
```

In production, mount the cert/key from a secret store (e.g. a k8s Secret at `/etc/tls/...`)
and use the absolute path there.

---

## What to give the client (backend)

Hand them **two things, over a secure channel** (secret store / vault — not chat/email):

1. **`ca.crt`** — the CA public cert (so they can verify our server). **Only `ca.crt`** —
   never `ca.key`, never `server.key`.
2. The **`GRPC_API_KEY` value** — they put it in `CONVERSATION_GRPC_API_KEY`.
3. If the host they connect to differs from the cert SAN, tell them the **SAN hostname**.

They then set (per their merged PR `feat(grpc): ... #1325`):

```bash
CONVERSATION_GRPC_API_KEY=<the GRPC_API_KEY value>
CONVERSATION_GRPC_TLS_MODE=tls
CONVERSATION_GRPC_TLS_CA_CERT_PATH=/path/to/ca.crt
# only if connect host != cert SAN (e.g. connecting to 127.0.0.1 with SAN=localhost):
CONVERSATION_GRPC_TLS_SERVER_NAME_OVERRIDE=localhost
CONVERSATION_GRPC_REQUIRE_TLS=true
```

> If you ever switch to a **public CA** (Let's Encrypt / corporate PKI trusted by Node), the
> client needs **nothing** for trust — they leave `CONVERSATION_GRPC_TLS_CA_CERT_PATH` unset
> and Node's built-in roots verify the server. The private-CA flow above is only because we
> self-issue.

---

## Local vs production — same mechanism, different certs

The code path is identical everywhere; only the cert files and hostname differ.

| | Local | Production |
|---|---|---|
| Generate | `./grpc/gen-certs.sh` (SAN=localhost) | `./grpc/gen-certs.sh <prod-host>` (or your PKI / cert-manager) |
| Cert location | `grpc/certs/` (in repo, gitignored) | mounted secret, e.g. `/etc/tls/` |
| `GRPC_API_KEY` | a dev value | a **different** prod-only secret |
| `GRPC_ALLOW_INSECURE` | `false` (or `true` to skip certs for quick dev) | `false` — always |

`GRPC_ALLOW_INSECURE=true` is the single, explicit opt-out: it runs the server plaintext
**and** drops the API-key requirement. Local dev only — never set it in a shared/prod env.

---

## Rotation & hygiene

- Certs expire — `server.crt` is valid ~825 days, the CA ~10 years. Re-run the script and
  redeploy before expiry. (The server reads certs at startup, so rotation needs a restart.)
- Never commit `*.key` (the `grpc/certs/` dir is gitignored for this reason).
- Use a distinct `GRPC_API_KEY` per environment; rotate by setting the new value on both
  sides within a coordinated window.
