# Changelog

## [2026-04-23 00:00 UTC] — Add webapp backend guidelines documentation

- **Feature:** `webapp-backend`
- **Type:** `docs`
- **Changed:** Added a new backend-guidelines feature README derived from `YellowStorm/back/BACKEND_GUIDELINES.md`, and registered the new slug in the documentation index.
- **Why:** The repository needed a dedicated maintainer-owned documentation entry for the backend coding guidelines so the backend contract and conventions are easy to find.
- **Impact:** `docs/webapp-backend/README.md`, `docs/DOC_INDEX.md`
- **Readme:** `/docs/webapp-backend/README.md`

## [2026-04-22 00:00 UTC] — Add backend developer OpenCode agent

- **Feature:** `opencode-agents`
- **Type:** `feat`
- **Changed:** Replaced the placeholder backend guidelines file with a proper project-local `backend-developer` subagent, allowed `build` to delegate to it in `opencode.json`, and updated repository workflow documentation to describe the new backend implementation role.
- **Why:** Backend-heavy tasks in `YellowStorm/back` needed a dedicated implementation specialist that stays distinct from diagnostics, review, and cross-service coordination handled by `build`.
- **Impact:** `.opencode/agents/backend-developer.md`, `opencode.json`, `AGENTS.md`, `docs/opencode-agents/README.md`, `docs/DOC_INDEX.md`
- **Readme:** `/docs/opencode-agents/README.md`

## [2026-04-22 00:00 UTC] — Add node template library

- **Feature:** `node-template-library`
- **Type:** `feat`
- **Changed:** Added a DB-backed playbook node template library with lazy-seeded built-in templates, admin CRUD endpoints, a public enabled-only runtime endpoint, frontend runtime template loading, and admin UI management.
- **Why:** Replace the hardcoded static template registry with a configurable data source that can be managed in Admin > Playbook and consumed by the canvas at runtime.
- **Impact:** `YellowStorm/back/src/modules/playbook/schemas/playbook-node-template.schema.ts`, `YellowStorm/back/src/modules/playbook/interfaces/playbook-node-template.interface.ts`, `YellowStorm/back/src/modules/playbook/dto/create-playbook-node-template.dto.ts`, `YellowStorm/back/src/modules/playbook/dto/update-playbook-node-template.dto.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-node-template.service.ts`, `YellowStorm/back/src/modules/playbook/controllers/admin-playbook-node-templates.controller.ts`, `YellowStorm/back/src/modules/playbook/controllers/playbook-node-templates.controller.ts`, `YellowStorm/back/src/modules/playbook/playbook.module.ts`, `YellowStorm/front/src/modules/playbook/types.ts`, `YellowStorm/front/src/modules/playbook/store.ts`, `YellowStorm/front/src/modules/playbook/api.ts`, `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasFloatingToolbar.tsx`, `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`, `YellowStorm/front/src/modules/admin/pages/PlaybookPromptsPage.tsx`, `YellowStorm/front/src/modules/admin/types.ts`, `YellowStorm/front/src/modules/admin/api.ts`, `YellowStorm/front/src/lib/api/config.ts`, `YellowStorm/front/src/modules/admin/locales/en.json`, `YellowStorm/front/src/modules/admin/locales/fr.json`
- **Readme:** `/docs/node-template-library/README.md`

## [2026-04-22 00:00 UTC] — Harden backend CORS origin parsing

- **Feature:** `connectors`
- **Type:** `fix`
- **Changed:** Normalized backend `CORS_ORIGIN` parsing in `YellowStorm/back/src/main.ts` to trim comma-separated origins and discard empty values before passing them to NestJS CORS configuration.
- **Why:** Prevent malformed runtime CORS origin lists from producing inconsistent credentialed cross-origin responses during frontend auth requests.
- **Impact:** `YellowStorm/back/src/main.ts`
- **Readme:** `/docs/connectors/README_2026-04-14_23-00-00.md`

## [2026-04-22 00:00 UTC] — Harden chart payload parsing

- **Feature:** `conversation`
- **Type:** `fix`
- **Changed:** Hardened chart payload parsing in `YellowStorm/front/src/modules/conversation/utils.ts` so malformed chart `series` payloads are normalized safely instead of calling `.map` on non-arrays; added a regression test in `YellowStorm/front/src/components/ai-elements/ai-message-content.chart.test.tsx`.
- **Why:** Malformed chart payloads could crash the frontend with `s.map is not a function` during AI message rendering.
- **Impact:** `YellowStorm/front/src/modules/conversation/utils.ts`, `YellowStorm/front/src/components/ai-elements/ai-message-content.chart.test.tsx`
- **Readme:** `/docs/conversation/README.md`

## [2026-04-22 00:00 UTC] — Harden playbook node template normalization

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Hardened playbook node template normalization in `YellowStorm/front/src/modules/playbook/store.ts` so malformed node-template payload arrays are normalized safely instead of calling `.map` on non-arrays.
- **Why:** Malformed node-template payloads could crash the frontend with `s.map is not a function` during playbook store processing.
- **Impact:** `YellowStorm/front/src/modules/playbook/store.ts`
- **Readme:** `/docs/playbook/README.md`

## [2026-04-22 00:00 UTC] — Add frontend developer OpenCode agent

- **Feature:** `opencode-agents`
- **Type:** `feat`
- **Changed:** Added a new project-local `frontend-developer` subagent, allowed `build` to delegate to it in `opencode.json`, and updated repository workflow documentation to describe the new frontend implementation role.
- **Why:** Frontend-heavy tasks in `YellowStorm/front` needed a dedicated implementation specialist that stays distinct from read-only browser QA.
- **Impact:** `.opencode/agents/frontend-developer.md`, `opencode.json`, `AGENTS.md`, `docs/opencode-agents/README.md`, `docs/DOC_INDEX.md`
- **Readme:** `/docs/opencode-agents/README.md`

## [2026-04-22 00:00 UTC] — Document mail-trigger auto-renew cutoff

- **Feature:** `playbook`
- **Type:** `docs`
- **Changed:** Updated the playbook README with a factual note about the `autoRenewUntil` mail-trigger cutoff and refreshed the documentation index entry for the playbook slug.
- **Why:** The feature was implemented in the backend and frontend and needed matching maintainer documentation for the existing playbook feature area.
- **Impact:** `docs/playbook/README.md`, `docs/DOC_INDEX.md`
- **Readme:** `/docs/playbook/README.md`

## [2026-04-22 00:00 UTC] — Scope playbook execution UI to the active route

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Scoped execution history and current-execution rendering to the active playbook route in the frontend. The store now keeps per-playbook execution history alongside the global cache, and the execution panel, history dropdown, playbook canvas, execution page, designer panel, and interrupt dialog now ignore foreign executions when their route playbook id does not match.
- **Why:** A streaming execution from playbook A could surface in playbook B's results UI after navigation, which made the active panel show the wrong execution state.
- **Impact:** `YellowStorm/front/src/modules/playbook/store.ts`, `YellowStorm/front/src/modules/playbook/types.ts`, `YellowStorm/front/src/modules/playbook/components/ExecutionPanel.tsx`, `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`, `YellowStorm/front/src/modules/playbook/components/PlaybookExecutionPage.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionHistoryDropdown.tsx`, `YellowStorm/front/src/modules/playbook/components/PlaybookDesignerPanel.tsx`, `YellowStorm/front/src/modules/playbook/components/InterruptDialog.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionPanel.test.tsx`.

## [2026-04-21 21:05 UTC] — Condition mail-trigger auto-renewal on user-selected expiration date

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Added `autoRenewUntil` to the mail trigger config across frontend and backend. Users can now select a date in the trigger panel after which Microsoft 365 subscription auto-renewal stops. The Graph client clamps `expirationDateTime` to the earlier of the 45-minute Graph window and the user cutoff. The renewal cron skips playbooks whose cutoff has passed. The sync-subscription endpoint rejects past cutoffs with a 400 error. Frontend date handling uses local calendar semantics to avoid timezone off-by-one issues.
- **Why:** Previously, mail-trigger subscriptions renewed indefinitely, which could lead to unwanted ongoing webhook costs and execution noise. Users need control over how long the automation remains active.
- **Impact:** `YellowStorm/back/src/modules/playbook/schemas/playbook.schema.ts`, `YellowStorm/back/src/modules/playbook/interfaces/playbook.interface.ts`, `YellowStorm/back/src/modules/playbook/dto/upsert-playbook-mail-trigger.dto.ts`, `YellowStorm/back/src/modules/playbook/dto/sync-playbook-mail-subscription.dto.ts`, `YellowStorm/back/src/modules/playbook/services/playbook.service.ts`, `YellowStorm/back/src/modules/playbook/controllers/playbook.controller.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-mail-graph-client.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-mail-subscription-renewal.service.ts`, `YellowStorm/front/src/modules/playbook/types.ts`, `YellowStorm/front/src/modules/playbook/components/schedule/PlaybookScheduleSheet.tsx`, `YellowStorm/front/src/modules/playbook/locales/en.json`, `YellowStorm/front/src/modules/playbook/locales/fr.json`, and corresponding test files.

