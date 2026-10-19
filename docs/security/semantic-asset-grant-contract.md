# Semantic runtime asset execution authority

Status: local implementation with scoped required review passed; **P1 and deployment
qualification remain open**. This extends the existing semantic-model owner and
durable job tables, with no new deployed service or table. User-approved design
constraints are recorded in [ADR-0030](../agent-context/decisions/ADR-0030-p1-domain-and-job-bound-internal-authority.md).

## Admission, claim and use

1. The authenticated backend checks the current account, workspace and document
   version before signing an admission. Population additionally requires an active
   model, owner/editor role and current model/source access. Model-less discovery
   is a distinct purpose for the exact uploaded source, not unsigned `createdBy`
   authority or a population grant.
2. The signed command binds actor, purpose, model, source kinds/options and the
   original idempotency key. Its random UUID is the canonical job primary key.
   The runtime compares the normalized command before durable insertion; repeated
   idempotent requests preserve the existing authority. Copying an old admission
   under another key cannot create another authorized job. A legitimate new retry
   requires a fresh backend candidate. The five-minute admission window bounds
   job creation, not the duration of an already admitted live job.
3. Claiming a task rotates an opaque 256-bit proof. Only its SHA-256 digest is
   persisted in the existing checkpoint. Progress/checkpoint/renewal preserve that
   digest; reclaim rotates it together with the lease epoch. The proof and signed
   admission remain private runtime dispatch state and must never enter browser
   responses, model inputs or logs.
4. `POST workspaces/internal/semantic-asset-grant` requires the dedicated
   `semantic-runtime` machine principal plus the exact job/task/lease owner/epoch
   and opaque proof. The backend queries the canonical running job/task, checks
   the live lease, exact persisted command and signed candidate UUID/creation
   window, then rechecks current account/workspace/model/source/version rights.
5. Each of the five asset operations also requires `X-Semantic-Asset-Grant` and
   repeats those live checks. A grant is purpose-separated RS256 authority, lasts
   at most 300 seconds, and binds one document/version and operation. The actor is
   derived from the admission, never from an asset request's actor selector.
   Discovery cannot upload derived workspace documents.

Backend owner: [SemanticAssetGrantService](../../YellowStorm/back/src/modules/semantic-model/services/semantic-asset-grant.service.ts).
Transport owner: [WorkspaceAssetInternalController](../../YellowStorm/back/src/modules/workspace/workspace-asset-internal.controller.ts).
Runtime owners: [admission](../../YellowStorm/semantic-model-runtime/app/jobs/asset_admission.py),
[durable jobs](../../YellowStorm/semantic-model-runtime/app/persistence/postgres_jobs.py)
and [asset delivery](../../YellowStorm/semantic-model-runtime/app/datasource/asset_delivery.py).

## Dataset, derived-file and event boundaries

- Dataset IDs and derived filenames are exact signed targets; callers cannot
  substitute another selector after issuance. Selected parser/sheet options must
  be among the signed command's source scopes; ambiguous selection denies.
- Backend-chosen storage is isolated by canonical job UUID, lease epoch, source
  version hash and canonical options hash. There is no legacy raw-key fallback.
  Storage identifiers are implementation details, not new signing capabilities.
- Source events get one signed candidate per mapped sheet. Wrong-sheet candidates
  deny, retries deduplicate, and unsigned events do not acquire asset authority.
  When optional `uploadedAt` is absent, both boundaries use JavaScript ISO UTC
  milliseconds for the `occurredAt` fallback, including equivalent timezone
  offsets; exact signed-command comparison remains mandatory.
- Cancellation, expired/reclaimed leases, account/workspace/model revocation,
  model archival, changed sources and changed document versions invalidate use
  and refresh. Repeated authorized calls within the same live attempt are allowed;
  this is not a single-use nonce design. Cached readings do not bypass current
  metadata authorization.

## Focused evidence and limits

- Backend grant, runtime client, event publisher and asset controller: **4 suites,
  91 tests passed** after canonical-binding and timestamp corrections.
- Runtime authority, admission, delivery, population, discovery and command checks:
  **158 passed**; an older exact error-envelope fixture was updated to assert the
  existing structured failure details while preserving fail-closed expectations.
- Disposable PostgreSQL authority boundary: **8 passed / 47 deselected**, using
  the actual backend live-task SQL. Covers progress/renewal preservation, reclaim,
  stale proof/cancellation, UUID replay/idempotency, concurrent claim and per-sheet
  events with explicit/omitted timestamps. Only the jobs-related existing migration
  subset ran. These fixtures drop schemas: use an explicitly confirmed disposable
  database, never an application database.
- Broader durable-jobs PostgreSQL integration subsequently passed **55 tests**,
  including all existing runtime migrations, on the repository CI image
  `pgvector/pgvector:0.8.0-pg16` with `vector` and `pg_trgm` activated in the
  disposable database. The existing mapped-sheet fixture now supplies explicit
  per-sheet admissions instead of assuming an unsigned event can enqueue work.
- Required scoped review closed replay, dataset scope, archived-model and timestamp
  findings. It does not certify ADK/root or encrypted connector work.
- The earlier plain-PostgreSQL extension blocker is resolved for that fixture.
  Complete database-backed current-rights tests, real Ceph test-bucket
  behavior and deployment/TLS/rotation evidence remain separate qualification
  gates. See the [deployment manifest](p1-deployment-change-manifest.yaml).
