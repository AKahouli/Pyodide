# OpenUI 1.0 migration assessment and general mini-app plan

Status: **phases 1–4 qualified; phases 5–7 remain proposed**.

The [demo library reuse/migration map](openui-mini-app-library-map.md) proposes a
general composition and styling upgrade within the existing library, preserving
private drafts and document task results. It is a separate visual improvement;
the dynamic export and generated-code sandbox phases below retain their scope.
Assessed 2026-10-17 against this branch after chart-export commit `2f2e303c4`.
Other dirty work in the checkout is outside this assessment. Package versions below
are an assessment-date snapshot, not a claim about future registry releases.

## Outcome and acceptance criteria

Upgrade to OpenUI Lang 1.0, retaining Conversation v1 and its agent infrastructure.
Provide a reusable library and execution bridge from which the agent composes
different mini-apps. A calculator, document summarizer or planner is a generated
program and a test case, not a separately implemented product screen.

1. New 1.0 programs and existing saved conversations render with qualified libraries.
2. Inputs, calculations, validation and local actions work without an inference turn
   for each interaction; model/tool work is explicit and observable.
3. State survives reload with actor/conversation/component isolation and revision
   conflict handling; program edits cannot silently overwrite newer user input.
4. Document apps reuse authorized uploads, extraction, search and agent execution,
   with accurate handling of large, scanned, deleted and inaccessible documents.
5. DOCX/HTML/PDF use one reproducible saved snapshot, including chart visuals;
   editable PPTX uses the existing MCP connector and editable source data.

## Phase 1 implementation

The authorized phase 1 pins `lang-core`/`react-lang` to 1.0.1 and
`react-ui`/`react-headless` to 0.18.1. Thesys stays at 0.14.0 with the existing
peer overrides, React 18 and Zustand 5. No new schema, service, execution bridge
or persistence contract is introduced; no accepted platform ADR adds a constraint
to this dependency-only scope. Preserve legacy component signatures and programs.

At the phase 1 commit, regenerating the output-format prompt produced no change.
General bindings, functions and tool calls were not added to the production generation library.
A test-only 1.0 library qualifies reactive registered functions, local `@Set`,
numeric custom actions and JSON-roundtripped zero-valued state hydration.
Mounted legacy suites and browser/export checks qualify the retained libraries;
the upstream Thesys peer-range mismatch remains a future upgrade risk.

Qualification caveat: core 1.0.1's optional `library.extend()` implementation uses
`zod/v4/core.util.mergeDefs`, absent in Zod 3.25.76's embedded v4. Vite reports this
missing export. Source review confirms existing libraries, Thesys components and
the prompt generator use `createLibrary` without entering that extension path.
Before using `library.extend()` in a later phase, qualify a compatible scoped Zod
dependency and add an extension regression; do not broadly migrate existing Zod 3
forms to silence this warning.

Phase 1 checks: 267 focused tests cover legacy rendering, streaming/fallback,
images/history/actions, typed forms, table/chart state, report/slide providers and
DOCX/HTML/PDF/PPTX packaging. The first run exposed two stale lazy-loading store
mocks; correcting their callable selector shape restored the retry/fallback tests.
TypeScript and the production build pass. Independent SDK/provider review found
no blocking findings. Browser qualification on 2026-10-17:

- Conversation `c73786bee4cbcf72d2c23bae`: restored table query `a`, ascending
  Visits, Osaka 0/600 then Paris 2/900; chart Visits/Osaka/0. Downloaded HTML is
  byte-identical to the previous version. Downloaded DOCX has identical
  `word/document.xml` and embedded chart PNG bytes to its pre-migration export.
- Conversation `4bf095d93ca0d86e5cb91aa3`: saved form restores Osaka,
  notifications off and budget zero; generated landscape images and edits load
  at their original dimensions; intentional partial-gallery failure stays local.
  The corrected report loads all six web/PDF/upload original and edited images.
  The earlier malformed report still has reversed Image arguments; it is not a
  migration regression and was not rewritten.
- Conversation `4e08cbf1405b0f44f76eb7f5`: Japan slides and web-image actions
  render after a full reload. Actual PDF and PPTX downloads contain four slides,
  each with one full-slide image. All four PPTX image payloads are byte-identical
  to the 2026-10-14 export. Visual inspection finds existing text clipping on the
  photo slide, also present in that identical old export; compatibility passes,
  while slide text fitting remains separate debt. These are explicitly image
  exports, not editable slide content.

