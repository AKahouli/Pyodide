# Security configuration and rollout

These controls preserve retrieval/ranking algorithms and successful response
formats. They intentionally reject unauthorized scopes, unapproved destinations,
insecure database connections, and requests exceeding resource limits. Configure
them before deploying the hardened version. This document contains placeholders,
not deployable credentials. Do not copy secrets into Git or an ADR.

## Dynamic workspace scope and the fixed header

`Workspace-Id` is set on each request by trusted application code outside the
LLM. Workspace IDs are dynamic; the service has no workspace allowlist or
credential-to-workspace mapping in configuration. New workspaces need no restart.

```dotenv
MCP_API_KEY=replace-with-a-service-secret
```

Send the service bearer credential plus `Workspace-Id: workspace-a` (or a
comma-separated list of permitted IDs). Tool/body arguments may narrow that
header's scope but cannot expand it. MCP and data-bearing standalone HTTP routes
require a non-empty header for document access. MCP initialization, protocol
notifications, and tool/resource schema discovery require bearer authentication
but no workspace header. Supply the current dynamic `Workspace-Id` on each
document tool call or resource read; initialization does not establish a session-wide
workspace. Filename-only `/search_documents` filters discovery
and retrieval by the header too. Mixed out-of-header batches are rejected before
executing any item. Metadata routes require authentication; health probes also
require an allowed network as described below.

The trusted backend/gateway must authenticate the end user, check workspace
membership dynamically using the application's existing authorization data,
strip untrusted workspace headers, and inject the permitted scope. Keep the
service credential outside the LLM and untrusted clients, and prevent direct
backend bypass. This service authenticates its caller and enforces the supplied
scope; it does not independently prove an end user's membership. See
[ADR-0002](adr/0002-dynamic-workspace-scope-from-trusted-header.md).

## Approved model gateway

```dotenv
LITELLM_BASE_URL=https://models.example/v1
MODEL_ALLOWED_ORIGINS=["https://models.example"]
MODEL_ALLOW_HTTP_LOOPBACK=false
```

Origin matching uses the exact scheme, host, and port. HTTPS certificate
verification is enabled. URL credentials, query strings and fragments are
rejected. Model clients do not follow redirects or inherit environment proxies.
All embedding, translation, and routing-profile clients use this policy. Local
development can explicitly approve an HTTP loopback origin and enable
`MODEL_ALLOW_HTTP_LOOPBACK`; remote HTTP is rejected.

Model prompts, model names, payloads, and ranking are unchanged. Unapproved
destinations never receive content; existing optional-stage failure/fallback
behavior still applies. For valid behavior, approve the intended gateway before
starting the service. Do not change embedding models/dimensions during rollout.

The operator must also restrict gateway egress and downstream model routing,
approve provider retention/data-processing terms, and authorize the data classes
sent to each provider. An allowlist for the LiteLLM gateway cannot enforce its
downstream policy. This change does not redact or anonymize retrieval input.

## Documentation and probes

`/docs`, `/docs/oauth2-redirect`, and `/openapi.json` require bearer authentication.
To use Swagger, open it through an authenticated gateway that supplies the header
for the HTML and schema requests; entering a token inside Swagger cannot
authenticate the initial page load.

Health routes require bearer authentication AND a peer in `HEALTH_ALLOWED_NETWORKS`,
defaulting to IPv4/IPv6 loopback. Remote peers are denied even with a valid key.
Readiness uses
a single-flight database check and caches success/failure for
`HEALTH_READY_CACHE_SECONDS` (default 5); shutdown still reports draining
immediately. Compose's probe reads `MCP_API_KEY` from its container environment;
the key is not embedded in the Compose command or printed in its output.

Block external health routes at ingress even if the reverse proxy's backend
connection originates on loopback. The entry point disables Uvicorn proxy-header
rewriting so network checks use the actual connection peer. An arbitrary
`X-Forwarded-For` value cannot allow a probe, and loopback no longer bypasses auth.
Add only actual monitoring CIDRs, never a catch-all network.

## Workload and image budgets

Default HTTP limits are 1 MiB per body (including chunked bodies), 1024 characters
per workspace/file value, 100 total summary workspace/file pairs, 120 requests
per credential per minute, and 10 routing profiles per credential per minute.
Body reception is capped at 10 seconds. Routing profiles allow 200 sections and
120 seconds overall; model calls share existing global admission limits with a
60-second call budget. Requests exceeding limits fail before their protected work.

Rate windows are per worker. Keep the existing single-replica deployment; enforce
aggregate per-identity quotas and provider cost budgets at the gateway/provider
when using multiple workers/replicas. These local limits are not a billing quota.