## [2026-04-18 20:57 UTC] — Forward mail trigger context into single-step runs

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Extended the playbook gRPC step contract to carry `trigger_context`, converted backend trigger payloads into protobuf `Struct` form for both full-workflow and single-step requests, and wired ADK single-step execution to pass trigger context through to port resolution.
- **Why:** Steps rerun or executed individually from a mail-triggered execution were losing the trigger payload before reaching the ADK, so input ports linked to the Mail Trigger node resolved as empty even though the graph mapping was correct.
- **Impact:** `YellowStorm/back/src/modules/conversation/proto/chatbot.proto`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.spec.ts`, `yellowstorm-adk/grpc/proto/chatbot.proto`, `yellowstorm-adk/src/grpc_generated/chatbot_pb2.py`, `yellowstorm-adk/src/grpc_generated/chatbot_pb2_grpc.py`, `yellowstorm-adk/src/grpc_server/chatbot_servicer.py`, `yellowstorm-adk/src/langgraph_engine/step_executor.py`, and `yellowstorm-adk/src/langgraph_engine/workflow_service.py`.

## [2026-04-18 19:53 UTC] — Align playbook tool scope with resolved port documents

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Updated the ADK playbook runtime so `build_tool_scope()` now includes document ids resolved from upstream document artifacts and trigger-provided document inputs, not only explicit `input_files_by_port` bindings.
- **Why:** Tool access needed to match the prompt contract and actual resolved port inputs, especially for filtered search and mail attachment flows.
- **Impact:** `yellowstorm-adk/src/langgraph_engine/port_resolution.py` and focused LangGraph runtime tests.

## [2026-04-18 19:37 UTC] — Tighten playbook prompt input context

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Made resolved input ports the canonical task-prompt input contract in the ADK runtime, introduced a derived prompt-ready input context structure, and stopped adding duplicate legacy dependency or trigger narration when a task already has bound port inputs.
- **Why:** Downstream task prompts were mixing raw execution state with prompt formatting, which made structured inputs harder for the LLM to parse and could duplicate the same upstream context in multiple forms.
- **Impact:** `yellowstorm-adk/src/langgraph_engine/port_resolution.py`, `yellowstorm-adk/src/langgraph_engine/graph_builder.py`, and focused LangGraph runtime tests.

## [2026-04-18 06:00 UTC] — Mail trigger v1 complete: runtime, attachments, renewal, UI activation

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Completed the end-to-end mail trigger pipeline: Graph webhook notification → message fetch → dedupe → filter match → attachment import → handoff → playbook execution. Added subscription renewal automation (cron every 10 min), subscription deletion on trigger disable, user-controlled attachment import toggle with allowed-extensions filter, inbox-only subscription scope to prevent duplicate notifications, human-readable mail trigger context in ADK LLM prompts, formalized `trigger_context` proto field with regenerated gRPC stubs, activated the frontend trigger UI (removed "coming soon" messaging, added live subscription status indicators), and comprehensive regression tests (38 tests across 9 suites).
- **Why:** The mail trigger feature needed a production-ready runtime path from inbox to execution, with proper lifecycle management, user controls, and full test coverage before moving to the next phase.
- **Impact:** Graph client (subscription CRUD, attachment list/download, renewal, delete), webhook service (post-dedupe attachment import, extension filtering, per-notification error isolation), subscription renewal cron service, playbook schema (attachmentImportEnabled, allowedAttachmentExtensions), proto files (trigger_context field), Python gRPC servicer (_struct_to_dict), ADK prompt builder (mail-specific trigger formatting), frontend UI (live status, attachment toggle, extension input), backend tests (19 new/updated tests), i18n (en/fr).

## [2026-04-17 15:35 UTC] — Wire Graph webhook ingress basics

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Added a Microsoft Graph mail client, owner-triggered subscription sync route, public webhook controller/service, persisted mail-trigger subscription metadata, and client-state verification before normalizing real mailbox notifications into the existing trigger pipeline.
- **Why:** The playbook mail-trigger feature needed a real simple-message Microsoft 365 delivery path beyond the synthetic test-event ingress.
- **Impact:** New Graph client/webhook services/controllers, playbook mail trigger runtime metadata, and backend tests for Graph fetch and webhook processing.

## [2026-04-17 15:00 UTC] — Add synthetic mail trigger test ingress

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Added an owner-only `POST /playbooks/:id/triggers/mail/test-event` route plus a small facade service that normalizes a synthetic email payload, runs the mail trigger orchestration pipeline, and hands matched events off into execution creation.
- **Why:** The inbox-trigger feature needed an immediate end-to-end validation path for simple emails before Microsoft Graph webhook delivery is implemented.
- **Impact:** New playbook mail test-event DTO/service/controller wiring and backend tests covering the synthetic trigger route.

## [2026-04-17 14:25 UTC] — Forward trigger context into executions

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Added persisted execution `triggerContext`, propagated mail-trigger context into execution creation and handoff, and forwarded `trigger_context` into the full-workflow gRPC request contract.
- **Why:** Mail-triggered playbook runs need a structured runtime payload channel before trigger nodes and attachment staging can consume inbound email context safely.
- **Impact:** Playbook execution schema/service contracts, mail trigger handoff, ADK playbook request schema, and execution trigger tests.

## [2026-04-17 14:05 UTC] — Add mail trigger execution handoff

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Added idempotent handoff from matched mail-trigger ledger rows into standard playbook execution creation, introduced `executionTrigger: 'mail'`, and persisted `executionId` back onto handed-off ledger rows.
- **Why:** The inbox-trigger pipeline needs a safe bridge from matched inbound events into the existing playbook execution engine without creating duplicate executions under concurrent delivery.
- **Impact:** Playbook execution trigger contracts, mail trigger handoff service, dedicated ledger schema/status transitions, and backend execution/trigger tests.

## [2026-04-17 13:35 UTC] — Harden mail ledger storage

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Moved playbook mail-event ledger storage from embedded playbook documents to a dedicated collection with a unique `(playbookId, dedupeKey)` index, and updated mail-trigger ingestion/orchestration to use collection-backed dedupe and status updates.
- **Why:** The inbox-trigger feature must tolerate concurrent inbound mail bursts across many users without unbounded playbook document growth or duplicate-trigger races.
- **Impact:** New playbook mail-event ledger schema/model, refactored ingestion/orchestration services, and backend tests for collection-backed dedupe.

## [2026-04-17 13:10 UTC] — Add mail event ledger foundation

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Added normalized inbound mail event and mail-event ledger contracts plus a dedicated ledger service with stable dedupe-key generation for future playbook mail-trigger ingestion, without enabling webhook handling or execution.
- **Why:** The inbox-trigger runtime needs a stable persistence and deduplication boundary before mailbox events can safely create playbook runs.
- **Impact:** Playbook mail trigger shared interfaces, playbook schema, playbook module services, and new ledger service tests.

## [2026-04-17 12:50 UTC] — Persist playbook mail trigger config

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Added a persisted mail-trigger configuration model and owner routes for playbooks, wired the trigger panel to edit/save basic mailbox filters, and kept runtime execution explicitly disabled through a `runtimeEnabled: false` contract.
- **Why:** The trigger UI and API need a real mail configuration surface before inbound mailbox events and trigger-node execution can be implemented safely.
- **Impact:** Playbook schema/interfaces/controllers/services, frontend trigger panel/types/api/store, and playbook trigger tests/locales.

## [2026-04-17 10:05 UTC] — Add mailbox capability foundation

- **Feature:** `connectors`
- **Type:** `feat`
- **Changed:** Added a reusable Microsoft 365 mailbox capability check on top of existing connected-app user connections, exposed it through `GET /connected-apps/mailbox-capability`, and wired playbook mail-trigger availability to that readiness signal instead of a hardcoded placeholder.
- **Why:** Future conversation mail tools and playbook mail triggers need a shared, scope-aware mailbox foundation without introducing a second OAuth connection model.
- **Impact:** Connected-app token/controller/interfaces, playbook trigger availability derivation, and mailbox readiness tests.

## [2026-04-17 09:00 UTC] — Add playbook trigger abstraction

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Added trigger-oriented playbook contracts and endpoints that expose `manual` as the default trigger plus `schedule` as the current automated trigger, while updating the frontend schedule entry points to a `Triggers` panel and trigger-specific routes without changing the underlying schedule runner/storage.
- **Why:** The playbook feature needs an extensible trigger model for future automation sources such as inbound mail, while keeping the existing schedule implementation stable during the first rollout.
- **Impact:** Backend playbook controller/service/interfaces, frontend playbook API/types/toolbar/card/canvas trigger entry points, and playbook locale strings.

## [2026-04-17 00:15 UTC] — Connector editor UX improvements

- **Feature:** `connectors`
- **Type:** `feat`
- **Changed:** Replaced manual key entry with a connected-app selector; runtime auth config now uses structured `authStrategy`, `authHeader`, and `authEnv` fields instead of raw JSON entry; auth type is derived from `authSource` in the submit path instead of manual modal editing; MCP inspection now auto-loads discovered tools into the `actions` JSON field while previewing them.
- **Why:** Reduce user error and onboarding friction by guiding credential input through selectable connected apps, structured auth fields, and auto-populated action discovery rather than manual JSON editing.
- **Impact:** Frontend connector editor modal and binding configuration UI.

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Hardened backend playbook execution terminal-state transitions and added regression coverage for cancel vs transport-abort handling plus interrupt-resume-abort stream lifecycles; updated ADK playbook streaming to surface workflow failures as explicit gRPC aborts, bound workflow/step stream queues via env-backed settings, and refined queue pressure handling so the latest interrupt and terminal control events win over stale progress updates.
- **Why:** Production readiness required deterministic workflow finalization, explicit cross-service failure signaling, and bounded stream buffering so backend and ADK execution state stay consistent under cancellation, resume, and error conditions.
- **Impact:** `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.spec.ts`, `yellowstorm-adk/src/grpc_server/chatbot_servicer.py`, `yellowstorm-adk/src/config/settings.py`, `yellowstorm-adk/tests/test_chatbot_servicer_playbook_streaming.py`, `yellowstorm-adk/.env`

## [2026-04-16 12:00 UTC] — Fix duplicate playbook step persistence and judge summary execution

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Removed duplicate full-workflow playbook step persistence writes so stream-completed tasks persist once at buffer flush time before enrichment scheduling; added deterministic judge summary claim/evaluate flow to avoid duplicate or missed execution summaries; added regression coverage in backend playbook execution and judge enrichment specs.
- **Why:** Duplicate writes caused inconsistent task state and enrichment scheduling conflicts; non-deterministic judge summary flow caused missed or repeated execution summaries under concurrent load.
- **Impact:** Backend playbook execution and judge enrichment modules (spec files for regression coverage).

## [2026-04-16 11:45 UTC] — Fix LiteLLM proxy model alias propagation

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Updated backend model sync to persist the real provider-side model from LiteLLM `litellm_params.model`, while switching proxy-facing agent and playbook request paths to send the public model alias (`id` / `modelId`) to LiteLLM proxy clients.
- **Why:** LiteLLM proxy resolves `/chat/completions` requests by public `model_name` alias, so passing provider-side strings like `azure/...` caused invalid model errors for aliased models such as `gpt-5.4-low`.
- **Impact:** `YellowStorm/back/src/modules/models/models.service.ts`, `YellowStorm/back/src/modules/agent/agent.service.ts`, and LiteLLM-backed playbook service call sites.

## [2026-04-16 00:25 UTC] — Polish Advisor KPI cards and section order

- **Feature:** `playbook-advisor`
- **Type:** `fix`
- **Changed:** Renamed the Advisor overall KPI label from `Recommendation Pane` to `Overall`, converted confidence into a color-coded KPI card in both step-level and summary-level Advisor states, and moved the `Tool usage recommendation` panel to the end of the step-level Advisor content.
- **Why:** Makes Advisor scoring easier to scan, aligns confidence with the other KPI treatments, and places the supporting recommendation text after the primary remediation and issue-analysis sections.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`, `YellowStorm/front/src/modules/playbook/locales/en.json`, `YellowStorm/front/src/modules/playbook/locales/fr.json`

## [2026-04-15 23:10:00 UTC] — Remove workflow-level execution mode from the UI

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Removed the workflow-level execution mode selector and execution-mode badges from the frontend, and made full playbook runs always launch with `executionMode: 'inherit'` plus per-step `stepExecutionModes` derived from each task's `stepReplayMode`.
- **Why:** Simplifies replay behavior so execution mode is configured only at the step level while ensuring whole-workflow runs always respect step-specific replay modes.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/PlaybookToolbar.tsx`, `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionHeader.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionPanel.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`, `YellowStorm/front/src/modules/playbook/components/PlaybookToolbar.test.tsx`

## [2026-04-15 21:55:00 UTC] — Consolidate execution trace tabs and scope live autoscroll

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Scoped live autoscroll to the `Step Results` tab only, renamed execution tabs to `Replay Evaluation` and `Advisor`, merged `Tool Trace`, `Replay Args Diff`, and `LLM Prompts` into a single `Traces` tab with collapsed panes by default, and colorized replay-evaluation KPI cards by score range.
- **Why:** Reduce disruptive scrolling outside the result view, simplify the execution detail navigation, and make replay evaluation health easier to scan visually.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.test.tsx`, `YellowStorm/front/src/modules/playbook/locales/en.json`, `YellowStorm/front/src/modules/playbook/locales/fr.json`

## [2026-04-15 19:05:00 UTC] — Show execution snapshot task data in node editor during step runs

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** The playbook canvas node editor now prefers the active execution's `playbookSnapshot` task when a step is selected during execution, so sidebar task fields like description reflect Advisor Autopilot rewrites for that execution instead of stale canvas task data.
- **Why:** Clicking a node after an autopilot optimization still showed the original step description in the right sidebar because the editor sheet was bound to the pre-run canvas task object.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`

## [2026-04-15 16:05:00 UTC] — Show applied Advisor Autopilot step rewrites

- **Feature:** `playbook-advisor`
- **Type:** `feat`
- **Changed:** Persisted per-turn advisor optimization history for safe `optimize_step` rewrites, including compact before/after task snapshots and changed field names, and surfaced that history in the Playbook Advisor step detail pane.
- **Why:** Users could see that autopilot optimization turns happened, but not what was actually changed on each rewrite.
- **Impact:** `YellowStorm/back/src/modules/playbook/schemas/playbook-execution.schema.ts`, `YellowStorm/back/src/modules/playbook/interfaces/playbook.interface.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-judge-enrichment.service.ts`, `YellowStorm/front/src/modules/playbook/types.ts`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.test.tsx`, `YellowStorm/front/src/modules/playbook/locales/en.json`, `YellowStorm/front/src/modules/playbook/locales/fr.json`

## [2026-04-15 08:48:01 UTC] — Reorganize playbook canvas toolbar

- **Feature:** `playbook`
- **Type:** `refactor`
- **Changed:** Split playbook toolbar responsibilities by keeping run and document actions in the header, moving canvas editing actions into a new movable floating toolbar on the left side of the canvas, moving both connectors and workspace explorer toggles into that floating toolbar, and grouping execution configuration into a compact run-settings popover.
- **Why:** Reduce header crowding, place canvas actions closer to the workspace, and improve playbook editing ergonomics without changing playbook contracts.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/` and playbook locale files.

## [2026-04-14 23:35:00 UTC] — Connector editor skill selector and form shape update

- **Feature:** `connectors`
- **Type:** `refactor`
- **Changed:** Connector editor now selects referenced skills via a searchable multi-select component instead of a comma-separated text field. The submit/edit form shape now uses string arrays directly for skill IDs.
- **Why:** Improve UX for multi-skill selection with searchability and align form data structure with the backend API contract.
- **Impact:** `YellowStorm/front/src/modules/admin/pages/connectors/` (editor component)

## [2026-04-14 23:25:00 UTC] — Skills selector UI consistency and i18n cleanup

- **Feature:** `skills`
- **Type:** `refactor`
- **Changed:** Ensured agent and agent-type skills selection uses the existing searchable multi-select component consistently. Moved remaining hardcoded user-facing skill selector strings into i18n locale files for admin and agent modules.
- **Why:** Maintain UI consistency and follow project i18n standards; hardcoded strings violate localization requirements.
- **Impact:** Frontend locale files (admin and agent modules).

## [2026-04-14 23:20:00 UTC] — Add dedicated import-to-workspace documentation

- **Feature:** `import-to-workspace`
- **Type:** `docs`
- **Changed:** Added a dedicated feature doc for the agent-facing `<connector>_import_to_workspace` tool covering playbook/conversation runtime locations, accepted input forms, JWT auth model, workspace selection, backend endpoint contract, response rendering, common failure modes, and phase-1 limitations.
- **Why:** The connectors doc covered the import flow broadly, but the runtime tool itself needed a focused reference for future debugging, onboarding, and follow-up work.
- **Impact:** `docs/import-to-workspace/README.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-14 23:00:00 UTC] — Agent-driven workspace import for SharePoint/M365 files

