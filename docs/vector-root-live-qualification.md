# Vector Root live qualification — 2026-10-05

User approved the bounded rollout proposal with “go”. Background/capacity enablement, new profiles/scope and live observation have not yet been applied.

## Applied prerequisites

- Applied only approved migrations0044/0045 to `agentstore`, in one transaction with5s lock timeout and an advisory serialization lock. Current SQL SHA256 matched the proposal. Verified background control singleton1, action/event/job tables, capacity slots30 and occupied slots0.
- Preflight found historical Drizzle rows for0044/0045 with unrelated hashes although their tables were absent. Git history does not match those hashes. Preserved both rows; appended corrective records with exact approved hashes and original timestamps. Did not run the general migration command or apply pending0042_yellowmind_semantic_model_chat.
- Recorded existing file-level runtime flags in TEMP/vector-meta-python312/live-root-runtime-baseline.json. Configured matching backend CONVERSATION_GRPC_API_KEY/native GRPC_API_KEY through local env files without exposing values. No background/capacity flag changed. Services restarted with matching authentication and background/capacity disabled.
- Latest production backend build and runtime proto copy PASS.

## Capability gate

Smart Navigation Search catalog has eight enabled actions with safety=read, executionKind absent. Backend serializes unknown; native trusted leaf gate blocks unknown. Existing source supports seven matching read/navigation handlers. Local server exposes search_sections, while catalog uses search_in_sections; actual connected-server tool-list inspection remains required before classification. No prompt or read-safety inference overrides the execution gate.

User requested simpler explanation of proposed catalog classification and a new question was issued. Superseded by the user-approved connector-level UI policy, ON/default ordinary tools Allowed. Actual remote tool listing confirms all eight catalog keys (adjacent local checkout differed). Worker policy shipped and Smart Navigation Search saved/reopened with eight inherited Allowed; no auth/grant expansion. See vector-connector-worker-policy.md.

## Browser

Reused existing Chrome3 tab817982221 at localhost5175 agents. Browser reconnect PASS; no new tab/session opened.

## Remaining

Verify live connector declarations/classification; activate two private bounded profiles/separate restricted scope; restart qualified vector services; actual governed native/background UI, reload/reconnect/Stop and30minute observation; restore recorded flags and deactivate only qualification resources. Sandbox writes require a concrete disposable target separately. Qualification remains incomplete.
