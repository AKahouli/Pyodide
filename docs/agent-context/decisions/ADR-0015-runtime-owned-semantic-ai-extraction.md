---
id: ADR-0015
status: accepted
scope: semantic-runtime-ai-ownership
source_paths:
  - YellowStorm/semantic-model-runtime/app/datasource/attribute_extraction.py
  - YellowStorm/semantic-model-runtime/app/datasource/extraction_prompt.py
  - YellowStorm/semantic-model-runtime/app/api/population_routes.py
  - YellowStorm/semantic-model-runtime/app/workers/population_tasks.py
  - YellowStorm/back/src/modules/semantic-model/services/semantic-runtime-client.service.ts
  - yellowstorm-adk/main.py
reviewed_at: 2026-10-15
---

# Runtime-owned semantic AI extraction

## Context and approval

Semantic population previously sent document/cell evidence from the runtime to
a NestJS internal extraction bridge, which resolved an admin-managed agent and
called the ADK semantic-model endpoint. The extraction implementation already
used LiteLLM directly; ADK orchestration was not necessary. This distributed
semantic-domain prompts, credentials and job identity across three services.

The user required autonomous semantic-runtime AI inference, removal of semantic
extraction dependencies from ADK, and approved the concrete migration and this
ADR on 2026-10-15: “ok go and you can add an ADR in the doc related to this”.
This accepts the ownership decision; it does not authorize deployment or claim
that a live gateway has been verified.

## Decision

Extend the existing semantic runtime datasource package and population API;
introduce no additional microservice, module or database schema.

- The runtime owns extraction prompts, response shaping, LiteLLM configuration,
  retries, bounded asynchronous concurrency and extractor/profile versioning.
  Runtime API inference and population workers call the gateway directly.
- Document, spreadsheet-cell and derived-field readers retain their existing
  grounding, typed-value checks, provenance, gap reporting and extraction caches.
- NestJS retains product authorization, mappings and job coordination. It obtains
  the runtime's non-secret extraction identity when constructing AI requests; it
  neither resolves a default extraction agent nor proxies inference to ADK.
- Remove ADK's semantic extraction package, dedicated router and settings, and
  the backend extraction bridge/default-agent bootstrap. Generic ADK document
  extraction and generic MCP consumption are separate capabilities.
- Keep embedding and generative extraction profiles independent. Backend asset
  access remains a datasource dependency, not an inference dependency.

Authenticated profile discovery and standalone supplied-evidence inference use
the existing population router/service guard. Executable request bounds, identity
fields and response behavior are owned by the source and
[runtime contracts guide](../../../YellowStorm/semantic-model-runtime/contracts/v1/README.md).
Standalone inference returns candidates; population readers perform stronger
value-to-evidence grounding before persistence.

## Configuration and compatibility

API and population workers receive the same deployment-owned `SEMANTIC_AI_*`
configuration documented in the
[runtime README](../../../YellowStorm/semantic-model-runtime/README.md).
Secrets and gateway URLs are excluded from profile responses/job payloads.
The configured model must support OpenAI-compatible JSON-object chat completions;
unsupported JSON parameters fail closed without automatic fallback.

Runtime profile identity includes the effective model, contract/prompt versions
and response token cap. Existing execution fingerprints and extraction cache
keys include that identity. Transport timeout/concurrency are pacing controls and
do not change semantic answer identity. Operators must treat model aliases as
stable semantic identities and change the configured identity when their model
meaning changes.

Admission pins the runtime identity for AI requests that omit it and do not
supply a precomputed execution fingerprint. Backend-coordinated requests bind it
before fingerprinting. Workers validate it before fetching sources or consulting
extraction caches. Legacy `agentSlug` or changed profiles produce explicit
rebuild-required failures rather than silently executing different inference.

Deploy backend, runtime API and population workers together; resubmit incompatible
queued AI jobs. Existing stored revisions, historical extraction results and old
agent-library rows are preserved. Runtime v2 identities do not reuse v1 extraction
cache entries. Rollback is coordinated across those processes and job identities;
no database migration is required.

## Rationale and consequences

This removes two unnecessary inference hops and lets the semantic microservice
execute supplied-evidence extraction without backend or ADK availability. It
reuses the existing runtime HTTP stack, worker lifecycle and storage contracts.
The runtime now needs its own gateway credentials and the same extraction profile
on all execution processes. Model selection moves from the backend agent library
to runtime deployment configuration; changing it requires a consistent rollout.

This supersedes the descriptive backend/ADK semantic extraction ownership in the
older architecture documentation. No prior accepted ADR defining that inference
boundary was identified; existing accepted ADRs remain unchanged.

## Verification

Source baseline: `d32b7839a`, integrated against `e9ef1676c` on
`baseline/semantic-model-001`, plus the scoped implementation diff.

- Backend: 200 focused service cases and `npm run build` passed.
- Runtime: focused direct-transport/API, grounding, document/cell/derived,
  admission, worker and fingerprint tests passed. Additional worker/fingerprint/
  derived/concept-refresh/jobs suite: 79 passed.
- Required scoped review: PASS, no critical/major findings. JSON-mode compatibility
  prerequisite is documented and unsupported-parameter failure behavior tested.
- API inference was exercised with a controlled LiteLLM transport without backend,
  ADK or database configuration. Invalid identities were checked before cache,
  fetch and metadata access. This does not establish live provider compatibility.
- A pre-existing stale deterministic derivation fingerprint assertion was corrected
  only after reproducing the same actual hash from the original HEAD functions.

No frontend implementation changed; existing UI/AGE evidence elsewhere does not
constitute live verification of this inference migration.