- **Feature:** `connectors`, `mcp-m365`
- **Type:** `feat`
- **Changed:** Agents can now search SharePoint via M365 MCP tools and import discovered files into workspace documents using an auto-generated `<connector>_import_to_workspace` tool. The ADK shared helper `import_connector_items_to_workspace_request()` calls the backend `POST /api/v1/connectors/transfer/import` endpoint with platform JWT auth. Supports single file, multiple files, and recursive folder import with flattened persistence. Workspace selection prefers real workspace IDs from `brain_documents` over transient `conversation_brain_id`. Import tool accepts multiple input forms (direct args, item ref, full MCP result object, path-based).
- **Why:** Replace complex `workspacebridge_import_connector_item_to_workspace` MCP callback with a simple REST-based import that persists files as standard workspace documents consumable by code interpreter.
- **Impact:** `yellowstorm-adk/src/smart_rag/tools/utilities/connector_tools.py`, `yellowstorm-adk/src/langgraph_engine/playbook_tool_factory.py`, `yellowstorm-adk/src/smart_rag/agents/factories/base_factory.py`, `yellowstorm-adk/src/smart_rag/agents/factories/delegation_factory_helper.py`, `yellowstorm-adk/src/config/settings.py`, `yellowstorm-adk/.env`

## [2026-04-14 23:00:00 UTC] — M365 MCP richer item references and tool guidance

- **Feature:** `mcp-m365`
- **Type:** `feat`
- **Changed:** M365 MCP search/browse tools now return richer item references including `siteId`, `webUrl`, `listItemUniqueId`, `listId`, and `siteUrl` to prevent LLM ID-mixing errors. `get_item_metadata` now requests `@microsoft.graph.downloadUrl` and includes `downloadUrl` in response for binary files. Tool docstrings guide agents to prefer `get_document_content` as the primary content access tool and to use full item objects as-is when passing to downstream import tools.
- **Why:** Agents were mixing `driveId` from one search result with `itemId` from another, causing 404 errors on import.
- **Impact:** `mcp-m365/graph_helpers.py`, `mcp-m365/document_tools.py`

## [2026-04-14 23:00:00 UTC] — Platform JWT auth for connector import and adapter registry expansion

- **Feature:** `connectors`
- **Type:** `feat`
- **Changed:** ADK import tool now signs JWTs using `NESTJS_JWT_SECRET` with required NestJS claims (`type: access`, `iss: yellostorm`, `aud: yellostorm-api`). Backend adapter registry expanded with `mcp-spo`, `mcp-m365`, `sharepoint` aliases so MCP-style connector slugs resolve to `M365TransferAdapter`. URL normalization ensures correct `/api/v1/` prefix regardless of `API_URL` trailing slash.
- **Why:** ADK and NestJS used different JWT secrets; connector slug `mcp-spo` did not match registered adapter keys.
- **Impact:** `yellowstorm-adk/src/smart_rag/tools/utilities/connector_tools.py`, `yellowstorm-adk/src/config/settings.py`, `YellowStorm/back/src/modules/connector/connector-transfer.service.ts`

- **Feature:** `connectors`
- **Type:** `feat`
- **Changed:** Connector transfer import now supports `mode: 'file' | 'files' | 'folder'`. Folder mode recursively enumerates SharePoint/M365 files via `resolveImportCandidates`. Phase 1 flattens all imports into workspace documents. Filename collisions resolved using path-derived suffix.
- **Why:** Enable users to import single files, batches, or entire SharePoint folders into workspace for consumption by workspace context/code interpreter flow.
- **Impact:** `YellowStorm/back/src/modules/connector/interfaces/connector-transfer.interface.ts`, `YellowStorm/back/src/modules/connector/dto/connector-transfer.dto.ts`, `YellowStorm/back/src/modules/connector/connector-transfer.service.ts`, `YellowStorm/back/src/modules/connector/adapters/m365-transfer.adapter.ts`, `YellowStorm/back/src/modules/connector/connector.controller.ts`

## [2026-04-13 12:00:00 UTC] — Connected-app access token on gRPC tools (web app only)

- **Feature:** `tool` / `conversation`
- **Type:** `feat`
- **Changed:** Backend `chatbot.proto` `Tool` adds optional `accessToken` and `guidelines`. Tools persist `requiredAppKey`; `AgentService` injects decrypted OAuth tokens into gRPC tool payloads via `ConnectedAppTokenService`. Admin tool dialog supports selecting a required connected app (i18n). Logger redaction extended for token-like keys. ADK / Python proto left unchanged (wire fields may be ignored until ADK is upgraded).
- **Why:** Parity with main YellowStorm for tools that need a user’s connected-app OAuth token when calling the AI runtime over gRPC.
- **Impact:** `YellowStorm/back/src/modules/conversation/proto/chatbot.proto`, `YellowStorm/back/src/modules/tool/`, `YellowStorm/back/src/modules/agent/`, `YellowStorm/back/src/modules/logger/logger.service.ts`, `YellowStorm/front/src/modules/admin/` (types, tools pages, locales)

## [2026-04-13 09:30:00 UTC] — Allow admin slug editing in connector edit dialog

- **Feature:** `connectors`
- **Type:** `fix`
- **Changed:** Connector edit dialog now renders the slug field as editable instead of read-only, allowing admins to modify slugs post-creation.
- **Why:** Admins need the ability to correct or customize slugs after initial connector creation.
- **Impact:** `YellowStorm/front/src/modules/admin/pages/connectors/`

## [2026-04-13 00:00:00] — Fix MCP connector import collision behavior

- **Feature:** `connectors`
- **Type:** `fix`
- **Changed:** MCP import no longer upserts by generated slug. Repeated imports now create new connectors with collision-safe names/slugs instead of overwriting existing entries.
- **Why:** Previously, importing an MCP connector with the same generated slug would silently overwrite the existing entry, causing data loss. Import collisions are now handled safely by appending distinguishing suffixes.
- **Impact:** `YellowStorm/back/src/modules/connector/`

## [2026-04-11 23:48:00] — MCP connector integration for playbook steps

- **Feature:** `connectors`
- **Type:** `feat`
- **Changed:** Full-stack connector feature: admin catalog CRUD with MCP Inspector, user-scoped credentials, playbook step-level tool bindings, drag-and-drop connector sidebar on canvas, binding configuration modal, connector badges on nodes, runtime MCP tool injection via gRPC proto extension and ADK tool factory. Drop on existing node attaches connector binding; drop on empty canvas creates new step with connector pre-attached.
- **Why:** Users need to integrate external services (SharePoint, Google Drive, Notion, Salesforce, etc.) into playbook steps so the AI agent can call MCP tools during execution.
- **Impact:** `YellowStorm/back/src/modules/connector/` (new), `YellowStorm/back/src/app.module.ts`, `YellowStorm/back/src/modules/playbook/schemas/playbook.schema.ts`, `YellowStorm/back/src/modules/playbook/interfaces/playbook.interface.ts`, `YellowStorm/back/src/modules/playbook/services/playbook.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts`, `YellowStorm/back/src/modules/playbook/dto/update-playbook.dto.ts`, `YellowStorm/back/src/modules/exceptions/constants/error-codes.ts`, `YellowStorm/back/src/modules/authorization/constants/permissions.ts`, `YellowStorm/back/src/modules/conversation/proto/chatbot.proto`, `YellowStorm/yellowstorm-adk/grpc/proto/chatbot.proto`, `YellowStorm/yellowstorm-adk/src/langgraph_engine/playbook_tool_factory.py`, `YellowStorm/yellowstorm-adk/src/langgraph_engine/mcp_client_factory.py` (new), `YellowStorm/yellowstorm-adk/src/langgraph_engine/graph_builder.py`, `YellowStorm/yellowstorm-adk/src/langgraph_engine/step_executor.py`, `YellowStorm/yellowstorm-adk/src/grpc_server/chatbot_servicer.py`, `YellowStorm/front/src/modules/admin/pages/connectors/` (new), `YellowStorm/front/src/modules/playbook/components/ConnectorSidebar.tsx` (new), `YellowStorm/front/src/modules/playbook/components/ConnectorBindingModal.tsx` (new), `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`, `YellowStorm/front/src/modules/playbook/components/PlaybookNode.tsx`, `YellowStorm/front/src/modules/playbook/types.ts`, `YellowStorm/front/src/modules/playbook/store.ts`, `YellowStorm/front/src/lib/api/config.ts`, `YellowStorm/front/src/modules/admin/types.ts`, `YellowStorm/front/src/modules/admin/api.ts`, `YellowStorm/front/src/modules/admin/index.ts`, `YellowStorm/front/src/modules/admin/constants.ts`, `YellowStorm/front/src/modules/admin/locales/en.json`, `YellowStorm/front/src/modules/admin/locales/fr.json`, `YellowStorm/front/src/Router.tsx`

## [2026-04-11 16:10:04] — Group advisor issues into badge-based panels

- **Feature:** `playbook-advisor`
- **Type:** `feat`
- **Changed:** The issue panels under the Advisor tab now render as grouped badge-based sections instead of dense multi-column boxes. Structural, prompt, contract, handoff, tooling, and strength findings are displayed in a consistent row style matching the remediation suggestions.
- **Why:** The advisor output was hard to scan because the issue sections used small dense grids while remediation suggestions already had a clearer badge-row layout.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`, `doc/playbook-advisor/README_2026-04-11_16-10-04.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-11 14:30:56] — Add actionable remediations with category badges, review modal, and per-item edit

- **Feature:** `playbook-advisor`
- **Type:** `feat`
- **Changed:** Advisor findings are now classified into structured change proposals with category badges (structure, prompt, contract, handoff, tooling, evidence, output-format). The three CTA buttons open a shared review modal where users can exclude or edit individual suggestions before applying. Each remediation item shows an inline Apply button.
- **Why:** Advisor findings were plain text strings with no way to progressively apply granular changes or exclude unwanted suggestions.
- **Impact:** `YellowStorm/back/src/modules/playbook/dto/advisor-remediation.dto.ts`, `YellowStorm/back/src/modules/playbook/controllers/playbook.controller.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-judge-enrichment.service.ts`, `YellowStorm/front/src/modules/playbook/types.ts`, `YellowStorm/front/src/modules/playbook/api.ts`, `YellowStorm/front/src/modules/playbook/store.ts`, `YellowStorm/front/src/modules/playbook/components/AdvisorChangeReviewDialog.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`, `YellowStorm/front/src/modules/playbook/locales/en.json`, `YellowStorm/front/src/modules/playbook/locales/fr.json`, `doc/playbook-advisor/README_2026-04-11_14-30-56.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-11 13:35:41] — Continue single-step autopilot on step-scoped advisor rewrites

- **Feature:** `playbook-advisor`
- **Type:** `fix`
- **Changed:** Single-step Advisor Autopilot now treats `recommendation: update_current_playbook` with non-empty `rewriteHints` as a safe `optimize_step` fallback inside the autopilot loop instead of stopping immediately as `no_safe_fix_available`.
- **Why:** The advisor can return a very low score with concrete step rewrite hints while still classifying the recommendation as `update_current_playbook`, which previously caused autopilot to stop after the first evaluation even though a safe step optimization was available.
- **Impact:** `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.spec.ts`, `doc/playbook-advisor/README_2026-04-11_13-35-41.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-11 12:27:13] — Show the newest advisor and evaluation history entry by default

- **Feature:** `playbook`, `playbook-advisor`
- **Type:** `fix`
- **Changed:** The step detail view now defaults both the evaluation selector and the Playbook Advisor selector to the newest persisted history entry instead of preserving an older attempt.
- **Why:** After a new advisor evaluation completed, the detail pane could keep showing a stale earlier attempt even though a fresher result had just been generated.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.test.tsx`, `docs/playbook/README_2026-04-11_12-27-13.md`, `doc/playbook-advisor/README_2026-04-11_12-27-13.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-11 12:11:57] — Reset stale advisor state before rerunning a step