Images allow 20,000,000 encoded bytes, 15,000,000 decoded bytes, and
25,000,000 pixels by default. Byte checks precede image processing, and pixel
checks precede resizing. Pillow decompression-bomb warnings become failures.
SQL projections replace oversized image payload columns with empty values before
transfer to Python, including full-document reads and evidence image attachment.
Unsafe image candidates are omitted rather than returned as raw base64 text.
Valid image resizing/output format stays unchanged. Validate images during
ingestion too; delivery guards do not remove oversized rows from PostgreSQL.

## Database, logs, and container

Remote database connections require `verify-full` TLS. Both asyncpg and psycopg2
use certificate/hostname verification; configure `DB_TLS_CA_FILE` for a private
CA, mounted read-only inside the container. Existing `sslmode=verify-full` and
`sslrootcert` URL settings are translated to the appropriate driver options.
`DB_TLS_MODE=disable` is accepted only for a loopback/local development database.
TLS policy and CA configuration are validated during startup without connecting.
If model access is configured, its approved endpoint is also validated before
the service becomes ready. Real server certificate checks happen on connection.
Both drivers set `default_transaction_read_only=on`; writes are rejected even
when a broadly privileged test credential is used. Still provision a read-only
database role so the credential itself cannot disable that protection. Ingestion
owns schema changes; the service's legacy `init_db` helper must not run migrations.

Request/SQL file logs remain disabled by default. When enabled they omit tool
inputs/outputs, SQL text/parameters, and error text, retaining timing/status
metadata. Stored resource IDs/source values are omitted too. MCP protocol errors
mask provider exception details, and FastMCP error logs suppress their raw exception
text. SQLAlchemy hides bound parameters even with SQL echo enabled. Keep
`DB_ECHO=false` in production. Log files use restrictive permissions; rotation
still follows existing size/backup settings. Configure storage encryption and
retention externally, including for earlier sensitive logs and backups.
Compose also caps Docker's console log files at three files of 10 MiB each;
size rotation does not replace an age-based retention policy for mounted logs.

The container runs as UID/GID `10001`, with a digest-pinned base. Compose drops
capabilities, prevents privilege escalation, uses a read-only root filesystem
and a bounded temporary filesystem, and publishes on `127.0.0.1` by default.
For a separate gateway container, use a private Docker network; do not expose the
backend publicly just to restore connectivity. Provision the mounted `logs`
directory for UID 10001 before rollout, even when request logging is disabled.
Ensure custom model/CA files are readable by that user. Audit reports, `.env`
files, tests, and local logs are excluded from the build context.

CI generates an image SBOM and blocks publishing on High/Critical scan findings
that have an available fix (`only-fixed: true`). A separate unfiltered scan
retains all findings, including unpatched and `wont-fix` advisories, together with
the SBOM as a GitHub Actions artifact for 30 days. Scanner execution failures
still fail the build. This deployment policy was authorized by the user to
unblock publishing; it does not remediate the outstanding base-image advisories.
The test job additionally audits dependency requirements on pull requests using
an isolated, pinned pip-audit environment.
The build job pushes the verified Docker image and captures its immutable SHA-256
digest. Deployment pulls and runs that exact digest, ensuring tamper-proof deployment.
GitHub Artifact Attestations was removed because private repositories on standard GitHub
plans do not support the feature (which requires GitHub Enterprise).

The self-hosted runners need registry access and Docker Compose. CI's build and deploy jobs
require only contents read permissions. Review/update the base digest and action pins
deliberately. Provider policy, gateway enforcement, DB role grants, encrypted storage, and
deployed TLS verification still require infrastructure owners.

## Patched dependencies

Security patches require FastMCP 3.2.0, FastAPI 0.135.2, Starlette 1.3.1,
Uvicorn 0.35.0, SSE-Starlette 3.5.0, Pydantic 2.11.9, OpenAI 2.26.0, and
langchain-openai 1.1.14, in addition to the previous Pillow/python-dotenv fixes.
The image pins pip 26.2.1. Reinstall `requirements.txt` or rebuild the image;
an existing development virtual environment does not update automatically.
Python 3.12 is the tested deployment runtime.

The service preserves FastMCP's prior component-object API through its supported
compatibility mode and small inspection-method adapters. Tests use the new
internal `ToolResult.content` wrapper while asserting the same delivered content.
See [ADR-0003](adr/0003-patched-frameworks-with-stable-retrieval-contracts.md).

## Verification before rollout

Run the existing unit and isolated PostgreSQL integration suite, then verify
cross-workspace rejection, approved model connectivity, internal health checks,
external probe/docs blocking, database certificate verification, and writable
log permissions in the target environment. Do not use production data as test
fixtures. A passing unit suite does not establish those deployment controls.