Initial reload required sign-in; after the user restored the session, the final
Japan reload and both exports succeeded. This phase does not requalify remote MCP
sandbox creation/delivery or add dynamic mini-app snapshot exports. The retained
legacy export projection and its failure/cancellation paths are covered by tests.

## Phase 2 implementation and qualification

The authorized phase 2 extends the existing Conversation OpenUI library with
`MiniApp`, `MiniInput`, `MiniSelect`, `MiniToggle`, `MiniButton`, `MiniOutput` and
`MiniList`. Programs compose these controls inside the existing `Card` root;
there are no app-specific calculator, scenario, list or summarizer screens.
Inputs bind directly to `$variables`, native expressions compute local results,
and `@Set`/`@Reset` perform local actions without inference. Numeric blank remains
null rather than becoming zero. Required/min/max form validation is enforced
before an `AskAgent` action independently of its generated validation flag;
local reset remains available on invalid input. Streaming and submission disable
the controls and reuse the existing interaction status/retry handling.

Four pure functions are registered: `FormatNumber`, `TextMetrics`, `FilterText`
and `JoinText`. Each function validates arguments and results inside its
implementation. A mounted regression exposed that the SDK's declared parameter
schemas did not enforce the decimal precision refinement before executing
`FormatNumber(1, 13)`. Internal Zod parsing now rejects invalid calls; the SDK
isolates the throw as null and `MiniOutput` displays a localized invalid/empty
result while a valid sibling remains visible. Inputs/results require finite
numbers, precision 0–12, lists of at most 200 strings and combined text of at
most 20,000 UTF-16 code units. Join separators are capped at 100 code units and
the joined output has the same text cap. Input controls accept at most 5,000 code
units each. No arbitrary code, HTML execution, tool provider or document access
is exposed through these functions.

`AskAgent` submits an explicit instruction and typed JSON inputs through the
existing `continue_conversation`/`openUiSubmission` contract. The backend retains
its bounded JSON/source-answer/conversation authorization checks and supplies
the canonical interaction to the normal agent turn. A document summarizer can
submit pasted text or identify an already authorized conversation/workspace
document for the agent's existing tools to read. It requests an attachment when
the source is missing/inaccessible and returns a grounded answer separately.
Text metrics are not a local AI summary. This phase adds no document selector,
execution bridge, asynchronous in-place result service or storage contract.

Local unsubmitted changes reset after reload. The existing accepted-submission
history rehydrates submitted bindings, including zero/false/empty values; draft
autosave, viewer state/CAS and dynamic snapshot exports remain later proposals.
Users can ask the normal agent to export a separate static answer/report or an
existing authorized artifact. Existing saved roots and legacy component schemas
remain unchanged.

The prompt generator transpiles the exact shared TypeScript component/function
definitions using the existing TypeScript dependency, including on Node 20.
Bindings are enabled and tool calls disabled. The generated prompt is 54,709
characters against a 55,000 soft target and 60,000 hard cap. No new dependency,
schema, service, runtime or applicable accepted platform ADR was introduced.

Phase 2 qualification: the final frontend run passes 251 tests in 31 files,
including 12 focused pure-function/mounted tests covering
converter/scenario/list/document-summary compositions, blank versus zero,
validation, reset, typed explicit submission, accepted-state hydration,
pending/streaming controls and invalid-function isolation. Existing compatibility
suites remain passing. Final TypeScript, production build and 14 backend
typed-contract tests pass; independent implementation/documentation review found
no blocking issues.

Live browser QA passed in conversation `0a36aab51f702536578737aa`:

- One natural-language request generated four different composed apps. Local
  conversion (100 Celsius to 212.00 Fahrenheit and reset to 32.00), discounted
  scenario total (18.00) and list filter (`Os` to Osaka) retained one assistant
  turn; these interactions did not trigger inference.
- The document-summary controls counted 171 source characters and 28 words.
  Selecting Detailed/French/bullets=false and explicitly submitting produced
  a new grounded French Card answer, including the source's zero-euro budget.
  Controls disabled while submitting and displayed the saved status afterward.
- Changing the source to an unsubmitted draft and reloading restored the
  accepted original source, Detailed/French/false choices and the summary.
  Scenario total 18.00 and the `Os` filter also restored because the accepted
  submission captured those bindings; this does not establish draft autosave.