- **Feature:** `playbook`, `playbook-advisor`
- **Type:** `fix`
- **Changed:** Step reruns now clear the current task’s persisted judge/advisor status, result, and error before the next attempt starts, and the rerun path refreshes `reflectionEnabled` from the current request.
- **Why:** A specific-step rerun could keep the previous attempt’s `evaluated` advisor state, causing the next synchronous advisor pass to exit early even when the toolbar Advisor switch was enabled.
- **Impact:** `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.spec.ts`, `docs/playbook/README_2026-04-11_12-11-57.md`, `doc/playbook-advisor/README_2026-04-11_12-11-57.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-11 11:24:46] — Forward advisor mode when rerunning a step evaluation

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** The step evaluation rerun action now forwards advisor autopilot settings into the rerun request, so a specific-step evaluation still uses the advisor branch when advisor mode is enabled.
- **Why:** The UI switch could be on, but the evaluation rerun path dropped the advisor flags before the request reached the backend.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/ExecutionPanel.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionPanel.test.tsx`, `docs/playbook/README_2026-04-11_11-24-46.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-11 10:37:57] — Keep rerun headers aligned with live task status

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** The canvas page, execution header, and execution panel now derive a visible execution status from task results, so rerunning or resuming a step shows `Running` immediately even if the persisted execution shell still says `Completed`.
- **Why:** A rerun could appear active in the step list while the surrounding execution chrome still reported the run as completed.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionHeader.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionPanel.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionPanel.test.tsx`, `docs/playbook/README_2026-04-11_10-37-57.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-11 10:27:16] — Clear stale step payloads when rerunning a step

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Rerun/resume now clear the current step’s output, artifacts, tool trace, prompt trace, semantic match, and judge data immediately, and the panel no longer eagerly refetches the same execution after a rerun/resume API call.
- **Why:** The step pane could keep rendering the previous completed payload for several seconds while the execution header and the new attempt were already supposed to be live.
- **Impact:** `YellowStorm/front/src/modules/playbook/store.ts`, `YellowStorm/front/src/modules/playbook/store.test.ts`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.test.tsx`, `docs/playbook/README_2026-04-11_10-27-16.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-11 08:29:32] — Prevent stale completion refresh from overriding a rerun

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Rerun and resume now cancel the old judge-refresh timer for that execution, and the execution merge preserves a newer optimistic `running` attempt over an older fetched `completed` snapshot.
- **Why:** A post-completion refresh from the previous attempt could briefly push the execution header back to `completed` while the rerun step itself was already shown as `running`.
- **Impact:** `YellowStorm/front/src/modules/playbook/store.ts`, `YellowStorm/front/src/modules/playbook/store.test.ts`, `docs/playbook/README_2026-04-11_08-29-32.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-11 08:24:01] — Focus relaunched execution immediately on rerun and resume

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Step rerun and resume actions now optimistically move the visible execution panel onto the relaunched execution, update its history row to `running`, and mark the playbook as actively executing immediately.
- **Why:** The canvas could switch to `running` while the execution header and panel still showed an older completed execution for several seconds until the next fetch finished.
- **Impact:** `YellowStorm/front/src/modules/playbook/store.ts`, `YellowStorm/front/src/modules/playbook/store.test.ts`, `docs/playbook/README_2026-04-11_08-24-01.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-11 08:08:00] — Reset step-result pane on rerun and reconcile live step status

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Terminal execution completion now coerces any lingering running task rows to terminal state immediately, and the step-result pane now resets to the live in-flight attempt when a step goes back to `running`.
- **Why:** The canvas could still show a running node or the step pane could keep displaying the previous completed attempt even after the backend had already moved on to the new run.
- **Impact:** `YellowStorm/front/src/modules/playbook/store.ts`, `YellowStorm/front/src/modules/playbook/store.test.ts`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.test.tsx`, `docs/playbook/README_2026-04-11_08-08-00.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-11 07:58:47] — Refresh terminal execution state after completion

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** The frontend now refetches an execution after the terminal completion event so the persisted backend task states replace any stale optimistic or missed stream state.
- **Why:** A completed execution could still render a node as running if the browser missed or partially merged the final stream update.
- **Impact:** `YellowStorm/front/src/modules/playbook/store.ts`, `YellowStorm/front/src/modules/playbook/store.test.ts`, `docs/playbook/README_2026-04-11_07-58-47.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-11 07:48:48] — Terminalize running tasks when workflow failure ends unexpectedly

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Unexpected workflow failures now mark any still-running task rows as `FAILED` before skipping the remaining pending rows.
- **Why:** A failed execution could keep a node in `RUNNING` state even after the execution itself had already failed, which made the run look incoherent and blocked normal follow-up actions.
- **Impact:** `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.spec.ts`, `docs/playbook/README_2026-04-11_07-48-48.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-11 07:31:47] — Fail fast on rerun when playbook gRPC is unavailable

- **Feature:** `playbook-advisor`
- **Type:** `fix`
- **Changed:** Step reruns now reject immediately with `ServiceUnavailableException` when the playbook gRPC client is unavailable, instead of trying to call `RunStepStream` on an uninitialized client.
- **Why:** A rerun could reach `RunStepStream` with an undefined gRPC client and crash the execution path instead of failing cleanly.
- **Impact:** `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.spec.ts`, `doc/playbook-advisor/README_2026-04-11_07-31-47.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-11 07:04:01] — Honor toolbar Advisor toggle for single-step reruns

- **Feature:** `playbook-advisor`
- **Type:** `fix`
- **Changed:** Step rerun requests now carry `runNodeReflection`, the backend rerun route forwards it, and the single-step execute action sends the current toolbar Advisor toggle for both fresh single-step runs and reruns.
- **Why:** Executing a step from an existing execution could ignore the current `Advisor` toggle and reuse stale reflection settings from the old execution.
- **Impact:** `YellowStorm/back/src/modules/playbook/dto/rerun-step.dto.ts`, `YellowStorm/back/src/modules/playbook/controllers/playbook.controller.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.spec.ts`, `YellowStorm/front/src/modules/playbook/types.ts`, `YellowStorm/front/src/modules/playbook/store.ts`, `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`, `doc/playbook-advisor/README_2026-04-11_07-04-01.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-11 06:40:26] — Sync single-step Advisor evaluation and advisor history selection

- **Feature:** `playbook-advisor`
- **Type:** `fix`
- **Changed:** Single-step executions and step reruns now run Playbook Advisor synchronously even when Step Autopilot is off, advisor history entries now persist the originating attempt number, and the Playbook Advisor tab now exposes a selector for historical advisor evaluations.
- **Why:** Advisor mode on single-step runs was not reliably surfacing an immediate advisor result, and users could not inspect earlier advisor outputs per attempt from the Advisor tab.
- **Impact:** `YellowStorm/back/src/modules/playbook/schemas/playbook-execution.schema.ts`, `YellowStorm/back/src/modules/playbook/interfaces/playbook.interface.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-judge-enrichment.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.spec.ts`, `YellowStorm/back/src/modules/playbook/services/playbook.service.ts`, `YellowStorm/back/src/modules/playbook/utils/execution.utils.ts`, `YellowStorm/front/src/modules/playbook/types.ts`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.test.tsx`, `YellowStorm/front/src/modules/playbook/locales/en.json`, `YellowStorm/front/src/modules/playbook/locales/fr.json`, `doc/playbook-advisor/README_2026-04-11_06-40-26.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-10 21:14] — Add single-step Advisor Autopilot execution loop

- **Feature:** `playbook-advisor`
- **Type:** `feat`
- **Changed:** Added bounded single-step Advisor Autopilot execution support, including execution/task autopilot metadata, synchronous advisor evaluation in the single-step path, safe optimize-and-rerun control flow, SSE updates, and a frontend Step Autopilot toggle/status surface.
- **Why:** The previous Playbook Advisor implementation could explain issues after a run, but it could not apply safe automatic remediation within the same single-step execution.
- **Impact:** `YellowStorm/back/src/modules/playbook/dto/execute-playbook.dto.ts`, `YellowStorm/back/src/modules/playbook/dto/rerun-step.dto.ts`, `YellowStorm/back/src/modules/playbook/controllers/playbook.controller.ts`, `YellowStorm/back/src/modules/playbook/schemas/playbook-execution.schema.ts`, `YellowStorm/back/src/modules/playbook/interfaces/playbook.interface.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-judge-enrichment.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook.service.ts`, `YellowStorm/front/src/modules/playbook/types.ts`, `YellowStorm/front/src/modules/playbook/store.ts`, `YellowStorm/front/src/modules/playbook/services/playbookStreamService.ts`, `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`, `YellowStorm/front/src/modules/playbook/components/PlaybookToolbar.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`, `YellowStorm/front/src/modules/playbook/locales/en.json`, `YellowStorm/front/src/modules/playbook/locales/fr.json`, `doc/playbook-advisor/README_2026-04-10_21-14-33.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-10 20:34] — Align playbook rerun endpoints with backend routes

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Updated the frontend playbook API to call the backend's `rerun-step` and `resume-from-step` execution routes, and added a regression test for both endpoint builders.
- **Why:** The frontend was posting to `/rerun` and `/resume`, which did not exist on the controller and produced 404s for rerun actions.
- **Impact:** `YellowStorm/front/src/lib/api/config.ts`, `YellowStorm/front/src/modules/playbook/api.test.ts`, `docs/playbook/README_2026-04-10_20-34-52.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-10 20:31] — Rebrand judge flows as Playbook Advisor and add tool-aware findings

- **Feature:** `playbook-advisor`
- **Type:** `feat`
- **Changed:** Rebranded the playbook judge/reflection UX as Playbook Advisor, extended step and execution advisor payloads with tool-usage analysis fields, and added defensive normalization so malformed advisor JSON falls back safely.
- **Why:** The existing workflow already persisted tool traces, but the advisor contract did not explicitly score or explain tool behavior and the product naming no longer matched the feature direction.
- **Impact:** `YellowStorm/back/src/modules/playbook/schemas/playbook-execution.schema.ts`, `YellowStorm/back/src/modules/playbook/interfaces/playbook.interface.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-judge-enrichment.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-judge-enrichment.service.spec.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-prompt.service.ts`, `YellowStorm/front/src/modules/playbook/types.ts`, `YellowStorm/front/src/modules/playbook/store.ts`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.test.tsx`, `YellowStorm/front/src/modules/playbook/components/PlaybookNode.tsx`, `YellowStorm/front/src/modules/playbook/components/PlaybookToolbar.tsx`, `YellowStorm/front/src/modules/playbook/locales/en.json`, `YellowStorm/front/src/modules/playbook/locales/fr.json`, `doc/playbook-advisor/README_2026-04-10_20-31-49.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-10 12:18] — Guard generated playbook workspaces before cloning

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** The judge-generated playbook flow now filters invalid `workspaces` values and falls back to the source playbook's workspaces instead of crashing with a BSONError.
- **Why:** The generated JSON can omit or corrupt workspace IDs, and the create path should not fail on invalid ObjectId strings.
- **Impact:** `YellowStorm/back/src/modules/playbook/services/playbook-judge-enrichment.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-judge-enrichment.service.spec.ts`, `docs/playbook/README_2026-04-10_12-18-28.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-10 10:16] — Open generated playbook directly from judge CTA

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** The Judge LLM "Generate new optimized playbook" CTA now navigates directly to the newly created playbook after the API call completes.
- **Why:** Users should land on the generated playbook immediately instead of remaining on the execution page.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.test.tsx`, `docs/playbook/README_2026-04-10_10-16-33.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-10 08:03] — Document playbook recommendation pane and step optimization

- **Feature:** `playbook`
- **Type:** `docs`
- **Changed:** Reflected the Judge LLM recommendation pane, the step-scoped `Optimize this step` action, and the explicit 200000ms rewrite timeout in the latest playbook snapshot.
- **Why:** The playbook docs needed to catch up with the implemented judge/reflection UX and timeout behavior.
- **Impact:** `docs/playbook/README_2026-04-10_08-03-20.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`

## [2026-04-10 07:41] — Increase playbook judge LLM timeouts

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Added explicit, longer LiteLLM request timeouts for node judge, execution summary, and playbook rewrite calls.
- **Why:** Judge requests were inheriting the shared 10-second LiteLLM client timeout, causing intermittent reflection failures on slower model responses.
- **Impact:** `YellowStorm/back/src/modules/playbook/services/playbook-judge-enrichment.service.ts`, `docs/playbook/README_2026-04-10_07-41-34.md`, `docs/DOC_INDEX.md`

