# Security cleanup plan

Date: 2026-10-16. Status: repository security controls implemented; deployment
verification and infrastructure/provider policy remain pending.

## Implementation update

The service uses dynamic `Workspace-Id` headers from the trusted backend, with
no static workspace permissions or credential mappings. HTTP scopes and filename-only
search are bounded by that header. Backend/gateway user entitlement verification
remains external to this service. Model clients require approved origins and verified HTTPS;
docs require authentication; probes require both authentication and an allowed network, and readiness
is cached. HTTP workloads, image decoding, logs, database TLS, container privileges,
and CI image scanning/SBOM generation are hardened. See
[security configuration and rollout](security-configuration.md) for migration
requirements and controls that still belong to deployment/provider owners.

The original priority/closure table remains a verification checklist, not a claim
that gateway controls, provider contracts, storage, or production TLS were tested.

Framework and model-wrapper dependencies have now been upgraded to patched
versions, including FastMCP 3.2.0 and Starlette 1.3.1. See
[ADR-0003](adr/0003-patched-frameworks-with-stable-retrieval-contracts.md).
A pip-audit run over the resulting image's 105 installed Python packages reported
no known vulnerabilities after upgrading pip to 26.2.1. No vulnerability ignores
or scanner suppressions were added. Image/OS scanning remains a separate check.

Further controls now validate TLS/model policy at startup, set both DB drivers'
transactions read-only, bound stored image columns in SQL before transfer,
mask sensitive MCP exception output/logs, and sign provenance/SBOMs in CI with
verification before digest-pinned deployment. GitHub/ACR signing and production
infrastructure have not been exercised by the local test run.

## Evidence and limits

The [security audit](Report_security_audit_MCP_Logical_Search%201.pdf) reviewed
commit `99bd129` (2026-10-07) and reports **4 High and 4 Medium** findings, with
no Critical findings. This plan compares those findings with local HEAD
`c1eebb2` (2026-10-15). File line numbers in the PDF can differ from this checkout.
This is a repository review, not a fresh penetration test or deployment audit.
No gateway, provider contract, production database, or deployed container was
inspected. No finding is marked resolved merely because documentation exists.

Existing controls worth preserving include constant-time bearer comparison,
SQL scope filtering, database/model admission limits, search deadlines, pinned
Python requirements, and the checksum-verified language model artifact.
These controls do not establish end-to-end tenant authorization.

## Recommended order

Priorities below indicate implementation order; audit severities are unchanged.
Owners are suggested roles and still need named assignees. Every finding remains
open pending implementation or deployment evidence and verification.

| Priority | Finding / audit severity | Recommended work | Suggested owner | Required closure evidence |
| --- | --- | --- | --- | --- |
| P0 | 01 / High: workspace entitlement | Follow [ADR-0002](adr/0002-dynamic-workspace-scope-from-trusted-header.md): validate membership dynamically in the trusted backend, inject the header, and prevent bypass. MCP/HTTP enforce that header's scope. | Service + gateway/identity | Backend rejects unauthorized user workspace selection; cross-header scope tests pass; gateway bypass is blocked. |
| P0 | 02 / High: model data disclosure | Inventory payloads for embeddings, filename embeddings, translation, and routing profiles. Approve HTTPS destinations, provider retention and tenant policy; enforce egress allowlists and content permissions. Redact where compatible with retrieval requirements. | Service + platform + data owner | Approved payload/provider matrix, documented retention and processing terms, and tests that prohibited calls are blocked before network transmission. |
| P0 | 03 / High: public docs and readiness | Restrict docs/schema and probes at ingress; allow readiness only from monitoring/orchestrator networks and rate-limit database-backed probes. | Platform | External requests are blocked; internal health checks work under configured probe limits. |
| P0 | 04 / High: direct endpoint workload | Apply request-body and field-length limits, cap total workspace/file pairs, and enforce per-principal request/model quotas. Restrict expensive endpoints pending these controls. | Service + platform | Oversized bodies and excessive pair counts fail before DB/model work; load tests demonstrate bounded work and effective quotas. |
| P1 | 05 / Medium: image memory | Cap encoded bytes before base64 decoding, decoded bytes before image processing, and pixels before loading/resizing. Define Pillow decompression-bomb handling and safe response limits. Coordinate ingestion validation and legacy-image handling. | Service + ingestion | Malformed, oversized, and high-pixel images are rejected safely with measured memory limits; valid image delivery still works. |
| P1 | 06 / Medium: sensitive logs | Keep request/SQL payload logging disabled by default; adopt metadata-only diagnostics, redaction, permissions, encryption, and explicit retention for exceptional captures. Review console/error logs too. | Service + platform | Synthetic sensitive markers are absent from routine logs; mounted storage permissions and retention are verified. |
| P1 | 07 / Medium: database transport | Require verified TLS for non-local DB connections, configure both asyncpg and psycopg2 paths, and use a least-privilege read-only service role. | Platform/DB + service | Both drivers verify the intended server; invalid certificates/plaintext are rejected in the production profile; writes are denied. |
| P1 | 08 / Medium: container/supply chain | Pin the base image digest with an update process, run as non-root, limit writable paths/capabilities, scan dependencies/images, generate an SBOM, and record image provenance. | Platform + service | Image user and runtime restrictions are verified; security scans, SBOM, and provenance are attached to the released image. |

