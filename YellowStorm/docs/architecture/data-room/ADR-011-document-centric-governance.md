# ADR-011: Document-Centric Governance

## Status

Accepted - 2026-07-30

Supersedes ADR-002.

## Context

The governance source aggregate duplicated identity, technical state, and version state
already owned by Workspace documents. That duplication allowed governance and indexing
records to disagree about the same artifact.

## Decision

`WorkspaceDoc` is the artifact and indexing authority. `GovernanceWorkspaceBinding`
defines which workspaces a program or scope can govern. `GovernanceDocument` stores the
per-program overlay keyed uniquely by `(programId, documentId)`, including lifecycle,
validity, ownership, tags, and governance metadata.

Governance events and Knowledge Intelligence records identify the Workspace document by
`documentId`. Deployment revisions select workspace bindings through `workspaceIds` and
`workspaceBindingSnapshot`; they do not snapshot governance source IDs.

## Consequences

- Content updates do not create a second governance identity or immutable source version.
- Artifact availability and indexing state remain Workspace concerns.
- Governance lifecycle and validity remain program-specific overlay concerns.
- Editable overlay operations require the caller's expected governance revision and fail
  with a conflict rather than overwriting concurrent changes.
- Visibility and deployment scope are workspace-granular. Per-document deployment
  inclusion or exclusion is no longer represented.
- Runtime application code does not read legacy source collections.

## Migration And Rollback

The migration is dry-run by default and blocks unresolved documents, duplicate overlays,
candidate/published document conflicts, missing artifacts, and workspace mismatches.
It migrates workspace bindings, overlays, events, Knowledge Intelligence records,
permissions, and deployment revisions. Legacy source visibility is combined per
program/workspace, preserving program-shared visibility or the union of scope IDs. For
revisions, effective legacy source selection is translated as
`(sourceIds union includedSourceIds) minus excludedSourceIds`, then reduced to workspace
IDs. Legacy source fields are removed from revisions.

Legacy source collections are retained during the rollback window and are not rewritten
or dropped by the migration. Migration reports provide conflict and count evidence.

## Operations

Run `migrate-governance-sources-to-documents.ts` in dry-run mode and resolve every
reported conflict before `--apply`. Run `verify-document-governance-migration.ts` after
application; any duplicate overlay, missing artifact, legacy Knowledge Intelligence
reference, or legacy deployment-revision reference fails verification.