## [2026-04-10 07:33] — Start node judge after step persistence and expose judge errors

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** The workflow stream path now persists each completed step before scheduling node reflection, and judge failures are stored and shown directly in the Judge LLM tab. The Judge LLM UI now keeps the execution-level recommendation CTA in a single summary block.
- **Why:** Node reflection was effectively delayed until workflow completion because the judge service read persisted task results, while workflow completions were still only buffered in memory. Judge failures also needed to be visible to the user.
- **Impact:** `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-judge-enrichment.service.ts`, `YellowStorm/back/src/modules/playbook/schemas/playbook-execution.schema.ts`, `YellowStorm/back/src/modules/playbook/interfaces/playbook.interface.ts`, `YellowStorm/back/src/modules/playbook/services/playbook.service.ts`, `YellowStorm/front/src/modules/playbook/types.ts`, `YellowStorm/front/src/modules/playbook/store.ts`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`, `YellowStorm/front/src/modules/playbook/locales/en.json`, `YellowStorm/front/src/modules/playbook/locales/fr.json`, `docs/playbook/README_2026-04-10_07-33-23.md`, `docs/DOC_INDEX.md`

## [2026-04-10 07:14] — Preserve live judge state during execution refresh

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Updated frontend execution merging so cached judge progress and results win over stale fetched task rows when the step status is unchanged.
- **Why:** A post-step execution fetch could overwrite live SSE judge updates, delaying the `Evaluating` badge until the workflow completed.
- **Impact:** `YellowStorm/front/src/modules/playbook/store.ts`, `docs/playbook/README_2026-04-10_07-14-20.md`, `docs/DOC_INDEX.md`

## [2026-04-10 07:02] — Enqueue playbook judge jobs in parallel

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Changed the execution sweep to enqueue pending node judges instead of awaiting each one serially.
- **Why:** Judge work was still running one step at a time inside the sweep path, which prevented the limiter from doing real concurrent reflection work.
- **Impact:** `YellowStorm/back/src/modules/playbook/services/playbook-judge-enrichment.service.ts`, `docs/playbook/README_2026-04-10_07-02-01.md`, `docs/DOC_INDEX.md`

## [2026-04-10 06:56] — Poll for late playbook judge results

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Added a short client-side refresh loop after execution completion so judge results are reloaded even if the SSE stream closes before the backend reflection finishes.
- **Why:** Judge work can start after the execution-complete event, which left the UI showing no result despite the backend sweep beginning.
- **Impact:** `YellowStorm/front/src/modules/playbook/store.ts`, `docs/playbook/README_2026-04-10_06-56-01.md`, `docs/DOC_INDEX.md`

## [2026-04-10 06:48] — Judge completed steps with evidence

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Relaxed node reflection gating so completed steps with components, artifacts, or traces can still be judged even when the streamed text output is empty. Added explicit judge lifecycle logs and an execution sweep before summary finalization.
- **Why:** Some completed runs were never producing judge results, leaving the Judge LLM tab empty and the backend silent.
- **Impact:** `YellowStorm/back/src/modules/playbook/services/playbook-judge-enrichment.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts`, `docs/playbook/README_2026-04-10_06-48-24.md`, `docs/DOC_INDEX.md`

## [2026-04-09 21:55] — Recover missing playbook judge results

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Added a backend completion sweep so missed node reflections are retried and the execution summary can still be emitted after the workflow finishes.
- **Why:** Some runs were reaching the completed state without persisting a judge result, leaving the Judge LLM tab empty.
- **Impact:** `YellowStorm/back/src/modules/playbook/services/playbook-judge-enrichment.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts`, `docs/playbook/README_2026-04-09_21-55-26.md`, `docs/DOC_INDEX.md`

## [2026-04-09 21:32] — Add async playbook judge reflection

- **Feature:** `playbook`
- **Type:** `docs`
- **Changed:** Added `README_2026-04-09_21-32-12.md` describing the new asynchronous node reflection flow, execution-level judge summary, reflection toggle, and the update/generate rewrite actions.
- **Why:** The playbook runtime now evaluates completed nodes off the critical path and exposes judge-driven rewrite actions in the UI.
- **Impact:** `docs/playbook/README_2026-04-09_21-32-12.md`, `docs/DOC_INDEX.md`

## [2026-04-09 20:18] — Use task badge number in playbook step list

- **Feature:** `playbook`
- **Type:** `docs`
- **Changed:** Added `README_2026-04-09_20-18-11.md` noting that the execution step list now shows only the task badge number and status icon, without the duration.
- **Why:** The step list needed to match the canvas badge pattern and free up the remaining width.
- **Impact:** `docs/playbook/README_2026-04-09_20-18-11.md`, `docs/DOC_INDEX.md`

## [2026-04-09 20:13] — Simplify playbook execution detail layout

- **Feature:** `playbook`
- **Type:** `docs`
- **Changed:** Added `README_2026-04-09_20-13-31.md` noting that the execution step list is now compact, the step execution picker sits beside step mode, and the results pane no longer shows the output heading or the helper hint.
- **Why:** The execution sidebar needed more horizontal room for the details panel while keeping the important step metadata visible.
- **Impact:** `docs/playbook/README_2026-04-09_20-13-31.md`, `docs/DOC_INDEX.md`

## [2026-04-09 20:00] — Narrow playbook step list with hover details

- **Feature:** `playbook`
- **Type:** `docs`
- **Changed:** Added `README_2026-04-09_20-00-34.md` noting that the execution step list is narrower, truncates long titles with an ellipsis, and shows the full title plus agent name in a hover tooltip.
- **Why:** The execution sidebar needs less horizontal space while keeping the step identity visible on hover.
- **Impact:** `docs/playbook/README_2026-04-09_20-00-34.md`, `docs/DOC_INDEX.md`

## [2026-04-09 19:55] — Compact playbook execution step list

- **Feature:** `playbook`
- **Type:** `docs`
- **Changed:** Added `README_2026-04-09_19-55-34.md` noting that the execution sidebar step list now shows compact step-number badges instead of step titles while preserving the status icon, agent name, and duration.
- **Why:** The playbook execution sidebar needs to use less horizontal space without losing the core step metadata.
- **Impact:** `docs/playbook/README_2026-04-09_19-55-34.md`, `docs/DOC_INDEX.md`

## [2026-04-09 00:00] — Add playbook user stories snapshot

- **Feature:** `playbook`
- **Type:** `docs`
- **Changed:** Added `README_2026-04-09_00-00-00.md` with 20 user stories covering the full playbook lifecycle: workflow execution, cancellation, single-step execution, rerun/resume-from-step, HITL approval/clarification/review, replay (strict/flex/adaptive), semantic evaluation, undo/redo, multi-tab SSE collaboration, prompt registry CRUD, multiline copilot Enter-submit, artifact fuzzy routing, unhandled rejection diagnostics, stream error containment, and stale interrupt detection.
- **Why:** The existing playbook snapshot describes architecture and requirements but not concrete user-facing stories with acceptance criteria.
- **Impact:** `docs/playbook/README_2026-04-09_00-00-00.md`, `docs/DOC_INDEX.md`

## [2026-04-09 11:38] — Document skills feature user stories with implementation audit trail

- **Feature:** `skills`
- **Type:** `docs`
- **Changed:** Added `USER_STORIES_2026-04-09_11-38-28.md` with 16 user stories covering all skill capabilities (import, CRUD, toggle, inheritance, disable, UI management, ADK injection/activation, playbook injection). Each story includes ACs, concrete file/line references, and an implementation status table.
- **Why:** The existing skills snapshot describes architecture but not concrete acceptance criteria or which stories are actually built vs. pending.
- **Impact:** `docs/skills/USER_STORIES_2026-04-09_11-38-28.md`, `docs/DOC_INDEX.md`

## [2026-04-08 07:15] — Document the skills feature implementation

- **Feature:** `skills`
- **Type:** `docs`
- **Changed:** Added a dedicated skills documentation snapshot covering the MongoDB skill catalog, admin CRUD/import APIs, frontend management UI, ADK runtime injection/activation, playbook integration, and the separate memory-based skills endpoint.
- **Why:** The implemented skills feature now spans backend, frontend, and both execution runtimes, so it needs a canonical cross-cutting reference.
- **Impact:** `docs/skills/README_2026-04-08_07-15-54.md`, `docs/DOC_INDEX.md`

## [2026-04-07 22:23] — Add fuzzy artifact-to-port matching in ADK routing

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** ADK `_infer_output_port_id_from_filename` and `_resolve_output_port` now use `difflib.SequenceMatcher` to fuzzy-match artifact filenames against port `id`, `name`, and `description` when exact token matching fails. Multiple candidates are ranked by similarity score with a 0.5 threshold. The LLM routing call in `step_executor` is kept as a final safety net.
- **Why:** Token-based filename matching was too rigid — `attestation_synthese.pdf` wouldn't match port `out-attestation` because tokenization split on `_`. Fuzzy matching catches semantic overlap that substring checks miss.
- **Impact:** `yellowstorm-adk/src/langgraph_engine/graph_builder.py`
- **Tests:** `test_fuzzy_matching_routes_attestation_to_description_port`, `test_fuzzy_matching_routes_synthese_to_description_port`, `test_fuzzy_matching_falls_back_when_no_description_match`

## [2026-04-07 22:02] — Graceful fallback for ambiguous artifact output-port routing

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Both ADK `_resolve_output_port()` and Nest `resolveOutputPort()` now fall back to the `default` port (or first compatible port) instead of throwing when a task produces an artifact without `output_port_id` and multiple compatible output ports exist. ADK structured-output synthesis also warns and continues instead of hard-failing.
- **Why:** Artifact components from tool-produced files arrive without `output_port_id`. When a task has multiple output ports of the same kind, this ambiguity was crashing the backend or failing the step.
- **Impact:** `yellowstorm-adk/src/langgraph_engine/graph_builder.py`, `yellowstorm-adk/src/langgraph_engine/step_executor.py`, `YellowStorm/back/src/modules/playbook/utils/execution.utils.ts`
- **Tests:** `test_resolve_output_port_falls_back_to_default_port_when_ambiguous`, `test_resolve_output_port_falls_back_to_first_port_when_no_default`, `test_extract_artifacts_from_components_falls_back_on_ambiguous_port`

## [2026-04-07 21:46] — Fail streamed playbook executions cleanly on step-update exceptions

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Documented that both full-workflow and single-step gRPC `data` handlers now catch `handleStepUpdate()` exceptions, log the error, cancel the stream, and reject the execution promise instead of letting the exception crash the backend process.
- **Why:** Ambiguous artifact routing during streamed step updates was surfacing as an `unhandledRejection` and shutting down the entire API server.
- **Impact:** `docs/playbook/README_2026-04-07_21-46-02.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-07_21-46-02.md`

## [2026-04-07 21:41] — Improve backend unhandled rejection diagnostics

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Documented that `YellowStorm/back/src/main.ts` now serializes `unhandledRejection` reasons with `node:util.inspect`, logging `Error` message/stack/name/cause and inspected output for non-Error rejection values.
- **Why:** Workflow crashes previously surfaced as `Unhandled Rejection { reason: {} }`, which was not actionable enough to isolate the failing backend path.
- **Impact:** `docs/playbook/README_2026-04-07_21-41-13.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-07_21-41-13.md`

## [2026-04-06 18:03] — Add Enter-submit textarea handling for playbook copilot

- **Feature:** `playbook`
- **Type:** `docs`
- **Changed:** Documented that the playbook copilot response textareas in both `PlaybookDesignerPanel` and `InterruptDialog` submit on plain Enter, preserve Shift+Enter newline insertion, and ignore IME composition during key handling.
- **Why:** The documentation snapshot needs to match the current UI behavior for multiline copilot replies.
- **Impact:** `docs/playbook/README_2026-04-06_18-03-00.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-06_18-03-00.md`

## [2026-04-06 13:57] — Fix fallback-only task completion output capture

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Documented that the task completion path now computes `output_text` before fallback artifact generation in `graph_builder`, preventing the `cannot access local variable 'output_text'` failure when a step completes with only fallback text artifacts.
- **Why:** Fallback-only completions must be able to generate artifacts without a runtime error.
- **Impact:** `docs/playbook/README_2026-04-06_13-57-00.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-06_13-57-00.md`

## [2026-04-06 13:55] — Restore HITL resume context from interrupt snapshot

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Updated the playbook snapshot to document that clarification interrupt payloads now include `task_description`, and that `resume_playbook()` / `resume_single_step()` restore transcript and task-description context by resuming with `Command(update=..., resume=...)` from the suspended interrupt snapshot.
- **Why:** HITL resume paths need the clarified task context to survive suspension and resume consistently.
- **Impact:** `docs/playbook/README_2026-04-06_13-55-00.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-06_13-55-00.md`

## [2026-04-06 13:52] — Persist HITL clarification state on resume

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Documented that clarification transcripts and task description overrides are now persisted in playbook state so resumed HITL runs reuse the prior clarification context instead of asking the same clarification again.
- **Why:** Resume flows need the original clarification state to survive checkpointed restarts.
- **Impact:** `docs/playbook/README_2026-04-06_13-52-00.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-06_13-52-00.md`

## [2026-04-06 13:50] — Pin docs-maintainer to gpt-5.4-mini

- **Feature:** `opencode-agents`
- **Type:** `feat`
- **Changed:** Assigned the `docs-maintainer` subagent an explicit `model: openai/gpt-5.4-mini` override and refreshed the OpenCode agent snapshot to document the dedicated model selection.
- **Why:** Documentation maintenance is a bounded, repetitive workflow that benefits from a lighter dedicated model instead of inheriting the active primary-agent model.
- **Impact:** `.opencode/agents/docs-maintainer.md`, `docs/opencode-agents/README_2026-04-06_13-50-14.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`
- **Doc:** `created` `/docs/opencode-agents/README_2026-04-06_13-50-14.md`

## [2026-04-06 13:21] — Remove stale Python-first security guidance

- **Feature:** `opencode-agents`
- **Type:** `docs`
- **Changed:** Replaced the stale SQLAlchemy-specific injection note in `AGENTS.md` with stack-agnostic injection-safety guidance and refreshed the OpenCode agent snapshot to use a relative cross-reference that matches the repository docs rules.
- **Why:** The prior instructions still carried a Python/SQLAlchemy assumption that did not fit the documented NestJS/Mongoose stack and the latest snapshot still used an absolute docs link.
- **Impact:** `AGENTS.md`, `docs/opencode-agents/README_2026-04-06_13-21-09.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`
- **Doc:** `created` `/docs/opencode-agents/README_2026-04-06_13-21-09.md`

## [2026-04-06 13:19] — Correct plan-vs-build delegation docs

- **Feature:** `opencode-agents`
- **Type:** `docs`
- **Changed:** Refreshed the OpenCode agent snapshot to document `build` and `plan` task-permission targets separately, matching the actual `opencode.json`, and recorded the final aligned documentation state.
- **Why:** The prior snapshot still implied both primary agents could delegate to the same task targets, which overstated `plan` capabilities.
- **Impact:** `docs/opencode-agents/README_2026-04-06_13-19-23.md`, `docs/DOC_INDEX.md`, `docs/CHANGELOG.md`
- **Doc:** `created` `/docs/opencode-agents/README_2026-04-06_13-19-23.md`

## [2026-04-06 13:17] — Fix OpenCode docs drift after AGENTS alignment

- **Feature:** `opencode-agents`
- **Type:** `docs`
- **Changed:** Corrected `AGENTS.md` to reference the actual `docs/` tree instead of `yellowstorm-docs/`, and refreshed the OpenCode agent snapshot so task-permission and approved-skill descriptions match the current `opencode.json`.
- **Why:** The previous documentation pass left one internal docs-root mismatch and slightly overstated how `permission.task` is restricted.
- **Impact:** `AGENTS.md`, `docs/opencode-agents/README_2026-04-06_13-17-42.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/opencode-agents/README_2026-04-06_13-17-42.md`

## [2026-04-06 13:13] — Align AGENTS.md with OpenCode team and monorepo architecture

- **Feature:** `opencode-agents`
- **Type:** `docs`
- **Changed:** Updated `AGENTS.md` to describe the actual monorepo stack, package-specific test workflow, OpenCode primary agents and specialist subagents, and browser validation guidance tied to the project OpenCode setup.
- **Why:** The repository-wide instructions were still Python-first and no longer matched the current OpenCode team or the NestJS/React/Python split used in this project.
- **Impact:** `AGENTS.md`, `docs/opencode-agents/README_2026-04-06_13-13-55.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/opencode-agents/README_2026-04-06_13-13-55.md`

## [2026-04-06 10:20] — Add Chrome DevTools MCP to OpenCode

- **Feature:** `opencode-agents`
- **Type:** `feat`
- **Changed:** Added a project-scoped `chrome-devtools` MCP server to `opencode.json` so OpenCode can launch `chrome-devtools-mcp` directly alongside the existing skill permissions, and refreshed the OpenCode agent docs snapshot.
- **Why:** OpenCode needed live browser tooling available through MCP for direct Chrome debugging and console inspection.
- **Impact:** `opencode.json`, `docs/opencode-agents/README_2026-04-06_10-20-28.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/opencode-agents/README_2026-04-06_10-20-28.md`

## [2026-04-06 10:02] — Enable browser-based OpenCode validation

- **Feature:** `opencode-agents`
- **Type:** `feat`
- **Changed:** Exposed repository-approved OpenCode skills in `opencode.json`, added a `browser-qa-engineer` subagent for real-browser web app testing, and updated the frontend and test agents to use the `chrome-devtools` skill for live UI validation.
- **Why:** OpenCode needed a direct way to verify frontend behavior in the running application instead of relying only on static reasoning or code-level tests.
- **Impact:** `opencode.json`, `.opencode/agents/browser-qa-engineer.md`, `.opencode/agents/test-engineer.md`, `.opencode/agents/frontend-ui-ux-designer.md`, `docs/opencode-agents/README_2026-04-06_10-02-14.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/opencode-agents/README_2026-04-06_10-02-14.md`

## [2026-04-06 10:00] — Tighten OpenCode agent permissions and add specialist roles

- **Feature:** `opencode-agents`
- **Type:** `feat`
- **Changed:** Tightened OpenCode bash permissions to default to approval with explicit safe-command allowlists, added `refactoring-maintainer` and `docs-maintainer` subagents, and tuned specialist prompts to the repository's NestJS backend, React frontend, and Python ADK/gRPC split.
- **Why:** The initial agent setup needed safer command defaults, explicit support for refactoring and documentation work, and prompts grounded in the actual repository architecture.
- **Impact:** `opencode.json`, `.opencode/agents/backend-architect.md`, `.opencode/agents/frontend-ui-ux-designer.md`, `.opencode/agents/test-engineer.md`, `.opencode/agents/performance-engineer.md`, `.opencode/agents/debugger-root-cause.md`, `.opencode/agents/ai-systems-engineer.md`, `.opencode/agents/refactoring-maintainer.md`, `.opencode/agents/docs-maintainer.md`, `docs/opencode-agents/README_2026-04-06_10-00-31.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/opencode-agents/README_2026-04-06_10-00-31.md`

## [2026-04-06 09:56] — Add project OpenCode agent team

- **Feature:** `opencode-agents`
- **Type:** `feat`
- **Changed:** Added a project-level `opencode.json` with `build` and `plan` task-permission routing, and created project-local OpenCode subagents for backend architecture, frontend UX, review, testing, security, performance, debugging, and AI systems work.
- **Why:** The repository needed a reusable OpenCode team setup optimized for software delivery quality, safety, maintainability, and specialist delegation.
- **Impact:** `opencode.json`, `.opencode/agents/backend-architect.md`, `.opencode/agents/frontend-ui-ux-designer.md`, `.opencode/agents/code-reviewer.md`, `.opencode/agents/test-engineer.md`, `.opencode/agents/security-auditor.md`, `.opencode/agents/performance-engineer.md`, `.opencode/agents/debugger-root-cause.md`, `.opencode/agents/ai-systems-engineer.md`, `docs/opencode-agents/README_2026-04-06_09-56-28.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/opencode-agents/README_2026-04-06_09-56-28.md`

## [2026-04-06 09:22] — Add playbook generation preprompt registry

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Routed the playbook autobuilder preprompt through the prompt registry, added a `playbook.generate` prompt slot, and passed `prompt_overrides` through the generation and design gRPC requests.
- **Why:** The generation path was still using a hardcoded preprompt, so admin prompt edits were not affecting newly generated playbooks.
- **Impact:** `YellowStorm/back/src/modules/playbook/services/playbook-design.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-prompt.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-design.service.spec.ts`, `YellowStorm/back/src/modules/conversation/proto/chatbot.proto`, `yellowstorm-adk/grpc/proto/chatbot.proto`, `yellowstorm-adk/src/grpc_server/chatbot_servicer.py`, `yellowstorm-adk/src/langgraph_engine/generate_playbook_prompt.py`, `yellowstorm-adk/src/grpc_generated/chatbot_pb2.py`, `docs/playbook/README_2026-04-06_09-22-02.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-06_09-22-02.md`

## [2026-04-06 07:51] — Finalize cancelled workflow streams correctly

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Taught the backend workflow stream consumer to recognize locally cancelled gRPC streams in the `end` handler, not just the `error` handler, and added a regression test for the `cancel -> end` path.
- **Why:** Some cancelled workflow streams were ending cleanly and being misclassified as failed with `Stream ended unexpectedly before all tasks completed`.
- **Impact:** `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.spec.ts`, `docs/playbook/README_2026-04-06_07-51-44.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-06_07-51-44.md`

## [2026-04-06 07:34] — Batch frontend playbook stream updates

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Batched rapid frontend `playbook_step_update` SSE events per execution step and flushed them before terminal events, with regression tests covering batching and ordering.
- **Why:** The UI could freeze when streaming started because every partial update immediately hit the store and rerendered the playbook frontend.
- **Impact:** `YellowStorm/front/src/modules/playbook/services/playbookStreamService.ts`, `YellowStorm/front/src/modules/playbook/services/playbookStreamService.test.tsx`, `docs/playbook/README_2026-04-06_07-34-04.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-06_07-34-04.md`

## [2026-04-06 07:30] — Add workflow results download

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Added a combined HTML export for all workflow step results and surfaced it as a new download action in the execution header.
- **Why:** Users need a single artifact that captures the full workflow run output, not just the selected step.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/ExecutionHeader.tsx`, `YellowStorm/front/src/modules/playbook/utils/renderStepResultHtml.ts`, `YellowStorm/front/src/modules/playbook/components/ExecutionHeader.test.tsx`, `YellowStorm/front/src/modules/playbook/utils/renderStepResultHtml.test.ts`, `YellowStorm/front/src/modules/playbook/locales/en.json`, `YellowStorm/front/src/modules/playbook/locales/fr.json`, `docs/playbook/README_2026-04-06_07-30-50.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-06_07-30-50.md`