- An actual 1,176-byte downloaded static HTML summary retained its title,
  paragraphs and zero-euro fact. This verifies export of the separate result,
  not a dynamic mini-app snapshot or a new document execution bridge.

## Verified assessment findings (before migration)

### Dependencies and upgrade risk

| Package | Current direct pin | Registry candidate | Assessment |
| --- | --- | --- | --- |
| `@openuidev/lang-core` | 0.4.1 | 1.0.1 | Target the 1.0 language/parser API. |
| `@openuidev/react-lang` | 0.4.1 | 1.0.1 | Upgrade with core; qualify hooks, actions and state contracts. |
| `@openuidev/react-ui` | 0.17.1 | 0.18.1 | Latest declares React renderer >=1.0.0 <2.0.0. |
| `@openuidev/react-headless` | 0.17.1 | 0.18.1 | Qualify report/slide providers and any optional AI SDK peers. |
| `@openuidev/thesys` | 0.14.0 | 0.14.0 | Still declares core/react-lang ^0.3 and react-ui/headless ^0.14 peers. **Not certified compatible with 1.0 by its published ranges.** |

Installed React/ReactDOM are 18.3.1 and Zod is 3.25.76, satisfying the candidate
UI peers. Installed Zustand is 5.0.11, while candidate UI/headless and Thesys
declare Zustand ^4.5.5. The app already overrides this boundary. Do not expand
overrides or downgrade the whole application store merely to silence installation
errors: qualify shared store/provider behavior first. React 19 is not required.
Check exact versions, optional peers and lockfile resolution again during migration.

An isolated scratch probe installed **core 1.0.1 only**, outside the repository's
dependency tree. Eight representative programs produced identical root trees
under current and candidate core using the current library schemas: greeting,
primitive table, bar chart, generated image, document image, gallery, report and
presentation. No parser errors, incomplete or unresolved references were reported.
This is **parser evidence only**: React mounting, streaming, action handling,
styles, report/slide providers and all persisted programs remain unqualified.
The scratch probe did not edit package.json, lockfiles or production code.

### Current integration gaps

| Existing owner | Verified behavior | Needed for mini-apps |
| --- | --- | --- |
| `front/scripts/generate-openui-prompt.mjs` | Generates the agent format prompt from current schemas; no explicit bindings/tool-call configuration. | Qualified 1.0 library spec, explicit reactive features, bounded capability instructions and validated examples. |
| `front/.../openui/OpenUiRenderer.tsx` | Uses the app's inference stream; passes accepted `initialState`; deliberately no `toolProvider` or state-update autosave. | State-update callback, version-aware library dispatch and controlled capability bridge. |
| `front/.../openui/library.tsx` | Thesys schemas plus citation, image, table and chart overrides. | Retain legacy component signatures; add reusable layout/input/function/action primitives for new apps. |
| `OpenUiAnswer.tsx` and `actions.ts` | Accepted actions become user turns; unsubmitted changes are local. | Distinct state-only saves and explicit agent actions. |
| `back/.../dto/send-message.dto.ts` | V1 submission accepts `continue_conversation`; bounded JSON, 20 KiB, 200 nodes, depth 8. | New validated app-state/action contracts; do not repurpose this endpoint as per-keystroke autosave. |
| `front/.../openui/plain-text.ts` | Exports saved static programs; rejects state declarations, queries and mutations. | Materialize a saved dynamic snapshot before reusing the shared export projection. |
| `report-program.ts`, `render-mode.ts`, `preload.ts` | Root-line detection and separate Card/Report/Presentation programs. | Explicit version routing and regression tests for envelopes, new roots and streaming boundaries. |

The current database has `conversation.messages.components`, `interaction` and
`interactions` JSONB. It has no generic conversation metadata bag or revisioned
per-viewer UI-state store. Accepted form submissions are not an autosave protocol.

## Recommended ownership and boundaries

Keep `ConversationModule`, the existing frontend conversation module, native
uploads, workspace authorization and YellowStorm ADK. No new inference provider,
chat shell, MCP server, independently deployed service or database namespace is
needed for the initial declarative apps. OpenUI Gateway is optional upstream
infrastructure, not a prerequisite for this migration.

Model output selects from host-owned components, pure functions and named actions.
Pure functions are deterministic, validated and bounded; the model composes them
rather than supplying arbitrary JavaScript to evaluate. Provide general operations
for numbers, strings, lists, dates and structured data, not a dedicated Calculator
or Summarizer component. Add general document selection and result display controls.

Separate three activities:

