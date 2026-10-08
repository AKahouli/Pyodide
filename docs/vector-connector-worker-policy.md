# Connector worker access — 2026-10-05

Implemented the approved UI defaults: connector worker access ON, ordinary tools inherit Allowed. Administrators can override individual tools with Inherit/Allow/Block, search a large catalog, and show exceptions. The default tool behavior can require explicit classification instead. Existing explicit unknown classifications remain blocked until the administrator adopts the connector default in one bulk operation; known orchestration is preserved.

The settings are in Admin → Connectors → Edit → Use by delegated workers. Agent connector configuration shows the selected tool count permitted by worker policy, qualified by existing access and Root limits. English/French strings and accessible labels are included.

## Boundaries

- Worker policy is trusted catalog administration. MCP discovery preserves existing overrides and cannot overwrite them with remote annotations.
- Authentication, action selections, workspace ceilings, read/write guards and native worker identity checks remain separate.
- Known platform Playbook execution, generation, construction, clarification, assessment and optimization entry points, plus agent creation/delegation operations, cannot become leaf tools even if relabelled. Current workers are depth-one leaves; their Launch other agents switch is disabled and OFF. Nested-agent execution is not implemented by this change.
- An opaque remote service is one external tool effect. Vector cannot account for agents hidden inside that service. Ordinary inherited tools are trusted by connector policy, not automatically proven safe.
- Connector policy/action changes lock the connector row and invalidate attached agent definition timestamps in the same transaction. No-op saves preserve attached agent timestamps.
- Catalog export/import retains worker policy and per-tool restrictions, with validation of the added fields.

## Executed checks

- Backend production TypeScript PASS; final Nest build/runtime proto copy PASS.
- Backend targeted five suites47PASS, then expanded reserved-key policy21PASS and latest catalog transfer5PASS. These overlap; do not add their counts as distinct tests.
- Real isolated PostgreSQL connector default/readback/atomic fencing/no-op regression1PASS20.128s. Initial fixture missed an agent-type foreign key; corrected by creating and cleaning its own type.
- Frontend TypeScript PASS; connector dialog8PASS; worker settings200-tool cases2PASS; agent connector fields2PASS.
- Native mandatory leaf/compiler15PASS22.50s.
- Reviewer PASS after blocking all verified platform inference entry points and preserving transfer policy; final no-op store refinement reviewer PASS.
- Primary live existing Chrome3tab817982231: ON/eight inherited Allowed, OFF inheritance, single-tool Block exception, keyboard Return opens menu, restore, Save/reopen confirms ON/eight Allowed. Mobile390px DOM geometry: section314px/selects304px, no horizontal overflow; viewport restored. Frontend-QA fallback PASS within this coverage (specialized QA model unavailable).
- Screenshot docs/vector-worker-policy-desktop.jpg is cropped partial evidence only; screenshot coordinate mismatch prevents claiming full desktop/mobile visual proof. No new browser session/tab opened.

## Local deployment

Applied only additive0047_connector_worker_policy.sql to agentstore (SHA2569bd474fb96c58986a37721cda8abfecb1b2352db7929a4822956b4190d8aeabf), defaults ON for37 existing connectors. No new migration watermark recorded, because an older unrelated semantic-model migration remains pending; later authorized journal replay can safely reapply this idempotent migration. Do not use this task to apply the unrelated migration.

Vector backend/ADK restarted with matching service authentication, background/capacity flags explicitly false; backend3002/ADK8003/MCP8025 readiness200. Latest no-op timestamp refinement build passed, and the backend was restarted again to include it; final backend readiness200. Original governed Root live background observation/sandbox qualification remains separate and incomplete.

Graph tools and Obsidian vault tools unavailable; focused source retrieval and this repository evidence used. Preserve the unrelated uncommitted rollout-proposal edit.
