# Clarification choices and execution activity

2026-10-10, following commit 77932dde0.

## Changes

- Short schema strings render compact inputs; explicit long text (`maxLength > 500`) retains multiline input. Small closed enums use required radio choices; examples remain editable shortcuts with explicit submission.
- ROOT compiler and installed orchestration skill 1.4.0 require per-field examples when meaningful, a helpful clarification introduction, and concrete confirmed dispatch acknowledgements. No choices are inferred from prose.
- Stream completion/error refreshes active-conversation input/work state immediately. Scope reset is separate from revision refresh so drafts, accepted-message bindings and failure state survive. Background input submissions also refresh. Five-second polling remains recovery/status reconciliation.
- Background work appears within the originating assistant bubble, outside collapsed process details, with real batch counts. Queued/waiting/active/terminal states have distinct icons; active spinners honor reduced motion. Activity headers reflect active or uncertain job state independently of completed dispatch tools.

## Qualification

- Frontend initial six suites: 165 passed. Final changed store/status suites: 72 passed; fields: 5 passed; final header/content/status suites: 79 passed. Counts overlap and must not be added.
- Native ROOT compiler: 9 passed. Final frontend typecheck/production build passed; existing bundle warnings remain. Observability policy passed without new violations; detector found no findings; whitespace checks passed.
- Read-only planning/review and source/desktop UI QA passed. Graph navigation tools unavailable, so focused source scans used.
- Existing Smart Agent and same signed-in Chrome tab used throughout. Installed skill retained its ID, active state and attachment; body verified equal to repository source. Native service restarted only with no running foreground/background work.
- Fresh natural stock request (7bc691e48df03effa1dff8d3) produced a helpful introduction and three rendered ticker suggestions. Selecting one filled an editable short field without auto-submission; bound continuation succeeded and dispatched work.
- Natural three-project comparison (97eb2a888a287154b9fca353) automatically used fan-out without orchestration hints. Originating bubble displayed an active spinner, 0/3 then 1/3 counts, and running/queued counts. It reached 3/3 and published the requested comparison with a contextual next step. An unrelated question was answered independently while work ran.
- Final header delta qualified after a full page refresh during an explicit Redis/Valkey batch: header and execution row both showed Running, with two active workers. Desktop and 390px screenshots inspected; temporary viewport reset. Development hot reload had retained an earlier render, so qualification used a refreshed client.

## Limits

- Choice/intro/next-step production remains model behavior. A quick arithmetic reply still omitted an optional next step; universally consistent wording is not qualified. Exact one-sentence requests retain their requested format.
- Inputs created under older agent definitions are not rewritten; definition fingerprint checks remain intact.
- Job changes after dispatch still use bounded polling reconciliation; this change does not add a new server-push job protocol. Terminal foreground events immediately invalidate state.
- Answer-only bubbles without activity nodes retain their simple header; their visible execution row still reports job state.
- Unrelated staged semantic-model work and the user-owned coding-agent configuration were excluded.
