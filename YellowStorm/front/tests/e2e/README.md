# Worky Playwright smoke suite

This suite exercises the Worky **per-stream Manager + Workers model selection**
feature end-to-end against a running dev stack (backend + runtime + frontend).

It is intentionally a smoke suite, not full coverage. Pair it with the existing
Vitest unit tests in `src/modules/worky` for the lower-level guarantees.

## Files

- `playwright.config.ts` — config, single `chromium` project, dev baseURL.
- `tests/e2e/fixtures.ts` — typed `workyTest` fixture, REST helpers, stream lifecycle.
- `tests/e2e/auth.setup.ts` — logs in once and writes `storageState`.
- `tests/e2e/run-context.ts` — shares a unique run ID across configuration/workers and separates auth/artifact paths.
- `tests/e2e/worky-model-selection.spec.ts` — 9 specs covering the 8 user scenarios.

## Prerequisites

1. Backend running at `http://localhost:3000` with a verified user.
2. Frontend dev server running at `http://localhost:5173` (or set `PLAYWRIGHT_BASE_URL`).
3. Admin models seeded with at least one chef default.
4. A real test user (set `PLAYWRIGHT_USER_EMAIL` + `PLAYWRIGHT_USER_PASSWORD`).
5. Playwright browser binary installed.

## Install the browser

```powershell
cd YellowStorm/front
npx playwright install chromium
```

## Run

```powershell
cd YellowStorm/front
$env:PLAYWRIGHT_USER_EMAIL = 'smoke@example.com'
$env:PLAYWRIGHT_USER_PASSWORD = 'SecurePass123'
npm run test:e2e
```

Each CLI run stays single-worker (`fullyParallel: false`, `workers: 1`). Separate
CLI runs get independent auth files, artifacts, and UUID-named stream fixtures.
Credentials are supplied externally through the environment; keep them out of
Git, chat, memory, reports, and command examples containing real values.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `PLAYWRIGHT_BASE_URL` | `http://localhost:5173` | Frontend origin |
| `PLAYWRIGHT_API_BASE_URL` | `http://localhost:3000/api/v1` | Backend API origin |
| `PLAYWRIGHT_USER_EMAIL` | _required_ | Verified user email |
| `PLAYWRIGHT_USER_PASSWORD` | _required_ | Password for that user |
| `PLAYWRIGHT_RUN_ID` | generated UUID | Optional unique ID per CLI run; 1-80 letters/digits/underscores/hyphens, starting with a letter/digit |
| `CI` | unset | When set: HTML report + 1 retry |

## Concurrent runs and test accounts

Use a distinct `PLAYWRIGHT_RUN_ID` for every simultaneous CLI run if assigning
one explicitly; leave it unset for automatic allocation. Workers inherit the
launcher's ID. Auth state lives in `tests/e2e/.auth/<run-id>/storage-state.json`,
results in `test-results/<run-id>/`, and CI HTML reports in
`playwright-report/<run-id>/`. These directories are ignored by Git. Do not
reuse another active run's state file or delete its artifacts.

Use an approved test account with the role needed by the acceptance criteria.
Parallel runs may share an account only when they use independent records and
do not alter account-wide settings, permissions, quotas, or session state.
Otherwise use separate accounts/tenants or serialize those flows. This setup
does not provision accounts or bypass authentication.

Reuse `freshStream` for run-owned data and its scoped teardown. New fixtures
should create the smallest required state, use unique names, and clean up only
their own records. Avoid global seed/reset commands during concurrent QA.

## User-reported regressions

Confirm the failure, then extend the smallest existing unit/integration test
that proves the reported behavior; add an E2E scenario when the browser flow
is essential. Show failure before the fix and success afterward when feasible.
Reuse these fixtures and retain a concise reproduction when automation is
impractical. Rerun affected QA while preserving unchanged passing evidence.

## Adding a new spec

1. Add a new `workyTest('…', async ({ page, authed, freshStream }) => { … })`
   block to `worky-model-selection.spec.ts` (or split into a sibling file —
   `testDir: './tests/e2e'` will pick it up automatically).
2. Reuse `authed` + `freshStream` fixtures — they handle login and clean-up.
3. Prefer `getByTestId` / `getByRole` over raw selectors; the Worky module
   exposes dedicated `data-testid` hooks.
