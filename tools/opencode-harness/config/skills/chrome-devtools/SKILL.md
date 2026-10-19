---
name: chrome-devtools
description: Token-efficient browser QA with the chrome-devtools MCP tools - viewport setup, snapshot-first inspection, console and network checks, evidence capture. Load before driving the browser for frontend QA.
---

# Chrome DevTools QA recipe

Tool names are prefixed `chrome-devtools_`. Prefer text over pixels: a snapshot costs a few hundred tokens, a screenshot costs thousands.

## Order of operations

1. Start each QA task with `new_page({url, isolatedContext: "qa-<unique-qa-run-id>"})`; retain its page ID. Reuse only this owned context/page on resume. Independent MCP instances use `--isolated` temporary profiles. Pass the owned `pageId` on every page-scoped call; never rely on a globally selected tab. Resize your page to 1440x900 when needed; wait with `wait_for` on stable text instead of fixed sleeps.
2. `take_snapshot` to get the accessibility tree with element `uid`s. Use it to locate targets and to assert text, roles, and states.
3. Interact with `click`, `fill`, `fill_form`, `hover`, `press_key`, `drag` using `uid`s from the latest snapshot. Re-snapshot after navigation or significant DOM changes; never reuse stale uids.
4. `list_console_messages` (filter to error and warn) after each meaningful interaction. Report only new messages caused by the flow under test.
5. `list_network_requests` filtered by the API path under test; `get_network_request` only for a request whose status or body matters to a finding.
6. `take_screenshot` only for a visual acceptance criterion or evidence of a finding. Save under `qa-artifacts/<task>/<run>/`.
7. `evaluate_script` only for reading computed values (for example overflow or contrast) that snapshots cannot show.

## Rules

- Reuse authentication only inside this task's owned context. New private contexts do not inherit another session's login. If sign-in is needed, return `BLOCKED / AUTH_REQUIRED` with URL, context/page IDs, blocked criteria, and exact action to the primary agent. It asks the user once for this context to sign in directly in the browser/password manager. Never type or inspect credentials; pause inspection during entry. Resume the same QA task after confirmation and preserve unchanged checks.
- Return a non-secret login recipe: origin/environment, method, supplied account alias/role, credential-store reference if available, browser policy `isolated`, and verification date. Ephemeral context/page IDs stay in the current handoff. Never copy or store credentials, cookies, tokens, or OTPs in Hindsight, Git, or artifacts.
- If isolated contexts or page-ID routing are unavailable, return `BLOCKED / BROWSER_ISOLATION`; never use another task's tab or shared default context. Keep owned pages for auth waits and user testing; close only your pages when released by the primary agent. Parallel test data also needs run ownership and scoped cleanup.
- Redact tokens, cookies, emails, and customer data from any evidence.
- Do not emulate mobile unless the handoff requests it.
- Stop after the required coverage; do not explore unrelated routes.