## [2026-04-06 07:22] — Clear stale active-run state

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Tightened execution-state reconciliation so terminal refetches clear stale active-run state, and added regression coverage for the completed-vs-running merge path.
- **Why:** The Run button could remain stuck in a running state when the terminal SSE event was missed but the subsequent refetch proved the execution had already completed.
- **Impact:** `YellowStorm/front/src/modules/playbook/store.ts`, `YellowStorm/front/src/modules/playbook/store.test.ts`, `docs/playbook/README_2026-04-06_07-22-39.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-06_07-22-39.md`

## [2026-04-06 07:03] — Trim playbook canvas churn

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Removed the complementary artefact badge from playbook node cards and changed the live execution canvas to reuse unchanged node and edge objects instead of recreating the full overlay on every streamed update.
- **Why:** Large workflow runs were freezing the frontend, and the extra per-node artefact pane added avoidable DOM and reconciliation work during frequent execution updates.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/PlaybookNode.tsx`, `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`, `YellowStorm/front/src/modules/playbook/components/PlaybookNode.test.tsx`, `docs/playbook/README_2026-04-06_07-03-14.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-06_07-03-14.md`

## [2026-04-06 05:59] — Reuse final output synthesis in workflow nodes

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Updated the full-workflow graph-builder executor to run the same post-stream structured-output synthesis and authoritative artifact materialization that single-step execution already used, and added regression coverage that the workflow node writes synthesized artifacts into `artifacts_by_port` for downstream tasks.
- **Why:** Workflow runs were still deriving downstream port state from raw components only, which meant upstream tasks with semantically ambiguous output ports could complete successfully in single-step mode but leave no routed artifacts for downstream input-port document bindings during full workflow execution.
- **Impact:** `yellowstorm-adk/src/langgraph_engine/graph_builder.py`, `yellowstorm-adk/tests/langgraph_engine/test_graph_builder.py`, `docs/playbook/README_2026-04-06_05-59-30.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-06_05-59-30.md`

## [2026-04-06 05:30] — Synthesize final port outputs after streaming

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Added a post-stream structured-output synthesis pass for tasks with semantically ambiguous output ports, exposed output port names and descriptions as semantic targets in the task prompt, built authoritative final `TaskArtifact` entries from the completed result instead of partial stream text, and skipped unassigned preview text when multiple text ports exist.
- **Why:** Streaming text is a live draft and cannot be reliably classified into ports token-by-token, especially when several output ports share the same artifact kind and differ only by semantic intent such as `Summary` versus `Specific Context`.
- **Impact:** `yellowstorm-adk/src/langgraph_engine/step_executor.py`, `yellowstorm-adk/src/langgraph_engine/graph_builder.py`, `yellowstorm-adk/src/langgraph_engine/port_resolution.py`, `yellowstorm-adk/tests/langgraph_engine/test_step_executor.py`, `yellowstorm-adk/tests/langgraph_engine/test_graph_builder.py`, `YellowStorm/back/src/modules/playbook/utils/execution.utils.ts`, `YellowStorm/back/src/modules/playbook/utils/execution.utils.spec.ts`, `docs/playbook/README_2026-04-06_05-30-29.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-06_05-30-29.md`

## [2026-04-05 19:26] — Route file artifacts by filename when port ids are omitted

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Added filename-based output-port inference for generated file artifacts in both the ADK graph builder and the backend execution artifact mapper, so artifacts like `out-0f975e8a.pdf` can be routed deterministically even when the producer omits `output_port_id`.
- **Why:** Whole-workflow runs were still failing when a task produced a valid artifact without `output_port_id` and multiple compatible document-like output ports existed, which left downstream tasks waiting for an artifact that was never assigned to a port.
- **Impact:** `yellowstorm-adk/src/langgraph_engine/graph_builder.py`, `YellowStorm/back/src/modules/playbook/utils/execution.utils.ts`, `YellowStorm/back/src/modules/playbook/utils/execution.utils.spec.ts`, `docs/playbook/README_2026-04-05_19-26-59.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-05_19-26-59.md`

## [2026-04-05 18:54] — Make output port routing deterministic

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Added explicit `output_port_id` routing metadata to playbook text/code/artifact components, inferred artifact kinds from filenames and MIME types when producers omit them, updated both ADK and Nest routing logic to reject ambiguous compatible ports instead of assigning by port order, and documented declared output ports in the task prompt.
- **Why:** Output routing was coupled to artifact order and broad kind matching, which made nodes with multiple text outputs or multiple document-like outputs unreliable and could silently send artifacts to the wrong downstream port.
- **Impact:** `yellowstorm-adk/grpc/proto/chatbot.proto`, `yellowstorm-adk/src/grpc_generated/chatbot_pb2.py`, `yellowstorm-adk/src/grpc_generated/chatbot_pb2_grpc.py`, `yellowstorm-adk/src/grpc_server/chatbot_servicer.py`, `yellowstorm-adk/src/langgraph_engine/graph_builder.py`, `yellowstorm-adk/src/langgraph_engine/port_resolution.py`, `yellowstorm-adk/src/langgraph_engine/playbook_tool_factory.py`, `yellowstorm-adk/tests/langgraph_engine/test_graph_builder.py`, `YellowStorm/back/src/modules/conversation/proto/chatbot.proto`, `YellowStorm/back/src/modules/conversation/utils/component-mapper.ts`, `YellowStorm/back/src/modules/playbook/utils/execution.utils.ts`, `YellowStorm/back/src/modules/playbook/utils/execution.utils.spec.ts`, `docs/playbook/README_2026-04-05_18-54-41.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-05_18-54-41.md`

## [2026-04-05 18:31] — Auto-follow streaming execution detail

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Added auto-scroll behavior to the execution detail panel during live streaming and a jump-to-bottom button when the viewer scrolls away from the tail, with regression coverage for both the auto-follow and the escape hatch.
- **Why:** Even after streaming was fixed, long-running runs were still hard to follow because the newest updates could scroll out of view without a quick way to jump back to the live tail.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.test.tsx`, `docs/playbook/README_2026-04-05_18-31-39.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-05_18-31-39.md`