## Containment before application changes

These are proposed deployment actions, not changes made by this review:

- Keep the backend private and reachable only through approved service/gateway
  routes. Confirm header stripping/injection and principal entitlement mapping;
  private networking alone does not close finding 01.
- Block external docs/schema/probe access, and restrict expensive standalone HTTP
  routes to explicitly authorized internal services.
- Keep `REQUEST_LOG_ENABLED=false` and `DB_ECHO=false` in deployment configuration.
  Ignoring logs in Git does not remove sensitive runtime log data.
- Review model destinations and network egress. Disabling query translation alone
  still leaves remote embeddings and routing-profile calls; it does not make
  retrieval local-only. Block unapproved content-bearing capabilities.
- Verify actual database TLS and credentials without copying secrets into issues,
  ADRs, or logs. Document results, not credential values.

## Pre-fix observations (review baseline)

These observations describe the initial review, before the implementation above.

- `APIKeyAuthMiddleware` still initializes authorized MCP scope from the same
  request header supplied by callers. Standalone HTTP capabilities explicitly
  retain trusted-service contracts in the architecture and maintenance guides.
  A fix must account for both surfaces.
- `/routing-profile` accepts raw JSON and checks for non-empty strings; it does
  not apply the typed search query's length contract. `/summarize` loops over
  workspace/file combinations. At the default 100-item collection limit on each
  side, a request can schedule 10,000 lookups. A per-list cap is not a pair cap.
- `_compress_image_base64` checks dimensions before resizing but has no explicit
  encoded-byte or application pixel cap. An 800-pixel output thumbnail is not
  a bound on source allocation or processing cost. Validate the exact decode path
  rather than treating the PDF's decode-order wording as a runtime measurement.
- Request logging and SQL echo default to false. That reduces exposure; it does
  not prove log storage, redaction, or retention are safe when enabled.
- The Dockerfile still uses `python:3.12-slim` without a digest or `USER`.
  The visible CI already runs unit and PostgreSQL integration tests. Extend
  those checks rather than adding a second test pipeline. No dedicated security
  scan/SBOM step is present in that workflow.

## Repository cleanliness after the security boundary

1. Keep the [architecture guide](logical-search.md) as the current contract,
   [operations guide](operations.md) as the runbook, and
   [maintenance history](maintenance-history.md) as dated evidence. Link new
   decisions through the [ADR index](adr/README.md); avoid another duplicated
   architecture specification.
2. Reconcile documentation against the implementation. For example, the
   operations settings table says the API key is required for all routes even
   though docs and health routes bypass it. Record exceptions accurately.