- **Local UI:** state changes and pure expressions run in the renderer.
- **Agent work:** an explicit action uses the existing authorized conversation/ADK
  execution path; it can summarize documents or invoke the configured MCP tools.
- **UI data operations:** a small host allowlist can later back Query/Mutation.
  Browser code never receives connector credentials or a generic arbitrary-MCP proxy.

### Applicable decisions

ADR-0017 requires selecting the MCP authentication profile and failing closed.
ADR-0018 preserves connector policy/revision and user isolation. ADR-0023 applies
only to static-credential MCP ingress with verified actor attribution; ADR-0024
applies only to platform-trusted first-party MCPs. They are not interchangeable.
No new security profile is proposed. ADR-0015 semantic extraction ownership is
unchanged; semantic-runtime extraction is not moved into browser mini-apps.
Proposed Responses ADRs do not mandate changes to this feature.

The table, state contract and executable sandbox below are **proposals requiring
named design approval before implementation**, under architecture/change-control.md.
The current user request authorizes this assessment/plan, not those boundaries.

## Existing-conversation compatibility and rollout

1. Add a proposed `OpenUiProgramDescriptorV1` beside the existing saved text content:
   language version, stable library identifier/revision, and a host-computed program
   revision. Retain raw program content and stable source message/component IDs.
2. Missing descriptor means the existing legacy dialect. Never reinterpret old
   content as 1.0 solely because the agent's checkbox is currently enabled.
3. First try the 1.0 renderer with a compatibility library preserving existing
   Card/report/slide signatures and our overrides. The parser probe supports
   investigating this path; it does not establish that it works.
4. If mounted fixtures fail, retain the existing renderer in a separately resolved
   legacy bundle while new apps use 1.0. Qualify package aliases/nested resolution
   and shared providers before accepting dual bundles. Do not use an untested peer
   override as the compatibility strategy. If neither path qualifies, pause rollout.
5. Generate and parse prompt examples against the selected library. Version the
   generated prompt/spec with its renderer. No cross-dialect live stream swap.
6. Preserve existing submission schemaVersion 1, root splitting, citations, image
   receipts, downloads, report/slide panels and export behavior. No history rewrite.
7. Use the existing generative-UI setting plus an explicit mini-app rollout flag
   declared under the frontend configuration conventions. New program generation
   can be disabled while compatible readers remain enabled for already saved apps.

A dependency rollback alone cannot promise to read new 1.0 history. Release the
qualified readers before enabling generation; retain those readers while disabling
new generation if rollback is needed. Unknown versions show a readable static
snapshot and a clear unsupported-version state, not raw code or a blank answer.

## Phase 3 private state persistence

The user explicitly approved this named table/API design on 2026-10-17.
[ADR-0025](../decisions/ADR-0025-openui-private-draft-state.md) records the accepted
ownership, isolation and concurrency constraints. Implementation extends the
existing message controller, service and PostgreSQL store; no new service class,
module or runtime was introduced. Qualification is recorded separately below.

**Approved named design:** one new table, `conversation.openui_app_states`, in
the existing conversation schema, owned by existing ConversationModule persistence.
No new service class, schema namespace or deployed runtime. Reuse existing auth,
controller and store conventions; add focused methods rather than a parallel platform.

Identity: authenticated actor + conversation + source assistant message +
component + program revision. Store bounded UI state, schema/library version,
monotonic state revision and updated timestamp; retain server-produced result/file
references where needed. The server derives the actor, ownership and program digest.

- GET/PUT route:
  `/conversations/:id/messages/:messageId/openui/:componentId/state`.
  Writes require expected state revision and the matching program revision.
  Stale writes return a conflict; a retry cannot silently replace a newer edit.
- Start with private viewer state. Opening a shared/group conversation does not
  expose another viewer's drafts. Explicit shared app state is a later decision.
  Preserve the current owner/member write gate: project-share read-only viewers
  may view permitted content but cannot autosave or invoke actions. Show a read-only
  UI rather than repeatedly attempting forbidden saves.
- Inputs autosave after a bounded 500 ms debounce; display saving,
  saved, conflict and retry states. Phase 5 must flush/confirm state before export.
  No assistant turn or tool call is generated by autosave.
- Snapshot ceiling: 20 KiB with depth/node/finite-number and
  dangerous-key validation at both ends. Enforce a per-actor rate limit and bound
  generated program/list sizes. Revise limits only with measured use cases.
