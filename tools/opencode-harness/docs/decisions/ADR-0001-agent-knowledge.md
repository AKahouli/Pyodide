---
id: ADR-0001
status: accepted
scope: agent-harness
source_paths:
  - AGENTS.md
  - docs/agent-context/**
reviewed_at: 2026-10-12
---

# Git knowledge and per-interaction experience

## Decision

Store approved engineering decisions, contracts, invariants, and workflow guidance in reviewed Git documentation. Use `docs/agent-context/README.md` to route agents to the relevant record by path and interface. Keep executable code and tests authoritative for current behavior and use the code graph for implementation relationships.

Capture every OpenCode user interaction in a local, per-repository Hindsight experience bank. Give a brief visible experience follow-up after every reply. Experience can suggest a documentation change but cannot approve or silently replace a Git record.

## Rationale

Git records have review history and stable links. Per-interaction memory preserves attempts and outcomes without filling the repository with transcripts. Path-based retrieval reads only the records relevant to the current task.

## Verification

For a sample frontend task and a cross-service contract task, confirm that the agent reads the matching index entries, checks source and both sides of a boundary where relevant, and cites the record used. Send several consecutive messages and confirm each interaction is retrievable from the same repository experience bank in a new OpenCode session.
