# Worky Playwright smoke suite

This suite exercises the Worky **per-stream Manager + Workers model selection**
feature end-to-end against a running dev stack (backend + runtime + frontend).

It is intentionally a smoke suite, not full coverage. Pair it with the existing
Vitest unit tests in `src/modules/worky` for the lower-level guarantees.

## Files

- `playwright.config.ts` — config, single `chromium` project, dev baseURL.
- `tests/e2e/fixtures.ts` — typed `workyTest` fixture, REST helpers, stream lifecycle.
- `tests/e2e/auth.setup.ts` — logs in once and writes `storageState`.
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

The suite is single-worker by design (`fullyParallel: false`, `workers: 1`) so
the `setup` project produces a stable `storageState` and REST fixtures don't
race.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `PLAYWRIGHT_BASE_URL` | `http://localhost:5173` | Frontend origin |
| `PLAYWRIGHT_API_BASE_URL` | `http://localhost:3000/api/v1` | Backend API origin |
| `PLAYWRIGHT_USER_EMAIL` | _required_ | Verified user email |
| `PLAYWRIGHT_USER_PASSWORD` | _required_ | Password for that user |
| `CI` | unset | When set: HTML report + 1 retry |

## Adding a new spec

1. Add a new `workyTest('…', async ({ page, authed, freshStream }) => { … })`
   block to `worky-model-selection.spec.ts` (or split into a sibling file —
   `testDir: './tests/e2e'` will pick it up automatically).
2. Reuse `authed` + `freshStream` fixtures — they handle login and clean-up.
3. Prefer `getByTestId` / `getByRole` over raw selectors; the Worky module
   exposes dedicated `data-testid` hooks.