- Persist bounded user-entered draft text, including pasted summarizer input.
  Document/artifact selections remain IDs; extracted document bodies, file/image
  bytes, credentials and tool results do not belong in this state store. Large
  results stay in existing message/artifact storage.
- Reset is a revisioned save of defaults. Conflicts offer reload or explicit reapply;
  reapply replaces the whole local component draft against a fresh revision.
  Mini-apps within one text component share its atomic snapshot; separate text
  components have independent identities. Incremental model patches remain phase 7.
- Deletion, lost conversation access and source replacement invalidate the associated
  view. Phase 4 must revalidate document references after document revocation. Branches get independent state identities;
  copied apps must revalidate file access and never copy another viewer's drafts.

**Smaller alternative:** keep only explicit Save submissions in existing message
interaction JSONB and retain current reload semantics. This avoids a new table but
adds conversation turns, cannot provide quiet autosave/CAS, and therefore does not
meet the recommended mini-app experience. Mutating shared assistant component JSON
with private drafts is also rejected: it mixes transcript and viewer-state ownership.

### Phase 3 qualification

The endpoint derives actor and exact UTF-8 program SHA-256 server-side. Writes
lock the parent/source, recheck membership and atomically compare the revision.
Frontend SHA-256 verifies that the response matches the program being rendered.
Draft loading gates controls; 500 ms saves serialize and queue the latest snapshot.
Conflicts pause saving until explicit reload or reapply. Late responses are scoped
to the user and source; no browser storage, agent turn or tool call is used.

Checks: 23 backend tests pass (10 DTO, eight service, four real PostgreSQL
concurrency/isolation/lifecycle tests and one new-migration registration check).
Production backend TypeScript passes. Eleven frontend hook tests and a mounted SDK
unsubmitted-state round trip pass. The application and distinct test database have
only migration `0052_openui_app_states` applied for this phase. Existing historical
journal failures (old entry indices/timestamps and lock headers) are unchanged;
the new entry is checked independently. The broad frontend suite passed 263 tests;
affected suites then passed the numeric-null fix and an additional transformed
binding case, qualifying 264 distinct tests.

Live QA in `0a36aab51f702536578737aa` edited the converter, price scenario, city
filter and summarizer without submitting a turn. Reload retained zero, false,
empty text, numeric blank as null and an 86-character unsubmitted source with
Short/Spanish options. Database inspection confirmed the JSON types. Two tabs
racing different apps in that component produced one saved revision and one
visible conflict. Loading the winner and explicitly reapplying the full local
draft both worked; reload restored the acknowledged result. Assistant-answer
count stayed at two, with no inference or tool execution. Real SQL also proves
that separate app components save concurrently and reload independently.

Live testing exposed an OpenUI 1.0.1 defect: scoped `$value: null` became undefined.
The input host substitutes the null literal in the original binding AST and runs
the public SDK Set action. JSON validation remains strict; there is no JavaScript
execution. Real SDK regressions cover null and transformed bindings with no agent
callback. Independent boundary, host, adapter and documentation reviews pass.
Production frontend/backend TypeScript checks pass. Final production bundling
passes with gzip reporting disabled; the previous attempt stopped during gzip
reporting without a diagnostic. Existing chunk/dependency warnings remain.

## Document summarization without a bespoke summarizer app

The model can generate a document picker, length/style/language controls, an explicit
Run button, progress/error feedback, a summary pane and download actions from the
same generic library used by other apps.

1. Document selection reuses composer/workspace upload and attachment IDs. The host
   receives the file; generated markup never invents storage URLs or bypasses quotas.
2. The backend revalidates conversation membership and document scope on every action.
   Existing attachment resolution rejects foreign/missing IDs and excludes incomplete
   or folder documents. Fail clearly when no usable selection remains.
3. An explicit versioned app action reuses the existing message/request execution
   path with source app/program/state revision, a stable request ID, selected file
   references and bounded typed inputs. No new summarization microservice is needed.
4. The existing root agent uses extraction/search or connector tools and the chosen
   model. Native callbacks add trusted user/workspace scope. Documents are untrusted
   content; instructions inside them are not tool authorizations.
5. Bind completion/error to the originating request and input revision. If the user
   changes document or options mid-run, an old result must not become the new result.
   Store a result-message/artifact reference plus source and options, not the entire
   summary in a small UI-state payload. Offer explicit rerun for stale results.
6. Reload restores inputs and completed results without repeating a paid model/tool
   request. Recheck authorization when opening source files or downloading outputs.

