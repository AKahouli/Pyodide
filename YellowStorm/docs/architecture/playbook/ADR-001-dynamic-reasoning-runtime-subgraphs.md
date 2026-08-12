# ADR-001: Dynamic Reasoning Uses Execution-Scoped Subgraphs

## Status

Accepted, behind `PLAYBOOK_DYNAMIC_REASONING_ENABLED`.

## Decision

Dynamic Reasoning is a capability of canonical `step` nodes. The saved Playbook remains immutable during execution. After required inputs resolve, the Playbook Planner may choose direct execution or propose a bounded task-only DAG with mandatory synthesis.

Only a deterministically validated accepted revision may execute or reach the canvas. Generated node identity is namespaced as `<parentNodeId>::dynamic-reasoning::<subgraphId>::<localNodeId>`. Generated nodes inherit the parent agent scope, cannot recursively enable Dynamic Reasoning, and never enter autosave or canonical serialization.

The parent remains the public contract. Downstream canonical nodes receive only its synthesized output. Direct and subgraph decisions, policy/planner snapshots, revisions, validation issues, topology, and child results are persisted for audit and reconnect recovery. Public traces contain concise rationale and diagnostics, never private chain-of-thought.

## Rollback

Disable `PLAYBOOK_DYNAMIC_REASONING_ENABLED`. New executions use the existing direct path. Active accepted subgraphs complete or cancel through normal execution controls, and historical attempts remain readable.
