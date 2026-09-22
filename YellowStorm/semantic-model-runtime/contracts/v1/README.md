# semantic-model-runtime contracts (v1)

Phase 0 captured contracts (plan P0.6). These are the cross-boundary shapes the
FastAPI runtime (Phase 2+) and the NestJS coordinator must agree on before any
heavy execution is enabled. They are frozen documentation-grade schemas until
Phase 2 generates the versioned OpenAPI document; Phase 2+ contract tests
validate fixtures in `tests/contracts/fixtures/` against these schemas.

Boundaries (plan §4.4): sample preview ≠ full coverage; exact text match ≠
business role; task success ≠ evidence completeness; a scope token is not an
authorization check.

## Schemas

| File | Purpose |
|---|---|
| `asset-ref.schema.json` | Authorized source identity: `(workspaceId, assetId, assetVersionId)` plus verification level. `assetVersionId` is a verified content fingerprint or source-version correlation — never a filename. |
| `discovery-profile.schema.json` | Versioned, bounded discovery profile (metadata / structure / samples / warnings / optional semantic findings), immutable per `(asset, parser options, profile revision)`. |
| `evidence-envelope.schema.json` | Bounded evidence packet with explicit locators, origin, source-version verification and independent coverage flags. |

## Fixtures

See `tests/contracts/fixtures/README.md`. The five Phase 0 scenarios cover one
XLSX, one CSV, one indexed document, one failed/unindexed document, and a
cross-Workspace selection.

## Implementation scope note (Phase 3, current)

The Phase 3 datasource slice currently implemented is **metadata-only**: it
resolves `assetRef` and emits versioned profiles from verified Workspace
metadata. It performs no source read, so `samples` is empty and
`coverage.sampled` is `false` in generated profiles.

The fixtures describe full Phase 3 discovery, where bounded samples exist and
`coverage.sampled` is `true`. Fixture expectations for samples are therefore
**not yet met**; they are the acceptance target for the bounded-sampling slice
(plan P3.7-P3.10, P3.12), which additionally needs the asset-fetch path, parser
dependencies and the sandboxed subprocess wrapper (P2.8). Generated profiles
are validated against `discovery-profile.schema.json` in
`tests/test_datasource_discovery.py`.

Cross-Workspace discovery requires an authoritative execution-time
authorization verifier (`SourceAuthorizationVerifier`). No NestJS client is
wired yet, so it fails closed and the payload's own grant claims are ignored.

## Current backend reality these contracts absorb (Phase 0 findings)

- `workspace.workspace_documents` has **no version history**; `contentHash` is
  MD5 and only set on backend-buffered uploads (presigned uploads leave it
  NULL). Until workspace versioning exists, `assetVersionId` must be derived
  from `contentHash` when present, otherwise from a semantic-owned observation
  fingerprint, and `sourceVersionVerification` must say so.
- Events available today (Mongo outbox → in-process dispatcher):
  `workspace.document.registered.v1`, `.artifact_ready.v1`,
  `.indexing_started.v1`, `.indexing_ready.v1`, `.indexing_failed.v1`,
  `.deleted.v1`. There are **no ACL-change or replace events**.