Existing extraction supports text from DOCX/PDF/PPTX and other attachment formats,
with an output ceiling of 200,000 characters. The attachment context budget is
12% of model context, bounded to 2k–12k tokens and at most 6k per file. Consequently,
injected context is not proof that a whole long document was read. Use authorized
search/chunk retrieval for longer files; disclose partial coverage. Scanned PDFs
require an explicitly available OCR/vision path or a clear unsupported-content
message. Plain extraction must not claim to understand charts or embedded images.

## Phase 4 implementation and qualification

The user approved phase 4 on 2026-10-17. The implementation extends the existing
ConversationModule and OpenUI library; no table, service or execution runtime is
introduced. ADR-0025 continues governing private draft identity and authorization.

- `MiniDocument` binds a document ID selected from completed, non-folder uploads
  in this conversation's existing system workspace. It pages the authenticated
  conversation files list and offers refresh after composer upload. It does not broaden
  document scope to arbitrary workspace IDs or accept generated storage URLs.
- `AskAgent` accepts an optional bounded document-ID array. The host flushes the
  private draft before attaching an `appTask` descriptor (version 1, exact source
  program digest, acknowledged revision and up to five distinct document IDs).
  The server rechecks creator/member access, program/revision, attachment policy
  and every selected document before creating the normal conversation turn.
- Existing request IDs and interaction fingerprints make uncertain transport
  retries idempotent. A later explicit run uses a new request ID. Busy/stream
  guards reject double clicks; leaving the actor/source scope fences late work.
- Existing interaction JSON and user/assistant message links own task/result
  references. Result bodies stay in assistant messages. `MiniTaskResult` follows
  the enclosing app's actor/source/program/form identity and restores saved
  output through authenticated message reads, never by dispatching execution.
- Host draft revision/unsaved state marks old results stale independently of
  generated inputs. A text component is one atomic draft, so changing any app
  inside that component can require rerunning its results. Explicit cancellation
  targets the accepted assistant message. Existing execution status now reaches
  message responses; cancelled, failed and interrupted partial output is never
  presented as a successful result.
- The existing extraction/context budgets above remain in force. The canonical
  task instruction requires untrusted-document handling and disclosure of partial
  coverage or unavailable OCR; the selector does not promise whole-file reading.
  Dynamic app snapshots/exports remain phase 5.

Focused verification: 50 frontend tests, 20 compatibility tests and a consolidated
158 backend tests across seven affected suites pass.
Independent source review covers the actor/source/revision gates, retry versus
explicit rerun, host-owned stale checks and trusted attachment workspace contexts.
Production frontend/backend TypeScript checks pass. Production bundling passes
with gzip reporting disabled (1m 54s); the prompt is 54,867 characters, under its
55,000-character soft budget.

Live qualification on 2026-10-17 uses conversation
`f417e12e499dba83ffe99d10`. A newly generated document-reader app lists four native
uploads. Short PDF and DOCX summaries correctly read the synthetic project facts;
changing document/length hides the previous result as stale. Reload restores
selection and saved output with unchanged task/message identities and usage.
Cancellation remains cancelled after reload; only a later explicit run starts work.
The 55-page PDF run disclosed the verified section and truncated preview instead
of claiming complete coverage. The image-only PDF yielded the correct Maple/
Saturday/Rami facts and explicitly limited its claim to extracted page-one text.
Access tests reject nonmembers, revoked/governed access, cross-workspace documents,
invalid source/revision, disabled attachments and incomplete files before execution.
Two-account live browser access testing was not repeated in this phase.

The initial database backup lock cleared without terminating its session. Normal
backend startup and live Swagger generation now pass. Live testing also found that
the legacy linked-workspace picker omits native uploads; the existing file
controller now exposes a participant-scoped paginated upload list without creating
workspaces. The native agent request now includes actual server-resolved current
attachment workspaces instead of falling back to the conversation ID. Previous
attachments and model/client workspace hints cannot widen this context; ADR-0017
and ADR-0018 actor/MCP isolation remain unchanged. The canonical task manifest
provides verified IDs, untrusted filename labels and bounded-extraction guidance.

Normal Nest watch compilation exposed a Swagger compiler gap in the inline task
version literal: it emitted nested schemaVersion metadata without a numeric type,
reported as a circular dependency at startup. Explicit appTask OpenAPI metadata
fixes generation without changing transport validation. The real compiled schema
factory passes; removing the explicit metadata reproduces the exact error. A
focused schema-generation regression and production TypeScript check pass.