## [2026-04-05 18:24] — Stream live progress for whole workflows

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Wired full-workflow graph execution to pass `on_progress` into live tool runs, replay tool runs, and direct LLM calls, converting partial task output/tool/component updates into `in_progress` step updates, and included artifacts on completed workflow step chunks.
- **Why:** Whole-workflow executions were still showing step results only as a final block because the graph builder emitted only start/complete step updates and never forwarded partial progress from task execution.
- **Impact:** `yellowstorm-adk/src/langgraph_engine/graph_builder.py`, `docs/playbook/README_2026-04-05_18-24-59.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-05_18-24-59.md`

## [2026-04-05 18:20] — Prefer live current attempt in result tab

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Updated the frontend step detail view to replace persisted `stepExecutions` history for the current attempt with the live in-memory task snapshot before rendering the result tab and execution picker, and added regression coverage for that selection rule.
- **Why:** Realtime step updates could still appear only as a final block because the result tab was rendering an older persisted snapshot for the same attempt number instead of the actively streaming current step.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.test.tsx`, `docs/playbook/README_2026-04-05_18-20-42.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-05_18-20-42.md`

## [2026-04-05 18:15] — Stream non-text single-step progress

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Updated the ADK single-step stream to attach in-progress `result` payloads for tool traces, prompt traces, components, and artifacts even when no partial text output exists yet.
- **Why:** Tool-driven steps could still appear as a single final block because realtime progress without text was being dropped before it reached the Nest SSE bridge and the step detail result tab.
- **Impact:** `yellowstorm-adk/src/grpc_server/chatbot_servicer.py`, `docs/playbook/README_2026-04-05_18-15-32.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-05_18-15-32.md`

## [2026-04-05 18:03] — Fix streamed PlaybookStepUpdate protobuf building

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Reworked streamed step update protobuf construction in the ADK servicer to build `PlaybookStepUpdate` first and `CopyFrom(...)` nested result and interrupt payloads, removing the protobuf kwargs path that could misinterpret raw result dicts containing logical `output` keys.
- **Why:** Single-step realtime streaming was still failing before the result tab could update because protobuf raised `ValueError: Protocol message PlaybookTaskResult has no "output" field` while serializing streamed step updates.
- **Impact:** `yellowstorm-adk/src/grpc_server/chatbot_servicer.py`, `docs/playbook/README_2026-04-05_18-03-07.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-05_18-03-07.md`

## [2026-04-05 17:47] — Harden single-step terminal streaming

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Normalized streamed step status in the Nest execution service so terminal state can be recovered from `step_update.result.status`, added regression coverage for that shape, and made the ADK step stream emit a terminal failed chunk when protobuf serialization of a step update breaks.
- **Why:** Single-step runs were still ending after an `in_progress` update with no terminal chunk visible to the backend, which caused valid runs to be marked failed instead of streaming their final result.
- **Impact:** `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.spec.ts`, `yellowstorm-adk/src/grpc_server/chatbot_servicer.py`, `docs/playbook/README_2026-04-05_17-47-12.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-05_17-47-12.md`

## [2026-04-05 17:18] — Fix streaming step finalization

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Simplified the single-step streaming RPC so it drains progress updates and always emits a terminal chunk after the execution completes, preventing progress-only streams from being treated as failed runs.
- **Why:** The backend was receiving live updates but not a terminal step event, so interactive node runs were being marked failed even though the step was still executing.
- **Impact:** `yellowstorm-adk/src/grpc_server/chatbot_servicer.py`, `yellowstorm-adk/src/langgraph_engine/step_executor.py`, `yellowstorm-adk/src/langgraph_engine/graph_builder.py`, `yellowstorm-adk/src/langgraph_engine/workflow_service.py`, `docs/playbook/README_2026-04-05_17-18-43.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-05_17-18-43.md`

## [2026-04-05 17:12] — Stream single-step node runs

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Added a streaming gRPC path for single-step playbook execution, wired the playbook UI to request streaming for interactive runs, and merged live step progress into the execution cache so node switching keeps the active stream visible.
- **Why:** Node execution was returning only one final block, which made interactive runs feel blocked and hid intermediate tool/text progress.
- **Impact:** `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-grpc.service.ts`, `YellowStorm/back/src/modules/playbook/controllers/playbook.controller.ts`, `YellowStorm/back/src/modules/conversation/proto/chatbot.proto`, `yellowstorm-adk/src/grpc_server/chatbot_servicer.py`, `yellowstorm-adk/src/grpc_generated/chatbot_pb2_grpc.py`, `YellowStorm/front/src/modules/playbook/store.ts`, `YellowStorm/front/src/modules/playbook/services/playbookStreamService.ts`, `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`, `YellowStorm/front/src/modules/playbook/types.ts`, `docs/playbook/README_2026-04-05_17-12-56.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-05_17-12-56.md`

## [2026-04-05 16:19] — Move playbook node port labels to side rails

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Moved playbook node port labels into external left and right rails, capped their width, used bound input filenames when available, and added hover titles plus selected-node highlighting.
- **Why:** The previous in-card label placement competed with node content and made port-to-handle mapping harder to scan.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/PlaybookNode.tsx`, `YellowStorm/front/src/modules/playbook/components/PortLabel.tsx`, `docs/playbook/README_2026-04-05_16-19-16.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-05_16-19-16.md`

# [2026-04-05 11:13] — Show idle playbook state on cards

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** The playbook list badge now renders `Idle` when no execution is running, while preserving the running spinner state.
- **Why:** The home page should always show a state badge so users can distinguish an idle playbook from one that is actively running.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/PlaybookStatusBadge.tsx`, `YellowStorm/front/src/modules/playbook/components/PlaybookCard.tsx`, `YellowStorm/front/src/modules/playbook/components/PlaybookCard.test.tsx`, `docs/playbook/README_2026-04-05_11-13-39.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-05_11-13-39.md`

# [2026-04-05 11:13] — Fix playbook summary execution typing

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Imported `ExecutionStatus` into the backend playbook interface so the summary contract compiles again with the new execution-status field.
- **Why:** The backend start command failed type-checking after the list summary contract gained realtime execution state.
- **Impact:** `YellowStorm/back/src/modules/playbook/interfaces/playbook.interface.ts`, `docs/playbook/README_2026-04-05_11-13-39.md`, `docs/DOC_INDEX.md`
- **Doc:** `created` `/docs/playbook/README_2026-04-05_11-13-39.md`

## [2026-04-03 11:45] — Port-aware drag-and-drop from workspace explorer to node input ports

- **Feature:** `task-toolbar`
- **Type:** `feat`
- **Changed:** Added coordinate-based port hit detection so users can drag documents onto specific input ports. The workspace explorer now infers `artifactKind` from file extensions/MIME types and includes it in the drag payload. `PlaybookNode` highlights the closest port during drag-over with green (compatible), red (mismatch), or neutral ring feedback. Dropped files are stored with `portId` binding. `InputFile` type extended with `portId` and `artifactKind`. The input-files popover shows bound count and per-file artifact kind dots.
- **Why:** Users need to bind specific documents to specific typed ports rather than adding files generically to a node.
- **Impact:** `types.ts`, `PlaybookNode.tsx`, `WorkspaceExplorerSidebar.tsx`, `InputFilesPopover.tsx`, `store.ts`, `infer-artifact-kind.ts` (new), `port-hit-detection.ts` (new)
- **Doc:** `created` `/docs/task-toolbar/README_2026-04-03_11-45-00.md`

## [2026-04-02 13:10] — Persist step execution history for results-tab inspection

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Replaced the incorrect workflow-level results picker with persisted step-execution history, added a delete endpoint for archived step executions, and updated the results-tab dropdown to support per-entry removal with a trash action.
- **Why:** Step executions are distinct from workflow executions, so the results tab needed a real step-level history model instead of reusing the workflow execution list.
- **Impact:** `YellowStorm/back/src/modules/playbook/schemas/playbook-execution.schema.ts`, `YellowStorm/back/src/modules/playbook/services/playbook-execution.service.ts`, `YellowStorm/back/src/modules/playbook/services/playbook.service.ts`, `YellowStorm/back/src/modules/playbook/controllers/playbook-execution.controller.ts`, `YellowStorm/front/src/modules/playbook/types.ts`, `YellowStorm/front/src/modules/playbook/store.ts`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.test.tsx`, `YellowStorm/front/src/lib/api/config.ts`, `YellowStorm/front/src/modules/playbook/api.ts`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_13-10-28.md`
## [2026-04-02 12:47] â€” Add results-tab execution selection for step results

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Added a workflow execution selector to the step results tab so users can switch the visible panel to a specific execution, while keeping the evaluation comparison selector intact.
- **Why:** The step result view needed the same execution-selection affordance as the evaluation view so users can inspect a specific run directly from the results tab.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.test.tsx`, `YellowStorm/front/src/modules/playbook/locales/en.json`, `YellowStorm/front/src/modules/playbook/locales/fr.json`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_12-47-09.md`
 [2026-04-02 12:34] â€” Add step execution comparison and workflow deletion controls

- **Feature:** `playbook`
- **Type:** `feat`
- **Changed:** Added a step-level execution comparison view in the evaluation panel, added a trash action for the selected workflow execution with confirmation, and reordered/renamed node contextual menu actions so execute comes first and output-format capture is labeled `Save output format`.
- **Why:** Users need to compare individual step executions, remove obsolete workflow executions, and have the node menu reflect the primary action order and clearer terminology.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/ExecutionPanel.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionPanel.test.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.test.tsx`, `YellowStorm/front/src/modules/playbook/components/PlaybookNode.tsx`, `YellowStorm/front/src/modules/playbook/locales/en.json`, `YellowStorm/front/src/modules/playbook/locales/fr.json`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_12-34-04.md`
## [2026-04-02 12:13] ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â Compact evaluation KPI layout and add node baseline actions

- **Feature:** `playbook`
- **Type:** `refactor`
- **Changed:** Removed the muted intro block from the evaluation tab, moved the KPI cards to the top of the panel, and added contextual menu actions for saving a replay baseline and grabbing the output-format template from completed nodes.
- **Why:** The evaluation section needed more vertical space for the KPI cards, and the node-level replay/output-format actions belong in the task context menu.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`, `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.test.tsx`, `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`, `YellowStorm/front/src/modules/playbook/components/PlaybookNode.tsx`, `YellowStorm/front/src/modules/playbook/locales/en.json`, `YellowStorm/front/src/modules/playbook/locales/fr.json`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_12-13-20.md`

## [2026-04-02 12:00] ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Strip UI-only playbook task fields before PATCH

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Reworked `sanitizePlaybookUpdate()` to rebuild each task from a backend-safe allow-list and added a regression test so `isSavingReplayBaseline` and other client-only flags are excluded from the PATCH payload.
- **Why:** The backend validation layer rejects unknown task properties, and autosave was sending replay UI state that should never have left the client.
- **Impact:** `YellowStorm/front/src/modules/playbook/api.ts`, `YellowStorm/front/src/modules/playbook/api.test.ts`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_12-00-27.md`

