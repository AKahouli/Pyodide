# ADR-010: Workspace Decision-Flow Artifacts

## Status

Accepted — 2026-07-14

## Decision

Workspace owns structured derived artifacts. The initial type is `decision_flow`, a
versioned JSON graph derived from exactly one PDF Workspace document. Its Workspace
placement is inherited from that source document and represents lineage, not an
independent classifier-folder assignment.

Decision flows are not Playbook flows. They may reuse the shared graph canvas and
layout libraries, but do not reuse Playbook persistence, APIs, execution, or runtime
semantics. Governance integration is deliberately deferred.

Generation is asynchronous and durable. The source PDF is attached to a single-agent
task with a persisted selection. In version 1, page restrictions are prompt-enforced;
the original file is not physically sliced. This preserves the selection needed for a
future hard page-extraction implementation.

## Consequences

- Deleting a source document is blocked when it has derived artifacts unless an
  explicit cascade is requested.
- The persisted artifact payload is validated on generation, edits, and cloning.
- No generated graph is executable merely because it is stored.
