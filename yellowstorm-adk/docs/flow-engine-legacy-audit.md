# Flow Engine Legacy Reachability Audit

Date: 2026-08-09 UTC

This audit is intentionally separate from Guardrails hardening. It records the
current repository state and does not claim that persisted legacy executions can
be discarded.

| Module | Production reachability | Test reachability | Replacement | Decision |
| --- | --- | --- | --- | --- |
| `src/flow_engine/legacy/graph_builder.py` | No live static importer was found. The module imports missing siblings (`state`, `checkpointer`, `step_executor`, and `port_resolution`), so it is not importable from a clean checkout. | No direct source test importer was found. | Current execution uses `src/flow_engine/builder` and `src/flow_engine/agent_runtime`. | `KEEP_COMPATIBILITY` |
| `src.flow_engine.legacy_runtime` | The module is absent, but public methods in `src/grpc_server/chatbot_servicer.py` dynamically import it for legacy workflow and step RPCs. | No executable source module exists to characterize. | Current playbooks use `src/flow_engine/grpc_service.py`. | `UNKNOWN_REQUIRES_INVESTIGATION` |

## Dynamic And Persisted Reachability

- `RunPlaybookWorkflow`, `ResumePlaybookWorkflow`, `StopPlaybookWorkflow`,
  `RunStep`, `RunStepStream`, and `ResumeStep` in
  `src/grpc_server/chatbot_servicer.py` dynamically import the absent
  `src.flow_engine.legacy_runtime` module.
- Static zero-import results are therefore not sufficient evidence for deletion.
- The repository contains ignored `__pycache__` artifacts for former legacy
  modules. They are not source-of-truth implementations and are not a supported
  compatibility mechanism.
- No schema migration, expiry policy, or explicit non-resumability decision was
  found for persisted executions that might reference former node/state shapes.

## Guardrails Disposition

No file under `src/flow_engine/legacy/` is deleted by Guardrails hardening.
Deletion requires a separate compatibility decision covering public legacy RPCs,
persisted checkpoints, and the missing runtime modules.