3. Track one owner, status, implementation link, and verification artifact for
   each audit finding. Do not use accepted ADRs or passing compilation as proof
   of remediation. Review the existing roadmap before creating duplicate work.
4. After an approved model-processing policy, record it in a separate ADR.
   Record the existing ingestion/schema ownership decision retrospectively only
   when its owner confirms it; do not invent historical approvals.
5. Verify whether the confidential PDF may be committed to this repository.
   It was untracked at review time; this work neither stages nor publishes it.
   Review build-context exclusions so audit reports, logs, and unrelated local
   artifacts are not shipped in the runtime image.
6. Fix confirmed risks before broad refactors of `db_helpers.py` or the tool
   server. Split modules only for a concrete maintenance problem, with behavior
   preserved and relevant existing tests passing.

## Release evidence

The subsequent ADR-0003 dependency/startup/image hardening passed **336 tests
with no skips** in the final Python 3.12 image against isolated ParadeDB
`0.18.9-pg17`. A separate runtime smoke check verified authenticated readiness,
real HTTP MCP citation-tool selection and scope rejection, and both asyncpg and
psycopg2 rejecting writes. The image ran as UID 10001 with a read-only filesystem.
Compose configuration and all nine CI shell steps passed syntax validation.
The 105 installed Python packages passed pip-audit with no known vulnerabilities.
The full-image scan failed with 55 High package/advisory matches across 14
Debian advisories with no fixed version listed. The publication gate remains
enabled at that verification point; the subsequent user-authorized deployment
policy gates only fixable High/Critical findings and retains a full report.
See [scan evidence and current policy](security-image-scan.md). GitHub/ACR attestations,
provider policies, encrypted log storage, and gateway identity controls were not
executed or modified by these local checks.

Earlier validation history:

Security-hardening validation before the ADR-0002 header-only correction on
2026-10-16: the Python 3.12 image passed
**331 tests with no skips**, using an isolated ParadeDB `0.18.9-pg17` database
on a private Docker network. The tests ran as UID 10001 with a read-only root
filesystem, dropped capabilities, and a bounded temporary filesystem. A runtime
smoke check verified startup, internal liveness, authenticated schema/tool
discovery, and forged-workspace rejection. Compose configuration, Python syntax,
documentation links, and Git whitespace checks also passed. No production
database, real model endpoint, gateway, or provider retention policy was tested.

The subsequent ADR-0002 correction removed the static workspace settings and
restored dynamic scope from the header. Its local full-suite run passed 315 tests
with 16 skips (331 total). New regression coverage verifies workspace IDs can
change between requests without configuration updates, while bearer checks,
missing-header rejection, and tool/body scope limits remain enforced. PostgreSQL
integration and POSIX-only coverage were skipped in that Windows run; the earlier
container results above are historical, not a rerun of this correction.

The Windows Python 3.10 development environment showed timing-sensitive test
failures during intermediate runs; the supported Python 3.12 container suite
above is the final verification environment.

The PDF reports that its pytest collection was blocked by missing dependencies.
That is a limitation of that audit run, not proof that the current suite fails.
The initial documentation-only review did not run application tests. The later
implementation is validated separately; record its test results in the PR.

For remediation work, run the repository's existing CI path:
`python -m unittest discover -s tests`, with the supported Python version and
an isolated `TEST_DATABASE_URL` using pgvector/pg_search. Record the commit,
environment, pass/fail/skip counts, relevant negative security tests, and
deployed gateway/TLS/runtime checks. Never use the production database for
fixtures. Require the CI check in branch protection and explicitly account for
skipped integration coverage.

Do not declare the project production-ready until High findings are verified
closed or explicitly risk-accepted by the accountable owner, and Medium findings
have verified closure or a named, time-bounded exception. Risk acceptance is
not technical remediation.

## Supporting guidance

- [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) supports default denial and authorization checks on every request.
- [Docker build guidance](https://docs.docker.com/build/building/best-practices/) supports digest pinning and running services without root privileges.
