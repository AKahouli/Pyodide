# Delivery recipes — read only the relevant section

Root/global instructions hold mandatory rules. This reference supplies details for
handoff, QA and documentation without loading every recipe into every turn.

## Background handoff

For bug fixes, the primary's delivery explains cause, symptom, correction and
verification in plain language. Workers supply the cause and decisive evidence in
their handoff. Report hypotheses as unconfirmed and workarounds as workarounds;
never claim a root cause solely because the symptom disappeared.

Use native Task with `background: true` for independent long work. Completion
notifications deliver results; foreground is for an immediately needed dependency.
Prefer background maintainer tasks when the current Task schema supports them. If background execution is unavailable, the primary completes the exact scoped documentation directly using the existing handoff and evidence; a bounded foreground maintainer is also allowed when useful. Do not invent unsupported arguments, ask for authorization again, or leave documentation pending solely because background routing is unavailable.

Supply a compact handoff:

- Absolute worktree root, branch, checkpoint ID and exact question/criteria.
- Exact owned files; shared files reserved by build. Read-only work owns no files.
- Stable source revision/task-scoped diff, relevant docs/symbols and reuse findings.
- Checks already run, input revision and gaps; approved design/execution choices.
- QA-only: route/startup, unique run/context/page IDs, owned data and login recipe.

Save returned child/task IDs, purpose, ownership, input revision and pending result
in existing checkpoint `pending`/`nextAction` fields. Keep entries compact, within
schema limits; do not add a database or duplicate the transcript.
Save the milestone before returning control. If no independent work remains,
end the turn with progress, honest pending checks and the next integration action.
The user may send feedback while children work; reconcile it with existing criteria,
do not silently cancel or duplicate work. Background completion resumes integration.
Report only material findings/failures or promised delivery.

Never poll/sleep to keep the parent busy, duplicate tasks, or treat launch as PASS.
On host interruption, reconcile checkpoint child IDs with actual child state;
notifications are not guaranteed while a process is stopped. Never relaunch without
establishing that the previous work ended. Resume invalidates stale read/check inputs.
If native background execution is unavailable, the primary applies and reviews the
scoped documentation using the existing handoff; bounded foreground delegation is
also allowed. Record progress rather than leaving a routing-only blocker.

## Parallel checks and first result

Once scoped source is stable, run focused checks and private browser QA independently;
required high-risk review may run alongside both. Preserve evidence for unchanged
inputs; changed inputs need fresh relevant checks before a delivery claim.
Workers return shared contract/manifest/translation changes to build.
Separate test namespaces, accounts/tenants when shared state races, reports and owned
cleanup. Never reset shared fixtures. See
[QA fixtures](../../../docs/agent-context/testing/qa-fixtures.md).

Preview is explicitly unvalidated. Ready-to-test includes route/action/expected result
and passed relevant checks/QA. High-risk work labels required review pending until
it passes. Background docs do not delay the first testable result, but full completion
requires reviewed affected updates or a specific no-impact reason.

## Private browser QA and authentication

Each OpenCode process uses Chrome MCP `--isolated`. Each QA task additionally opens
`new_page` with `isolatedContext: "qa-<unique-run-id>"` and passes its returned
`pageId` on every page operation. Retain only that task's context/pages for resume;
never adopt the default tab, copy storage or close another task's browser.
If routing/isolation is unsupported, return BLOCKED/BROWSER_ISOLATION.

AUTH_REQUIRED returns sign-in URL, owned context/page ID, blocked criteria and
checks already passed. Build reuses the confirmed non-secret recipe, or retrieves
one scoped Hindsight result if missing, then asks once for direct sign-in or an
existing test-account/password-manager entry. Independent work continues.
Credentials/MFA are entered directly in the private browser/password manager;
pause inspection during entry and never inspect credential fields, cookies or tokens.
Resume the same child/context after sign-in and verify actual access/role.

After successful sign-in, build may persist a sanitized recipe through
`hindsight_ingest_document`: stable title per origin/environment/role, method,
supplied account alias/role, optional credential-store reference, isolation policy
and verification date. Ephemeral page IDs stay in checkpoint/handoff.
Never retain secrets or claim memory saved without successful confirmation;
failed persistence does not block QA. A recipe avoids repeated account questions,
not necessary authentication in a fresh context.

## Documentation maintenance

Assess changed behavior as well as architecture. Assign exact affected docs under
`docs/agent-context/` to maintainer asynchronously once source is stable, with root,
branch, checkpoint ID, rationale, source/diff, checks and review state.
Changes stay in the implementation branch/PR. Build owns instructions/module READMEs
outside that directory. Coordinate shared indexes; no two tasks own the same file.
Maintainer verifies supplied claims without repeating discovery/test suites.
Changed inputs invalidate its handoff evidence; reconcile before accepting results.

Update owning feature/architecture/contracts; link executable definitions instead of
copying them. New durable decisions get proposed ADRs, accepted only after approved
design and reviewed implementation evidence. Preserve accepted ADRs and supersede
through new records. Keep updated/pending doc paths and child ID in the checkpoint.

## Follow-up examples

- Running: **Follow-up:** Frontend QA and documentation are running in the background.
  You can keep messaging; I will report the test URL after QA passes.
- Ready: **Follow-up:** Open `/conversation`, send a message, then stop it.
  Streaming should stop and the saved thread should reopen.
- Blocked access: **Follow-up:** Sign in at the supplied URL in QA's private context.
  I will resume its remaining checks after you confirm sign-in.
