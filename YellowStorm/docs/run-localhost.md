# Run locally — interactive website-link indexing

How to run the app on localhost and try the "Add link → browse → pick pages → index" feature.

## Prerequisites

- **Node.js 20+**
- **MongoDB** running locally (the backend reads its connection from `back/.env`)
- `back/.env` already exists and has the URL→PDF conversion API configured (`URL_TO_PDF_API_URL` / `URL_TO_PDF_API_KEY`)

## 1. Backend (port 3000)

```bash
cd back
npm install
npx playwright install chromium   # one-time: downloads the browser the live viewer drives
npm run start:dev                 # Nest API + socket gateway on http://localhost:3000
```

> The `playwright install` step is only needed for local dev. In Docker the app reuses the image's system Chromium, so it's skipped there.

## 2. Frontend

```bash
cd front
npm install
npm run dev                       # Vite prints the URL, usually http://localhost:5173
```

The frontend defaults to the backend at `http://localhost:3000/api/v1` (and the browser-session socket at `http://localhost:3000`). To point elsewhere, set `VITE_API_URL` in `front/.env`.

## 3. Try the feature

1. Open the frontend URL and go to a **workspace**.
2. Click **Add link** and enter a URL (e.g. `https://example.com`), then **Naviguer**.
3. The page streams into the dialog — click around; every page you visit is collected in the right sidebar.
4. Tick the pages you want, click **Indexer (N)**. They convert to PDF and index one at a time (~2s apart), appearing in the document list with a live status.

### Quick sanity checks

- Entering an internal URL like `http://169.254.169.254/` in the address bar shows a **blocked** banner and does not navigate (SSRF guard).
- Selected pages reach `completed` status; conversions are spaced out (no 429 bursts).

## Handy env vars (all optional, sensible defaults)

| Var | Default | Meaning |
|-----|---------|---------|
| `BROWSER_SESSION_MAX_CONCURRENT` | `5` | Max simultaneous browser sessions |
| `BROWSER_SESSION_IDLE_MS` | `300000` | Idle timeout (5 min) |
| `BROWSER_SESSION_MAX_MS` | `1200000` | Hard session lifetime (20 min) |
| `INDEXING_SEQUENTIAL_DELAY_MS` | `2000` | Delay between conversions |
| `BROWSER_SESSION_CHROMIUM_PATH` | _(empty)_ | Path to a system Chromium; empty = use Playwright's bundled browser |
