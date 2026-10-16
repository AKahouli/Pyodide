# semantic-model-runtime contracts (v1)

Phase 0 captured contracts (plan P0.6). These are the cross-boundary shapes the
FastAPI runtime (Phase 2+) and the NestJS coordinator must agree on before any
heavy execution is enabled. They are frozen documentation-grade schemas until
Phase 2 generates the versioned OpenAPI document; Phase 2+ contract tests
validate fixtures in `tests/contracts/fixtures/` against these schemas.

Boundaries (plan §4.4): sample preview ≠ full coverage; exact text match ≠
business role; task success ≠ evidence completeness; a scope token is not an
authorization check.

## Runtime-owned AI extraction (current)

The executable request models and endpoints in `app/api/population_routes.py`
own the extraction contract; `app/datasource/attribute_extraction.py` owns the
non-secret profile and direct LiteLLM transport. Existing service authentication
and the 256 KiB command limit apply:

| Method / path | Contract |
| --- | --- |
| `GET /v1/semantic-model-population/ai-extraction/profile` | Runtime profile identity, excluding URL/key; unavailable configuration returns 503 |
| `POST /v1/semantic-model-population/ai-extraction/extract` | Bounded supplied evidence/attributes, optional bound identity and multiple-record mode; no document retrieval or persistence |

Population `aiExtraction` carries `{profileId, model, contractVersion, promptVersion,
maxTokens}` instead of an agent-library identity. It participates in existing
execution and extraction-cache fingerprints. Admission/worker execution reject
legacy or changed profiles explicitly; identity-free direct admission pins the
runtime profile only when no precomputed fingerprint was supplied. Extraction
values are candidates; document/cell/derived population readers enforce grounding
and type/choice checks before storing them. Sender/receiver coverage lives in
backend `semantic-runtime-client.service.spec.ts` and runtime
`tests/test_semantic_ai_runtime.py` / `tests/test_attribute_extraction_client.py`.

## Document field suggestions

`POST /v1/semantic-model-population/document-field-suggestions` is read-only
on the existing service-authenticated population router. Executable bounds and
response shaping live in `app/population/field_discovery.py`. The coordinator
requires model edit access, an enabled editable workspace link and a draft
concept, then resolves authoritative source metadata. The runtime reauthorizes
every asset for the acting user before reading indexed text or calling AI.

Discovery samples up to five documents and supplies AI with at most forty usable
blocks and 12,000 text characters per document, reporting unread files and
truncated coverage. Underlying source reads retain existing index closure limits. Quotes
must occur in supplied text. Only locally generated rules verified against every
complete, uncut sample are offered as deterministic; other grounded fields use
AI. File identity/name suggestions use metadata. The existing runtime-owned
profile handles inference; no database migration or new service is needed.

Proposals are reviewed in the document/workspace mapper before Apply. Apply uses
existing graph commands to autosave new fields and the reviewed concept purpose,
and prepares the selected mappings. The normal Save mapping command persists
those mappings after graph autosave completes. Existing field definitions remain
unchanged; an existing mapping is replaced only when explicitly selected.

## Captured datasource schemas

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
