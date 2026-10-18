---
id: HADR-0002
status: proposed
scope: hindsight-experience-quality
source_paths:
  - tools/opencode-harness/config/hindsight.example.json
  - tools/opencode-harness/setup-config.mjs
reviewed_at: 2026-10-18
---

# Recall durable lessons separately from historical task progress

The user requested recovery of failed/pending memory work, useful lesson recall,
a 1,500-token recall budget and evaluation of the actual OpenCode integration.

## Implemented policy for review

Keep per-interaction transcript capture. Extract the fewest durable facts that
preserve causes, successful remedies, applicability, verification limits, settled
decisions and stable preferences. Exclude transient task status and secrets.
Current progress belongs in checkpoints; memory never establishes current QA or
runtime success. Source and reviewed Git decisions remain authoritative.

Tag new capture with `memory:durable-v1`; consolidate into that same tag scope.
Default recall searches that scope across world/experience/observation facts,
prefers observations over their duplicate source facts, and requests at most
1,500 tokens. Old records remain available outside default recall. Seed only a
small set of source-checked lessons; record that curation when evaluating them.
Verify recalled identifiers before edits: extraction can alter paths.

The current local daemon uses the `rrf` ranker, whose rank-position scores do not
measure relevance. Semantic/keyword floors are calibrated at 0.84/0.4 for the
current embedding model. Disable graph/temporal expansion in this bank because
those retrieval arms bypass those floors. This favors precise reuse and honest
misses; broad historical/relationship search becomes less comprehensive. Recheck
the cutoffs after embedding/ranking changes or observed misses. The separate
code-review graph is unaffected.

Use native settings and APIs. The installer backs up bank configuration, applies
policy idempotently and verifies it. Failed work is retried after its cause is
resolved; clear obsolete backoff only on verified pending operations. Preserve
operations and source documents instead of deleting failures to make counts green.
Active parallel sessions may keep producing new pending work.

## Evaluation limits

Compare raw recall with candidate policies before selecting them. Report curated
retrieval separately from unseen questions, and retrieval latency separately from
agent task completion time. Do not infer general productivity improvements from
a small test set or treat accepted retry requests as completed recovery.

See [the evaluation](../HINDSIGHT-EVALUATION.md) for measured results and gaps.