## [2026-04-02 11:57] ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Clarify the execution polling guard

- **Feature:** `playbook`
- **Type:** `refactor`
- **Changed:** Simplified the `PlaybookCanvasPage` polling guard so the selected execution is checked first and live polling only falls back to the latest execution when no explicit selection exists.
- **Why:** The previous guard was correct but harder to read; the intent needed to be obvious because it controls whether the UI can snap back to a different execution.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_11-57-25.md`

## [2026-04-02 11:56] ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Keep manual execution selection from snapping back to latest live run

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Updated `PlaybookCanvasPage` so background polling only follows a live execution when no explicit execution is already selected. The canvas now keeps the user-chosen execution as the authoritative view.
- **Why:** Selecting a specific execution could be overwritten by the page's latest-execution fallback, making the UI snap back to the most recent live run.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_11-56-46.md`

## [2026-04-02 11:00] ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Make playbook agent assignment mapping defensive

- **Feature:** `playbook`
- **Type:** `fix`
- **Changed:** Replaced the direct `new Types.ObjectId(node.assigned_agent_id)` conversion in `PlaybookDesignService.mapGrpcResponseToTasksAndEdges()` with a guarded helper that returns `null` for missing, empty, or invalid identifiers.
- **Why:** The gRPC runtime can emit non-Mongo agent identifiers, and the previous mapping crashed playbook generation with a `BSONError` instead of continuing with an unassigned task.
- **Impact:** `YellowStorm/back/src/modules/playbook/services/playbook-design.service.ts`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_11-00-20.md`

## [2026-04-02 09:37] ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Center playbook node side connectors

- **Feature:** `playbook`
- **Type:** `refactor`
- **Changed:** Updated playbook node handle styling so side connectors are vertically centered on their anchor position instead of sitting offset from the middle of the node edge.
- **Why:** The connector dots looked visually misaligned compared with the desired centered canvas layout.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/PlaybookNode.tsx`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_09-37-45.md`
## [2026-04-02 09:37] ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Align typed-port handles with the node midpoint

- **Feature:** `task-toolbar`
- **Type:** `refactor`
- **Changed:** Kept the typed port model intact while adjusting dynamic handle rendering so each handle is centered around its computed vertical anchor, preserving multi-port spacing and handle ids.
- **Why:** Handle placement belongs to the task-toolbar node system and needed a rendering-only fix without changing edge contracts.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/PlaybookNode.tsx`
- **Doc:** `created` `/docs/task-toolbar/README_2026-04-02_09-37-45.md`
## [2026-04-02 09:26] ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Clean the playbook Auto Builder modal chrome

- **Feature:** `playbook`
- **Type:** `refactor`
- **Changed:** Flattened the Auto Builder visual hierarchy, reduced modal height again, softened the segmented control, and toned down section framing to make the create modal cleaner.
- **Why:** The previous iteration was still visually busy around the tab strip and card surfaces.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/CreatePlaybookDialog.tsx`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_09-26-29.md`

## [2026-04-02 09:20] ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Make the playbook creation modal more minimal and compact

- **Feature:** `playbook`
- **Type:** `refactor`
- **Changed:** Simplified the Auto Builder modal into a shorter, quieter layout: removed the left guidance column, reduced the shell height, tightened the prompt composer, limited quick starts to two entries, and kept naming/workspace fields in a compact secondary section.
- **Why:** The prior redesign still felt too tall and visually busy for a prompt-first creation flow.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/CreatePlaybookDialog.tsx`, `YellowStorm/front/src/modules/playbook/locales/en.json`, `YellowStorm/front/src/modules/playbook/locales/fr.json`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_09-20-56.md`

## [2026-04-02 08:37] ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Redesign the playbook creation modal around the prompt bar

- **Feature:** `playbook`
- **Type:** `refactor`
- **Changed:** Reworked `CreatePlaybookDialog` into a more intentional modal shell with layered header/background/footer treatment, stronger tab styling, and a two-column Auto Builder composition. The prompt bar remains the primary action, while supporting guidance, quick starts, naming, and workspace context are organized into distinct sections. Added the supporting English and French copy for the redesigned layout.
- **Why:** The earlier iterations fixed the default tab and shell sizing, but the modal still needed a more coherent UI/UX treatment while preserving the prompt-bar interaction model.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/CreatePlaybookDialog.tsx`, `YellowStorm/front/src/modules/playbook/locales/en.json`, `YellowStorm/front/src/modules/playbook/locales/fr.json`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_08-37-16.md`

## [2026-04-02 08:23] ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Default Auto Builder tab and harmonize the create dialog shell

- **Feature:** `playbook`
- **Type:** `refactor`
- **Changed:** Made Auto Builder the default tab when opening New Playbook, widened the modal shell, capped its height with scrolling, and replaced the dark prompt card with a light neutral prompt surface that matches the surrounding window palette.
- **Why:** The previous iteration improved the Auto Builder layout but still opened on Manual and used a dark surface that did not match the target reference.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/CreatePlaybookDialog.tsx`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_08-23-48.md`

## [2026-04-02 07:24] ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Refactor Auto Builder create dialog into prompt-first composer

- **Feature:** `playbook`
- **Type:** `refactor`
- **Changed:** Reworked the frontend `CreatePlaybookDialog` Auto Builder tab into a prompt-bar style experience with a hero heading, dark prompt composer, inline generate button, example prompt chips, and a secondary details section for optional workflow naming plus workspace selection. Added fallback name derivation from the prompt so generation still submits a valid `name` when the explicit field is left blank. Added the supporting English and French locale keys.
- **Why:** The previous Auto Builder tab still looked like a conventional modal form. This iteration aligns it with the desired prompt-first creation UX while keeping the existing generate flow intact.
- **Impact:** `YellowStorm/front/src/modules/playbook/components/CreatePlaybookDialog.tsx`, `YellowStorm/front/src/modules/playbook/locales/en.json`, `YellowStorm/front/src/modules/playbook/locales/fr.json`
- **Doc:** `created` `/docs/playbook/README_2026-04-02_07-24-46.md`

## [2026-04-01 17:00] ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Fix autosave stripping port fields from playbook response

- **Feature:** `task-toolbar`
- **Type:** `fix`
- **Changed:** Added `enabled`, `taskType`, `inputPorts`, `outputPorts`, `stepReplayMode` to `mapToResponse()` task mapping in `playbook.service.ts`. Added `sourceOutputPortId`, `targetInputPortId` to edge mapping in the same method. Added corresponding fields to `PlaybookTaskData` and `PlaybookEdgeData` interfaces in `playbook.interface.ts`. The data was already being saved to MongoDB correctly via `$set`, but the API response used an explicit field map that omitted the Week 1-4 port/type fields, causing the frontend's `currentPlaybook` to lose ports on every save cycle.
- **Why:** After autosave, `currentPlaybook` was replaced with the server response which lacked `inputPorts`, `outputPorts`, `taskType` on tasks and `sourceOutputPortId`, `targetInputPortId` on edges ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â making port settings appear to not persist.
- **Impact:** `playbook.service.ts` (mapToResponse), `playbook.interface.ts` (PlaybookTaskData, PlaybookEdgeData)
- **Doc:** n/a

- **Feature:** `task-toolbar`
- **Type:** `feat`
- **Changed:** Added `artifacts` field to `PlaybookStepCompleteEvent` SSE type and propagated through the `onStepComplete` handler into execution cache task results. Created `ArtifactBadge` component: color-coded badge row showing artifact kinds with icons (matching port color palette), tooltip with kind counts, overflow +N indicator. Rendered `ArtifactBadge` on `PlaybookNode` below existing replay/format badges, reading from `currentExecution.taskResults`. Created `ArtifactListItem` in `ExecutionStepDetail`: icon + filename + kind badge + size + truncated content preview for text/code artifacts + download button (Blob URL for inline content, new tab for URL artifacts). Added artifact section in the results tab after the output/running indicator. Added i18n keys `artifacts.title`, `artifacts.sectionTitle`, `artifacts.noArtifacts` in en/fr. Exported `ArtifactBadge` from module index. Marked feature status as stable.
- **Why:** Users can now see at a glance what artifacts a completed step produced (on the node badge) and inspect/download them in the step detail panel, completing the visual artifact lifecycle.
- **Impact:** `types.ts`, `store.ts`, `ArtifactBadge.tsx` (new), `PlaybookNode.tsx`, `ExecutionStepDetail.tsx`, `index.ts`, `en.json`, `fr.json`
- **Doc:** created `/docs/task-toolbar/README_2026-04-01_16-45-00.md`
# Changelog

## [2026-04-23 00:00 UTC] — Add webapp frontend guidelines documentation

- **Feature:** `webapp-frontend`
- **Type:** `docs`
- **Changed:** Added a new frontend-guidelines feature README derived from `YellowStorm/front/FRONTEND_GUIDELINES.md`, and registered the new slug in the documentation index.
- **Why:** The repository needed a dedicated maintainer-owned documentation entry for the frontend coding guidelines so the frontend stack, conventions, and review rules are easy to find.
- **Impact:** `docs/webapp-frontend/README.md`, `docs/DOC_INDEX.md`
- **Readme:** `/docs/webapp-frontend/README.md`
## [2026-04-23 00:00 UTC] — Normalize conversation chart streaming contract

- **Feature:** `conversation-charts`
- **Type:** `feat`
- **Changed:** Added a stable inline chart contract for streamed assistant responses, normalized chart component handling in the backend mapper, and aligned the frontend conversation message types and rendering flow for `bar`, `line`, `area`, `pie`, `scatter`, and `composed` charts. The backend now emits chart chunks as `action: add` events with a stable `component_id`, and the frontend chart payload parser accepts both camelCase and legacy snake_case field variants.
- **Why:** The conversation UI needs a predictable chart payload so streamed chart chunks render reliably inside assistant bubbles without depending on ad-hoc proto shapes or field-name drift between backend and frontend.
- **Impact:** `YellowStorm/back/src/modules/conversation/utils/component-mapper.ts`, `YellowStorm/back/src/modules/conversation/utils/component-mapper.spec.ts`, `YellowStorm/front/src/modules/conversation/types.ts`, `YellowStorm/front/src/modules/conversation/utils.ts`, `YellowStorm/front/src/modules/conversation/store.ts`, `YellowStorm/front/src/components/ai-elements/ai-message-content.tsx`, `yellowstorm-adk/src/smart_rag/engines/multi_agent/streaming_processor.py`, `docs/conversation-charts/README.md`, `docs/DOC_INDEX.md`
- **Readme:** `/docs/conversation-charts/README.md`