## Exports from dynamic apps

Extend `buildStructuredExportBlocks` with a saved-snapshot materialization step:
freeze program/library/state revision and completed result references, then evaluate
pure expressions with a bounded, qualified 1.0 evaluator. Validate/materialize the
render tree before using the current chart/image/table/document exporters.

- Export the latest acknowledged saved revision. Pending writes or conflicts require
  resolution first; do not export an unrelated local DOM view.
- Queries do not refresh and mutations never run during export. Include only
  authorized cached results bound to the snapshot, with freshness/source labels.
  Missing or stale-required results produce a clear failure or an explicit partial
  export chosen by the user, never a plausible fabricated complete document.
- DOCX/HTML/PDF include the evaluated content, selected data and rendered charts.
  DOCX tables/text remain editable; the chart visual is a PNG alongside its data.
  HTML is a self-contained static snapshot, not an executable app download.
- Editable PPTX goes through the existing `code-interpreort-aga` connector with
  native text/table/chart data where supported, plus scoped image references.
  An unsupported visual may use an image with an explicit limitation; do not claim
  the whole deck is editable when it is a screenshot.
- Export metadata identifies the program/state revision and capture time. Continue
  existing legacy export paths unchanged. Do not just remove the current dynamic-
  program rejection: exports need a real materialization and authorization step.

## General generated HTML/JavaScript apps: separate extension

Some requests need behavior beyond registered primitives (canvas tools, games or
custom interactions). Plan a later `OpenUiHtmlSandbox` component inside the existing
frontend conversation module, only after its execution design is approved. This
is a general HTML capability, not a collection of task-specific apps.

Proposed controls: iframe `sandbox="allow-scripts"` without `allow-same-origin`,
no ambient auth/cookies/storage, restrictive CSP, no direct network/navigation/
popups/downloads, and a bounded typed host bridge. Bind a MessageChannel to the
exact iframe instance; validate message source, per-instance capability and size.
Every backend call still authorizes the signed-in actor. Use native host uploads
and downloads; never pass connector secrets into generated JavaScript.

Timeout/cancel/reset, maximum source/output sizes and mutation approvals are
required. An iframe provides browser security separation but is **not a hard CPU
or memory isolation guarantee**. Strong hostile-code resource isolation would
require a separately justified origin/execution service and another named design.
Preview reload/export must not run network writes or repeat inference. Define a
snapshot contract before claiming HTML apps support the same exports as declarative
apps. The isolated iframe is not a route around backend authorization.

## Delivery phases and separate commits

| Phase | Scope / intended commit boundary | Acceptance gate |
| --- | --- | --- |
| 1 | Dependency + renderer compatibility migration; regenerate schemas/prompt; preserve legacy readers. | Mounted legacy corpus, streaming, actions, providers, type/build, prompt freshness and browser QA pass. No new app generation until gate passes. |
| 2 | General declarative library, bounded functions/actions, generation examples; bindings explicitly enabled. | Several unrelated app requests work from composition alone; no new frontend app implementation per request. Test zero/blank/invalid inputs, reset, keyboard/mobile and bounded lists. |
| 3 | Approved per-viewer state table/API, versioned program descriptor and autosave/CAS. | Reload, two tabs, two users, shared views, branching, request retries and revision conflicts pass; no per-keystroke inference. |
| 4 | Generic document selection + explicit agent-task/result bridge over existing execution. | DOCX, text PDF, long document, scanned PDF, foreign/deleted file, double click, cancellation and late-result tests; results survive reload without rerun. |
| 5 | Snapshot materialization and DOCX/HTML/PDF + MCP editable PPTX. | Export after reload matches saved state/results/charts; no query/mutation/inference side effects; image access revalidated; inspect actual downloads. |
| 6 | Approved generated HTML sandbox and capability bridge, if required. | Cross-user/iframe spoofing, network denial, malicious markup, storage denial, cancellation and snapshot/export tests; document residual resource limits. |
| 7 | Incremental app edits using base revisions, library versioning, error repair and bounded telemetry. | “Add a control/change the layout” preserves compatible inputs; conflicting edits and failed patches cannot corrupt the last working app. |

