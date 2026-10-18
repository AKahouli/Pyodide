# OpenUI rich dashboard and HTML artifact reuse plan

Status: **phase A qualified; phase B implemented, editable PPTX live qualification blocked; phase C implemented with configurable execution; phases D–E proposed**.
Assessed 2026-10-18. Complements the [mini-app plan](openui-mini-apps-plan.md)
and [library reuse map](openui-mini-app-library-map.md); completed phases remain
unchanged. Each implementation phase below has a separate commit and test gate.

## Current delivery: exports, refinement and conversation navigation

### Saved HtmlView export qualification (18 October 2026)

Implemented the bounded live capture channel using the existing private identity.
The saved preview must be mounted and ready. Export freezes its acknowledged
revision, captures the current DOM without rerunning generated scripts, sanitizes
it, and rasterizes a passive iframe with scripts and network resources disabled.
Editable text/tables accompany labelled visual snapshots. Local HTML is passive.
The renderer's exact MiniApp/name scoped HtmlView fields override variable defaults;
equivalent identity objects do not cancel capture, while real scope/state changes do.

Live conversation `c66d50ba8780ea080b2c52d5` restored North, numeric 25, boolean true,
Late and the unsubmitted operations note after reload. HTML and DOCX downloaded;
both contain two dashboard visuals and the two filtered native tables. The user-saved
three-page PDF was inspected page by page and includes both visuals, captions and
the same saved note/table rows. The second user's saved map also exported to HTML
and DOCX. Captured visuals may use fallback fonts in the image renderer.

MCP manifests upload exact captured bytes through the existing authorized workspace
flow and resolve the returned document ID, never a same-name substitute. This avoids
the message-size limit hit by inline base64. The real PPTX run prepared the saved
131,990-byte image and received upload acknowledgement, but remote SHA verification
returned a Python traceback and the mount guard stopped execution. Available logs
truncate the traceback, so the precise remote cause is unproven. No PPTX success
is claimed; the verification guard remains enforced.
Focused capture/state, upload and integration tests passed; independent review
accepted the capture boundary and scoped state projection.

User selected priorities 1, 2 and 5 on 2026-10-18. Deliver separate commits:

1. Saved HtmlView static exports: reuse the existing instance-bound channel and
   acknowledged private state. No generated-script replay on export. Require an
   active matching view; stop/timeout/changed state fails visibly. Editable text
   and tables accompany a labelled visual snapshot in HTML/PDF/DOCX/MCP PPTX.
2. Artifact refinement: explicit Refine fills the current composer and selects the
   exact authorized reference without sending. Preserve original instructions and
   outputs. Reuse immutable answer versions/source links and existing branch APIs;
   old sources keep their own private state and saved results.
3. Long conversations: bounded authorized plain-text search and around-message
   loading inside existing conversation owners, target branch selection and reload
   navigation. Preserve live answers, pagination state and draft owners; do not
   introduce virtualization or change stream ownership without concrete evidence.

Observable gates: saved exports match restored controls and visuals; refinement
never overwrites the source; chosen historical answers survive reload without
inference; historical search/jump succeeds outside the initial page; foreign or
deleted sources remain unavailable and background runs continue. Browser checks
reuse one existing localhost app tab per account profile, as requested. ADR-0025
private state identity and ADR-0017/0018 authorization remain authoritative;
ADR-0028's approved sandbox implementation constraints are retained. No new
table, module, service class or runtime is introduced by this scope.

## Outcome and acceptance criteria

1. Simple requests generate several different dashboards through reusable OpenUI
   components/functions, including custom SVG and HTML visuals; no dashboard-specific
   React screens or replacement chat renderer.
2. Typed, unsubmitted controls survive reload with the existing private actor/source/
   program identity and revision conflicts. Local interactions and reload cause no
   inference; saved document results restore without rerunning tasks.
3. Documents, images and MCP exports retain current authorization. Generated HTML
   receives no application credentials, direct storage paths or ambient tool access.
4. Actual downloaded HTML/PDF/DOCX and MCP editable PPTX match one acknowledged saved
   view. Interactive HTML download is a separately labelled format, not the static
   HTML snapshot. Unsupported visuals are identified as images, not editable charts.
5. Existing conversations, images, forms, table/chart views, reports, slides and
   exports continue to work. Independent review and browser QA qualify each phase.

## Verified reuse and ownership

