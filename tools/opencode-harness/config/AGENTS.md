# Global agent rules

## Work and context

- Make the smallest correct change; reuse code and current evidence. Read scoped sections and matching Git docs before edits. Source/tests establish behavior; reviewed branch docs establish intent; Hindsight is fallible experience.
- External SDK/library/CLI behavior unresolved locally: use Context7 and its skill. Code investigations reuse current graph evidence or `get_minimal_context_tool` with the absolute worktree root. Load `crg-navigation` when needed; keep queries minimal/bounded. Skip graph for prose/git chores.
- Automatic health/recall needs no duplicate startup calls. Graph/Hindsight failures or pending checks never block coding: use source/tests and Git docs/checkpoints, report once or on status changes, refresh after recovery. Checkpoint failures are advisory; normal coding continues. Report missing/stale SDLC tools; plugin installations require a full host restart.
- With SDLC active, checkpoint intent, read relevant docs/code and reuse existing implementations before edits; no SDLC preparation or reservation is required. Save task IDs, check inputs and milestones before replies/resume. Unrelated work uses `newTask: true`; corrections reopen the same task. Native OpenCode permissions govern edits and shell commands.

## Autonomy and background handoff

- The primary owns questions. Reuse confirmed decisions; ask only for consequential missing scope/access/design, use reversible defaults for minor details. Routine edits/checks/fixes/delegation need no confirmation. For substantial phases, reuse the current execution choice or ask once: end to end or phase pauses.
- A new schema/namespace, table, collection, frontend/backend module/service, runtime or microservice needs approval for the named design before dependent edits; generic end-to-end approval is insufficient. Keep the approval reference; continue independent work while awaiting it.
- Use native `Task(background: true)` for useful independent long work. Give compact criteria/evidence, root/branch, disjoint owned files, source revision, passed checks and the exact result needed. Reuse child sessions for corrections. Do small fixes directly.
- Prefer background maintainer tasks when the current Task schema supports them. If background execution is unavailable, the primary completes the exact scoped documentation directly using the existing handoff and evidence; a bounded foreground maintainer is also allowed when useful. Do not invent unsupported arguments, ask for authorization again, or leave documentation pending solely because background routing is unavailable.
- Save child/task IDs, purposes, owned paths, input revisions and pending results in checkpoint `pending`/`nextAction`. Continue independent work; when none remains, return control so the user can message while children run. Completion notifications resume integration; never poll, sleep, duplicate tasks or mark PENDING work PASS. Preserve unfinished children when feedback steers the request.
- Coordinate file changes and keep private QA contexts/page IDs, test data/reports and cleanup separate across sessions. Respect shared processes/ports and unrelated dirty/staged work.

## Documentation and delivery

- Update affected feature/architecture/contracts alongside implementation in the same branch/PR. Once source is stable, assign maintainer exact docs under `docs/agent-context/`, rationale, evidence and check/review state asynchronously when supported; otherwise update them directly. The primary owns instructions/module READMEs elsewhere. Preserve accepted ADRs; changed durable decisions get a proposed superseding record. Full completion requires reviewed updates or a specific no-impact reason.
- Deliver the smallest complete agreed flow early. Preview is unvalidated; ready-to-test requires focused checks and frontend QA. Required high-risk review may remain pending for local testing, never full completion. Docs don't delay ready-to-test. Reuse passed checks for unchanged inputs; rerun affected coverage.
- Keep milestone replies concise. End each human reply with **Follow-up:** actor, next action/location and expected result. For ongoing background work, state what runs and that the user can keep messaging. No vague lessons, settled-scope repetition or routine approval. Only the primary adds the footer; specialists return evidence. Never claim memory writes/checks succeeded without confirmation.
- Every bug-fix delivery explains the verified root cause, how it produced the symptom, how the change addresses it, and the relevant verification result. Briefly identify decisive evidence. If the cause is uncertain or the change is a workaround, say so explicitly. Keep the explanation concise and understandable to the user.