Smallest complete release: phases 1–5, with document summarization and multiple
unrelated declarative apps as acceptance cases. Phase 6 broadens custom executable
behavior; phase 7 improves repeated refinement. Each phase has its own commit and
focused tests. Agent execution/auth/persistence phases require both sides of the
boundary, independent review and visible-flow QA; routine documentation review can
run alongside testing. No time estimate is claimed before the peer-compatibility gate.

## Compatibility and acceptance corpus

| Area | Required evidence |
| --- | --- |
| Existing conversations | Stored Card/Report/Presentation programs, legacy root variants, malformed/partial streams, citations, edited/generated/web/document images, image history, galleries and saved v1 forms. |
| Existing interactions | Numeric/boolean/empty values, applied table sort/filter/selected rows, chart series/category zero indices; reload and old export results remain unchanged. |
| General apps | Fresh requests for document summarization, unit conversion, an adjustable scenario model, a list/planner and a filtered data view; backend work only when explicitly requested. These are tests, not built-in app templates. |
| State isolation | Actor A/B private drafts never cross; same actor two tabs produce a conflict instead of silent loss; changing conversation/program cannot hydrate stale state. |
| Documents | Native upload, workspace picker, multiple documents, partial extraction, long-document coverage, invalid extension, limits, scanned PDF, revoked access, prompt injection and source citations. |
| Execution | Stable request ID, pending/completed/failed/cancelled states, retry without duplicate work, input changed mid-run and late results; preserve shared concurrency/admission behavior. |
| Exports | Flush pending save; reload; identical revisions across formats; chart PNG plus selected editable data; no writes/tool reruns; scoped images; verify downloaded DOCX/PDF and native editable PPTX content. |
| Upgrade/rollback | Candidate dependency graph has one intended runtime per dialect; no hidden provider duplication; legacy persisted fixtures work with generation disabled; unknown versions recover readably. |

Metrics: format/library version, parse/render error code, generation/repair duration,
state-save latency/conflicts and scoped task status. Keep document text, prompts,
state contents, credentials and generated source out of routine logs. Error repair
is bounded and must not send private content to a new provider implicitly.

## Evidence, references and approval boundary

Local source entry points (relative to repository root):

- `YellowStorm/front/package.json`, `scripts/generate-openui-prompt.mjs`, and
  `src/modules/conversation/components/openui/{OpenUiRenderer,OpenUiAnswer,library,actions,plain-text,report-program}.*`.
- `YellowStorm/front/src/modules/conversation/utils/{document-export,docx-capture,docx-export,html-export}.*`.
- `YellowStorm/back/src/modules/postgres/schema/conversation.schema.ts`,
  `modules/conversation/{dto/send-message.dto,controllers/message.controller,controllers/conversation-file.controller}.ts`,
  attachment resolver/context/preparation under that module's `services/`.
- `yellowstorm-adk/src/modules/attachment_profile/extractors.py`,
  `src/smart_rag/tools/utilities/connector_tools.py` and trusted scope callbacks.

Official sources consulted:

- [1.0 changes](https://www.openui.com/docs/openui-lang/whats-new)
- [Renderer](https://www.openui.com/docs/openui-lang/renderer),
  [reactive state](https://www.openui.com/docs/openui-lang/reactive-state),
  [functions](https://www.openui.com/docs/openui-lang/functions),
  [actions](https://www.openui.com/docs/openui-lang/actions)
- [Message protocol / state hydration](https://www.openui.com/docs/openui-lang/message-protocol)
- [Queries and mutations](https://www.openui.com/docs/openui-lang/queries-mutations)
- [Incremental editing](https://www.openui.com/docs/openui-lang/incremental-editing)
- [Demo source and component/function library](https://github.com/thesysdev/open-intelligent-ui)
- npm registry metadata for the five `@openuidev/*` packages listed above.

Upstream examples demonstrate APIs; they do not establish YellowStorm permissions,
state ownership or compatibility. The initial assessment used official sources,
Context7, repository inspection and the eight-case isolated parser probe. That
assessment changed no product packages, schema, endpoints, mini-app runtime or live
conversation; the subsequent authorized phase 1 package migration is recorded above.

The user approved the named phase 3 table/API design, recorded in ADR-0025. Before phase 6,
approve/revise `OpenUiHtmlSandbox` and its capability/snapshot constraints separately.
Phase 1 passed the mounted-library compatibility gate. Phase 2's implemented
declarative library and passed live browser qualification are recorded above;
the final production build and independent review also passed.
Phase 3 qualification is recorded above. Phases 4–7 retain their separate approval boundaries.