Upstream: [thesysdev/open-intelligent-ui](https://github.com/thesysdev/open-intelligent-ui),
MIT, pinned assessment revision `03213439358bf3408ad61a46ec9e3230c5572e48`.
Retain attribution in the existing OpenUI NOTICE when adapting source. Reconcile
upstream changes deliberately during implementation; do not vendor the entire app.

| Upstream capability | Existing YellowStorm owner | Reuse / adaptation |
| --- | --- | --- |
| `src/lib/components/html-view.tsx`: HtmlView definition, HTML wrapping, iframe lifecycle, theme hint and height reporting | Existing conversation OpenUI library/renderer | Adapt this component directly as `HtmlView`. Keep its public html/height/title calls compatible; add optional trailing host-state props only when qualified. Preserve deferred execution until streaming finishes. |
| `src/lib/components/svg.tsx`: Svg, G, Circle, Ellipse, Rect, Line, Path, Polyline, Polygon, SvgText | `components/openui/library.tsx`, MiniApp layout and theme | Adapt bounded attributes and responsive rendering, theme tokens and accessible labels. No arbitrary markup/event attributes or resource-loading SVG elements. |
| `src/lib/functions/data.ts` and required shared/date helpers | `mini-app-functions.ts` and shared prompt definitions | Adapt GroupBy, Pivot, Top, Between, Bucket, Cumulative, MovingAvg, Change, Histogram, Stats. Reuse existing functions on name collision; qualify semantics and limits before exposing them. |
| Demo layout, chart/table and generation examples | MiniRow/Column/Grid/Panel/Text, DataTable, ChartExplorer and prompt generator | Keep our existing interaction owners and adapt upstream examples to their contracts. Do not import a second Table/Chart or duplicate form owner. |
| Demo iframe permits selected CDNs and HTTPS images | Existing scoped asset resolution and application authentication | Narrow this policy: pin approved visualization dependencies as local/bundled assets or inline qualified code, disable general network and resolve authorized media through the host. Do not copy the demo network policy unchanged. |

Source evidence: `library.tsx`, `mini-app-functions.ts`, `mini-app-state.ts`,
`use-mini-app-state.ts`, `OpenUiAnswer.tsx`, `MiniApp.tsx`, `plain-text.ts`,
`utils/document-export.ts`, `utils/openui-export-assets.ts`, and existing backend
state/task/file contracts. The current exporter derives accepted table/chart state;
it now materializes authenticated private reactive snapshots for explicit exports. An iframe's internal state
is also not automatically visible to OpenUI autosave.

## Governing decisions and proposed boundary

- **ADR-0025 (accepted):** authenticated private actor/conversation/source/component/
  digest scope, bounded typed JSON, 500 ms serialized autosave, atomic expected
  revisions and explicit conflict recovery. Never save document bodies, image bytes
  or tool results in the draft table; use existing authorized result references.
- **ADR-0017/0018 (accepted):** retain current connector and document authorization,
  attribution and isolation. No credential or workspace-ID delegation to HTML.
- Proposed **OpenUiHtmlSandbox design**: implement HtmlView plus a bounded host bridge
  inside the existing frontend conversation module. Reuse the existing ConversationModule,
  state table/API, file/artifact access, task/result bridge and connector. No new table,
  module, service class, server process or independently deployed runtime is proposed.
- The earlier mini-app plan explicitly reserves generated-code sandbox approval.
  Before implementing phase C, record approval of this named design and its execution/
  snapshot controls. Planning and phases A/B do not authorize executing generated JS.
  A separate execution origin/service, new persistence or enlarged bridge requires
  a new concrete design under change control; it is outside this proposal.

## Proposed HTML integration contract

Phase C implementation updates this proposal through [ADR-0028](../decisions/ADR-0028-openui-html-artifact-policy.md):
the user approved OpenUiHtmlSandbox and then requested two administrator-selectable
modes after the self-navigation limitation was explained. Strict mode defaults to
HTML/CSS/SVG with trusted declared controls; generated scripts are removed.
Interactive mode permits inline scripts and warns about self-navigation/data
transmission and browser resource limits. The upstream srcdoc surface loads a trusted external bootstrap under the parent's
unchanged inline-free CSP. Strict mode denies eval; interactive mode evaluates
inert generated scripts after initial state arrives. Normal-URL shell navigation
was replaced after saved conversation startup remained at about:blank.
Private autosave reuses ADR-0025; documents/tasks/results stay host-owned outside
the frame. HtmlView visual exports fail explicitly until phase D. No arbitrary
requestTask or capture message is implemented in this phase.

Use upstream `sandbox="allow-scripts"` with an opaque origin, without same-origin,
forms, popups, parent navigation or direct downloads. Inject policy before generated
markup; deny general network, nested frames and resource-loading URLs. Cap source,
DOM/SVG complexity, message size/rate and output dimensions. Provide stop/reset and
readable errors; an iframe is not hard CPU/memory isolation or a guarantee against
main-thread hangs. Do not advertise hostile-code execution as resource-contained.

Host initializes the completed iframe through an instance-bound MessageChannel.
Validate event source and fresh per-instance capability during channel setup;
reject stale frames and other apps. All bridge messages are schema-checked, bounded
and tied to current actor/source/digest. Keep the initial surface small:

- `ready` / `init`: theme and the acknowledged, JSON-safe app state.
- `stateChanged`: declared named fields only, using the existing autosave queue and
  validator. Ignore hydration echoes; revision conflicts use existing load/reapply.
  Do not persist HTML source or result bodies in private state. Program source stays
  in the saved assistant component; source changes establish a new digest.
- `requestTask`: explicit user action invokes the existing MiniDocument/AskAgent
  pathway after state flush and server authorization; no arbitrary RPC/fetch.
  In phase C, document selection stays host-owned outside the frame. Results enter
  through validated host-owned result references and bounded render data.
- `capture`: explicit export freezes the acknowledged revision and requests a bounded
  visual plus structured text/table/chart data. Treat all frame output as untrusted;
  sanitize text/markup and validate shape, sizes, media and claimed provenance.
  Captured HTML is never injected into the parent application DOM.

Expose the bridge instructions to generation alongside the actual registered
HtmlView contract. An HTML app that does not participate in the state protocol may
render a visual but must not be presented as autosaving. Keep legacy stateless
HtmlView calls readable; generate persistent variants for interactive requests.

## Separate implementation commits

| Phase / proposed commit | Bounded scope | Required gate before commit |
| --- | --- | --- |
| A — `feat(openui): reuse SVG and dashboard primitives` | Adapt SVG primitives and the ten data functions with bounded inputs, existing themes, prompt definitions/examples and export projection for SVG. Extend existing components/helpers only. | Function correctness and invalid/empty/zero data, unsafe keys/URL paints/paths/transforms, reactive SVG state, prompt/schema alignment and legacy compatibility. Fresh sales and operations dashboards work at desktop/390 px in light/dark. Typed controls reload without inference; static exports remain valid. |
| B — `feat(openui): export saved reactive dashboard views` | Implement the already planned phase-5 saved snapshot materialization in existing export utilities. Freeze library/program/draft revision and authorized completed results; support SVG/chart visuals plus native text/tables/data. | Pending writes/conflicts block export until resolved; no queries, tasks or mutations run. Inspect actual HTML/PDF/DOCX and existing-connector editable PPTX after reload. Private drafts cannot leak through whole-conversation export; other users' state is never used. |
| C — `feat(openui): integrate upstream HtmlView with private state` | After named design approval, adapt upstream iframe/theme/height/streaming behavior and the minimal host channel. Add generation examples, source/preview, expand and existing host download actions. Integrate autosave and explicit task/result access. | Spoofed/stale channel messages, cross-app/user state, malformed/oversized data, storage/resource denial, strict navigation denial and the documented interactive self-navigation limit, streaming no-execution, reset/error handling and two-tab conflicts. Different HTML dashboards preserve declared typed controls and saved results after reload; no task auto-runs. |
| D — `feat(openui): export saved HtmlView artifacts` | Extend B's snapshot to acknowledged HtmlView state and validated capture output. Add self-contained static HTML and optional clearly labelled interactive HTML download; reuse existing PDF/DOCX/MCP PPTX flows. | Actual downloads match saved controls/data/SVG/canvas after reload. Static output contains no executable generated scripts; interactive download has embedded acknowledged state, dependencies/assets and no app credentials/private endpoints. Canvas uses a labelled raster fallback; unsupported structured export is visible, never silently omitted. |
| E — `test(openui): qualify rich artifacts across users and reload` | End-to-end qualification, docs and only confirmed integration fixes; keep unrelated changes separate. | Test corpus below, two live users, concurrent tabs, revoked/deleted document access, saved results and actual exports. Independent security/correctness review, focused tests, type/build and visible QA pass. Record blocked remote MCP/print checks accurately. |

A and B deliver reusable dashboard value before generated JavaScript is enabled.
C depends on A/B and named design approval; D depends on B/C; E integrates all.
Each phase updates owning docs and records exact test evidence in its own commit.
Do not bulk import all 59 functions or add new charting packages without a proven gap.
The existing Zod compatibility caveat around library.extend remains: use the current
qualified createLibrary path and check any adapted v4 schemas against installed deps.

## Dashboard test corpus (generated from ordinary requests)

| Fixture | Visuals and interactions | Persistence / export evidence |
| --- | --- | --- |
| Sales performance | KPI cards, region/category filters, monthly charts, ranked table; GroupBy/Pivot/Top/Change | Numeric zero, null/open range and typed selections; saved filters, sorting and drill-down match all exported data and visuals. |
| Operations / service health | Histogram, time buckets, cumulative and moving-average views, reactive SVG status/flow | Empty data, missing dates, long labels, invalid ranges, reset and no-results states; same selected interval after reload. |
| Document insights | Host document selection and explicit summary, grounded facts/citations and a dashboard over available extracted data | DOCX/text PDF/scanned PDF; truthful coverage, no invented numerical metrics. Saved result and controls reload without another task; changed inputs stay stale. Foreign/revoked/deleted files fail before reads/exports. |
| Bespoke HTML visual explorer | Custom canvas/SVG interaction and declared controls using the upstream HtmlView contract | Numbers/false/empty/null and unsubmitted values survive reload; different HTML programs use the same component. HTML/PDF visuals agree; unsupported Office objects are labelled image fallbacks. |

For every fixture: create from a simple request; interact locally; wait for saved;
record message/task IDs and usage; reload; verify exact values/results and unchanged
IDs/usage; export the acknowledged view and inspect actual files. Repeat conflicting
edits in two tabs and private access with two users. Test accessible names, keyboard,
loading/empty/error states, light/dark and 390 px without unintended page overflow.

Automated boundaries: pure function/evaluator tests; mounted SVG/HtmlView/channel/
autosave tests; API authorization and real PostgreSQL CAS tests where affected;
export sanitizer/resource resolution/package tests; old saved conversation corpus.
Live downloads supplement tests; a menu click is not a passed export. Verify PDF
pages and DOCX media/tables, plus PPTX object types rather than assuming editability.
Use existing MCP connector **code-interpreort-aga** for editable PPTX; do not launch
another interpreter. Infrastructure failures are BLOCKED, never reported as PASS.

## Compatibility, operations and exclusions

No history rewrite or silent state migration. Stable field names preserve values
within the same saved program. Any program-source change, including layout edits,
creates a new identity unless an explicit migration is later approved. Disabling new HtmlView generation preserves qualified legacy readers.
Gate new executable generation under the existing agent generative-UI configuration
plus a scoped rollout control; retain ordinary OpenUI fallback and readable errors.
No prompt, HTML source, document body or credentials in telemetry; use existing
logging contracts for any necessary bounded status/count events.

Live data queries, arbitrary tool execution, server hosting/public publishing,
collaboratively shared drafts, a new execution service and automatic state migration
between generated revisions are excluded. Downloaded standalone HTML is a file;
it is not a deployed service and cannot inherit authenticated document/agent access.

## Planning verification

Source/reuse investigation and ADR selection completed; no product code, dependencies,
database, runtime or configuration changed. The rows above are future acceptance
gates, not passed tests. Independent scoped plan review is recorded in the checkpoint.


## Phase A implementation and qualification (2026-10-18)

User authorized phase A with different-dashboard tests, autosave/reload compatibility
and a separate commit. Reused the pinned upstream SVG shapes and dashboard algorithms
inside the existing library; no package, service, table, module or runtime was added.
The core 1.0 createLibrary path remains in use. HtmlView/executable HTML is not enabled.
ADR-0025 and ADR-0017/0018 retain their existing boundaries.

Implementations: svg-definitions.ts/svg.tsx and dashboard-functions.ts; parent library,
prompt generator, dashboard-examples.ts and strict static SVG export integration.
Runtime parsing supplements SDK schemas. SVG only traverses registered shape nodes,
with finite attributes, safe paints/paths/transforms and global 200-node/depth-20
limits. Optional null placeholders work. Function inputs/outputs are bounded JSON;
UTC date buckets are deterministic. Cumulative/MovingAvg explicitly reject dotted
write paths, while the read-only functions preserve safe nested access.

During integration, fractional/negative Stats values exposed overly restrictive
return schemas; those and Histogram bounds were corrected with realistic regressions.
Review found dotted read/write inconsistency in rolling functions; top-level-only
write contracts now fail explicitly and are tested. Static export mocks were updated
for the new capture function. These corrections are part of phase A, not deferred.

Live generation: conversation `ae30ed8cb3e7a9afa00b872f`, source response
`d201a41cdbca3f2701e0497e`. A single ordinary request produced separate sales and
operations MiniApps, grouped totals, reactive revenue bars, moving averages and a
service-flow SVG. Minimum revenue 100 produces North 120; smoothing window 3 produces
latest 6.7/5.0/4.7. Both controls and SVGs restore after full reload with the same two
message IDs and 26.9K usage; no action/inference during edits or restoration.
Existing calculator `938a30d03aa97bb1c249b353` still restores result 5 and 21.9K usage.

An ephemeral development fixture rendered both shared dashboard examples at 390 and
1024 px in light/dark. Measured content scroll width equals width at both sizes;
SVGs fit their containers and labels/keyboard controls remain usable. This qualifies
component layout, not every possible generated dashboard or the entire mobile app shell.
The fixture also exercised the real static projection/capture/HTML download pipeline:
`OpenUI-Static-SVG-QA.html`, 6259 bytes, embeds a 400x200 PNG containing the visible
zero-valued SVG text and caption; no raw program or remote image resolver. PNG
visually inspected. Temporary fixture sources are removed before commit.

At the phase A commit, private dynamic exports remained rejected explicitly; phase B below extends that path. This is
not an interactive HTML artifact or a new editable PPTX qualification. Existing
chart/table/image/report/slide pipelines are covered by compatibility tests.
The prompt is generated from mounted schemas and parsed examples, 59390 characters,
within the unchanged 60000 hard cap but above the 55000 soft target. The dashboard
sales example replaces the redundant scenario example in the prompt; all legacy
fixtures remain tests. No prompt cap was raised.

Qualification: 189 distinct frontend tests across 19 suites, TypeScript and the
production build passed. Independent source review accepted the corrected implementation.
Final documentation review and commit evidence are recorded in the checkpoint;
acceptance gates above remain future requirements for phases B–E.

## Phase B implementation and qualification (2026-10-18)

User authorized exporting saved reactive dashboard views, HTML/PDF/DOCX/editable
PPTX checks after reload and a separate commit. The existing export utilities and
private state hook own this change; no new persistence, service or runtime.
ADR-0025 and ADR-0017/0018 remain unchanged.

On explicit export, mounted identity-scoped callbacks flush pending autosave and
reject loading, errors, conflicts and read-only drafts. Authenticated GET then
freezes the program digest, library version, revision and typed state. A second
guard verifies the returned snapshot against the acknowledged draft before capture.
Callbacks are removed on unmount and never cache private state. Delivery checks
the current actor again. Unmounted sources use the same authenticated state API;
revision zero uses the same actor/digest-scoped accepted fallback as the renderer.
No public share or stored assistant program is modified.

The installed OpenUI pure evaluator materializes registered components/functions
with bounded typed state; queries and mutations are rejected before evaluation.
No Renderer/query manager, agent action or task is started during snapshot capture.
Saved private table/chart selections override legacy accepted views. Native text,
tables and chart data remain structured; SVG/chart visuals are PNG captures, not
editable vector objects. Input labels/selections are included, local action buttons
are omitted. This is a static saved-view export, not executable HTML.

Document labels come from the existing authenticated conversation-file API. Saved
task results require matching actor, source/component/digest, form, revision and
typed inputs, plus an authenticated completed answer belonging to the task. Stale,
failed, revoked or unavailable results fail explicitly without rerunning inference.
Nested interactive result exports remain unsupported and fail explicitly.

Local HTML/PDF/DOCX downloads do not write private draft content into the transcript.
Choosing the existing **Create DOCX/PPTX with agent** action explicitly submits the
projected visible view as a new conversation turn to the configured MCP workflow;
it therefore shares that exported content with the conversation's participants.
Raw private state is not attached. Captured PNG/JPEG data URIs are decoded directly
in the sandbox; persistent image selectors retain their existing authorized reuse
path. An unavailable connector never triggers substitution or image regeneration.

Live sales/operations conversation `ae30ed8cb3e7a9afa00b872f` restored threshold
100 and smoothing window 3 after reload. Downloaded HTML embeds both PNGs; DOCX
contains native text plus captured visuals and was rendered with LibreOffice;
the user-saved PDF contains two pages with both diagrams and matching values
North 120 and latest 6.7/5.0/4.7. Every rendered page was inspected. Automated
coverage additionally checks table sort/filter/selected rows, chart series/point
selection including zero, typed false/null, revision-zero actor fallback,
conflicts/pending writes, access rejection and completed saved document results.

Editable PPTX live qualification is **BLOCKED**: the existing configured MCP
interpreter reported startup/status HTTP transport errors. The projected manifest
is covered by tests, but this is not evidence of a successfully downloaded editable
PowerPoint. Test/build/review counts, retry outcome and the separate commit are
recorded in the delivery checkpoint. No four-format end-to-end pass is claimed.
