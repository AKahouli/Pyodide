# Conversation background-work UX implementation plan

## Accepted experience

Normal Conversation remains the primary reading/writing surface. Background work belongs to its originating request, with worker/fan-out/follow-up stages grouped together. Outline starts collapsed and shares one optional, resizable context pane with Work. The composer and a compact activity strip stay visible; history and technical activity cannot consume the chat viewport.

## Parallel ownership

1. **coding_layout** — ConversationPage/Header, uiStore, outline, context pane and their tests. Persist bounded width/visibility; keyboard resizing; mobile overlay; one Outline/Work pane.
2. **coding_work** — RootWorkPanel/rows, shared conversation-scoped observer/store, grouping, task details, full results, cancellation and tests. One poller independent of pane visibility; attention first; settled history collapsed; no unsupported item cancellation or retry.
3. **coding_continuity** — ConversationContent/Input and message-store continuity, contextual result messages, unread acknowledgement, scroll/draft preservation and tests.
4. **Primary integration** — additive backend/public contracts and matching frontend types, trusted origin IDs, real fan-out item states, task-input placement, translations, integration, service lifecycle and browser verification.

Shared interfaces: uiStore exposes contextPanel (`outline` / `work` / null), setContextPanel, contextPanelWidth/setContextPanelWidth; RootWorkPanel uses `variant="dock"` or `variant="details"`. rootWorkStore exposes snapshots and unreadPublicationIds keyed by conversation plus markResultRead. Locale files and shared contract types have one owner.

## Contract and behavior requirements

- Pin origin question/assistant message IDs from the server-created Root placeholder. Preserve them as server-owned state. Legacy jobs can omit origin links; never infer by message order or Root execution ID.
- Snapshot exposes bounded, authorized fan-out items from sealed manifests and actual execution state. Coordinator cancellation remains the supported control.
- Followup text carries background-work context without altering questionMessageId branch/regeneration semantics. Full-result inspection reuses the existing authorized root-results endpoint.
- Distinguish execution completion from unread results. Viewing a task pane does not mark every result read. Preserve drafts, focus, older loaded history and scroll position on asynchronous publication.
- Existing native input/approval execution bindings remain intact; forms are bounded within Work and attention remains discoverable while it is closed.
- Do not add foreground-message queueing, pause/resume, unsafe retries, mutable running-task instructions, or fabricated percentages. Changes to active task instructions retain the existing cancel/new-request semantics.

## Acceptance and gates

- Desktop and mobile: chat/composer remain usable with multiple completed tasks and expanded activity; collapsed pane consumes no column; resizing stays bounded and works with keyboard.
- One grouped work item covers siblings, fan-out and synthesis; actual item counts/statuses; task-specific cancellation and input preserve other work.
- New followup identifies its request, opens its work details/full result, survives reload, and does not force-scroll a reader or erase a draft.
- Regression tests for grouping, unread lifecycle, stale/epoch/auth handling, input bindings, message merging, pane persistence and resizing.
- Backend/frontend builds and applicable TypeScript checks, logging policy, independent review and frontend QA. Restart only necessary local services after checking active work; test real Smart Agent background flow in signed-in browser.
- Record remaining limits and verified evidence in the handoff/memory. CRG tools are unavailable in this session; investigation uses focused source reads.

## Progress

- Planning: complete; boundary review complete.
- Parallel implementation and integration: complete (three bounded coding workstreams).
- Checks: frontend/backend builds and TypeScript passed; backend contract/integration suites 56 passed, one optional provider qualification skipped. Targeted frontend suites passed, including a final 17-test work/result regression run. Observability policy passed with no new violations (147 legacy baseline sites).
- Independent review and source frontend QA: PASS after one repair cycle. Fixed unloaded-history links, unread persistence across epoch changes, focus restoration and unread acknowledgement behind a modal.
- Browser acceptance: PASS for real two-item fan-out with simultaneous foreground answer (42), grouped item completion and full output, linked followup/original request, exact scroll and draft preservation, persisted desktop resizing, and mobile modal bounds without horizontal overflow. Frontend/backend restarted; user's viewport restored afterwards.
- Live clarification-form acceptance: BLOCKED by the test worker completing without opening an input request. Input routing/draft/submission tests passed (13); this is not claimed as a live form pass.
- Clarification retest (2026-10-10): ROOT input control is not automatically attached to temporary workers; ask essential questions before dispatch. Reproduced and repaired partial streamed input calls consuming metadata identities before complete arguments arrived. Live ROOT question/enum rendering, selected-answer persistence across pane close/reopen, submission/resume and forest worker completion passed. Also repaired and live-verified the untouched enum placeholder: required validation blocks an empty selection, then accepts an explicit choice. Native regression suites: 28 passed; input component suites: 14 passed.
- Added and imported `skills/mono-agent-work-orchestration/SKILL.md`, attached to Smart Agent while preserving docx/code-interpreter, and observed Activate Skill in the live trace. It describes direct/foreground/background/fan-out selection, complete assignments, clarification, authorized context, cancellation and committed paged results. YellowStorm import accepted its native frontmatter; the Codex-only validator rejects YellowStorm's supported `compatibility` field and is not the target-format validator.
- Profile-change regression: individually unauthorized historical jobs no longer fail the entire snapshot; inaccessible fan-out coordinators are omitted without leaking item labels. Unexpected failures and final conversation revalidation still fail normally. Nine backend tests, backend/frontend builds, observability policy and independent review passed. After backend restart, browser Tasks recovered the authorized forest task/result without changing authorization rules.
- Environment limitation: backend readiness reports the unrelated Playbook MCP dependency unavailable; conversation/native background flow is operational. Legacy work without trusted origin IDs is not backfilled.
