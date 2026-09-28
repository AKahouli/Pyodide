# Deploying YellowStorm with Docker (browsing + WebSockets)

**Goal:** get the app running in Docker with the **interactive web navigator** working.
The navigator failed on the first deploy because it needs two things a plain deploy misses:

1. **A real Chromium** inside the backend container (Playwright drives it in-process).
2. A **WebSocket (Socket.IO) path that reaches the backend** — and Socket.IO does **not**
   live under `/api`, it lives at **`/socket.io/`**. A proxy that only forwards `/api`
   silently breaks browsing.

This guide is the straight-line path. Follow the steps in order.

---

## 0. How the pieces talk (read this first — it explains the bug)

```
┌────────────┐        HTTPS /            ┌──────────────────────┐
│  Browser   │ ───────────────────────► │  frontend (nginx)    │  static files only
│            │                          └──────────────────────┘
│            │   HTTPS  /api/v1/... (REST)         ┌───────────────────────────┐
│            │ ─────────────────────────────────► │  backend (Node + Chromium)│
│            │   WSS    /socket.io/  (browsing)    │  - REST API               │
│            │ ─────────────────────────────────► │  - Socket.IO gateway      │
└────────────┘                                    │    namespace /browser-... │
                                                  │  - Playwright → Chromium  │
                                                  └───────────────────────────┘
                                                        │ HTTP POST /convert-url-pdf
                                                        ▼
                                                  ┌───────────────────────────┐
                                                  │  url-to-pdf service        │  (indexing only)
                                                  └───────────────────────────┘
```

Key facts that decide whether browsing works:

- The **frontend is static** (`front/nginx.conf` only does `try_files`). It does **not**
  proxy the API or the socket. The built JS carries your real backend URL (e.g.
  `https://api.example.com/api/v1`), injected either at build time via `--build-arg
  VITE_API_URL=...` or at runtime by `env.sh` rewriting the `MY_APP_VITE_API_URL` literal.
- The browser then opens the Socket.IO connection to that URL's **origin** (`/api/v1` is
  stripped): `wss://api.example.com/socket.io/?...` on namespace `/browser-session`.
- Therefore **whatever sits in front of the backend must forward `/socket.io/` with the
  WebSocket `Upgrade` headers** — not just `/api`. This is the #1 reason "browsing didn't
  work."
- **Live browsing** = Chromium-in-backend + WebSocket. **Indexing the collected links to
  PDF** additionally needs the separate `url-to-pdf` service (`URL_TO_PDF_API_URL`).

---

## 1. Build the two images

The backend image already installs Chromium and the fonts/libs Playwright needs, and points
Playwright at it via `BROWSER_SESSION_CHROMIUM_PATH=/usr/bin/chromium` (see `back/Dockerfile`).
You don't have to change the Dockerfile — just build it.

```bash
# from repo root
docker build -t yellostorm-back:latest ./back
docker build -t yellostorm-front:latest ./front
```

> CI note (already in the Dockerfile comments): if your build runner has no bridge-network
> outbound access, build the backend with `--network=host`.

---

## 2. Backend environment variables

Set these on the **backend** container. The browser-session ones already have sane defaults
baked into the image; the **must-set** ones are marked ✅.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP + WebSocket port the backend listens on |
| `API_PREFIX` | `api` | REST prefix. **Does not apply to `/socket.io/`.** |
| ✅ `CORS_ORIGIN` | `http://localhost:5173` | **Comma-separated list of allowed frontend origins.** Must include your real frontend origin (e.g. `https://app.example.com`) or REST calls are blocked. |
| `BROWSER_SESSION_CHROMIUM_PATH` | `/usr/bin/chromium` (set in image) | Chromium binary Playwright launches. Leave as-is unless you changed the base image. |
| `BROWSER_SESSION_MAX_CONCURRENT` | `10` | Max simultaneous live browser sessions (each is a real Chromium context — watch memory). |
| `BROWSER_SESSION_IDLE_MS` | `300000` | Kill an idle session after 5 min. |
| `BROWSER_SESSION_MAX_MS` | `1200000` | Hard cap a session at 20 min. |
| `BROWSER_SESSION_VIEWPORT_W` / `_H` | `1280` / `720` | Remote viewport (must match the frontend constants — leave default). |
| ✅ `URL_TO_PDF_API_URL` | `http://localhost:5000` | The url-to-pdf service, used when **indexing** collected links. Point it at your deployed service. |
| `URL_TO_PDF_API_KEY` | *(empty)* | Auth for that service, if it requires one. |
| — plus your usual app env | — | Mongo URI, JWT secret/issuer/audience, etc. (unchanged by this feature). |

Chromium runs headless with `--no-sandbox --disable-dev-shm-usage` (already in the engine),
so it works as the non-root container user and won't exhaust the default 64 MB `/dev/shm`.

---

## 3. Frontend environment variable

The public backend URL is baked into the built JS. Set exactly one mechanism:

| Variable | Where | Example | Purpose |
|---|---|---|---|
| ✅ `VITE_API_URL` | `docker build --build-arg VITE_API_URL=...` | `https://api.example.com/api/v1` | **Public** REST base URL, inlined by Vite. Baked into the image. |
| `VITE_SOCKET_BASE_URL` | `docker build --build-arg VITE_SOCKET_BASE_URL=...` | `https://api.example.com` | Optional socket origin override. Defaults to the API URL's origin. |
| `MY_APP_VITE_API_URL` | container env at start | `https://api.example.com/api/v1` | Same value, injected at runtime by `env.sh` instead. Use this when one image serves several environments. |

If neither is set, the app requests `<frontend-origin>/MY_APP_VITE_API_URL/...`, nginx
returns the SPA HTML with **200**, and every call fails with a `filter`/`map` of undefined.

**Critical:** this must be the URL the *browser* can reach (public DNS/ingress), **not** an
internal Docker service name like `http://backend:3000`. The browser — not the frontend
container — opens the WebSocket. If this is wrong or unset, the socket falls back to the
frontend's own origin (which runs no Socket.IO) and browsing silently fails.

---

## 4. Route `/socket.io/` to the backend **with WebSocket upgrade** (the fix)

If the backend is exposed to the browser **directly** (its own public hostname/ingress),
you only need to make sure that ingress allows WebSocket upgrades. If anything proxies the
backend, it must forward **both** `/api/` and `/socket.io/`, and pass the upgrade headers.

### Reverse-proxy example (nginx in front of the backend)

```nginx
map $http_upgrade $connection_upgrade {   # required for WS upgrade
  default upgrade;
  ''      close;
}

server {
  listen 443 ssl;
  server_name api.example.com;
  # ... ssl_certificate / ssl_certificate_key ...

  # REST
  location /api/ {
    proxy_pass http://backend:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Socket.IO (live browsing) — NOTE: /socket.io/, not under /api
  location /socket.io/ {
    proxy_pass http://backend:3000;
    proxy_http_version 1.1;                       # required for upgrade
    proxy_set_header Upgrade $http_upgrade;       # required
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;                     # long-lived stream; don't cut it at 60s
    proxy_send_timeout 3600s;
    proxy_buffering off;                          # stream frames without buffering
  }
}
```

The three things that break browsing if omitted: `proxy_http_version 1.1`, the `Upgrade` /
`Connection` headers, and the long `proxy_read_timeout` (the default 60 s tears down the
screencast mid-session).

### Cloud load balancers — the equivalent knobs

- **Nginx Ingress (k8s):** WebSockets work by default; just raise the timeouts:
  `nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"` and `-send-timeout: "3600"`.
- **AWS ALB:** WebSockets are supported natively; make sure the target group idle timeout is
  high enough (default 60 s → raise it).
- **Traefik:** WS works out of the box; no sticky-session needed here since the frontend
  prefers the `websocket` transport (single upgraded connection).
- **Cloudflare / other CDNs:** enable WebSockets for the hostname; don't "cache everything"
  on `/socket.io/`.

> Sticky sessions: this app uses a single backend and the client prefers the `websocket`
> transport, so you don't need cookie affinity. If you ever scale the backend to **multiple
> replicas**, a live session is pinned to one Chromium in one pod — enable sticky sessions
> (or keep browsing on a single replica) so the polling handshake and the upgrade land on
> the same pod.

---

## 5. One-box `docker-compose` (frontend + backend + gateway)

A minimal compose that puts an nginx **gateway** in front so the browser hits one origin for
both REST and the socket. Adjust images/env to your stack (Mongo, url-to-pdf, secrets).

```yaml
services:
  backend:
    image: yellostorm-back:latest
    environment:
      PORT: "3000"
      CORS_ORIGIN: "https://app.example.com"          # your frontend origin
      URL_TO_PDF_API_URL: "http://url-to-pdf:5000"
      # BROWSER_SESSION_CHROMIUM_PATH is preset in the image
      # ... MONGO_URI, JWT_*, etc.
    # shm_size helps Chromium even though --disable-dev-shm-usage is set:
    shm_size: "1gb"
    expose: ["3000"]

  frontend:
    image: yellostorm-front:latest
    environment:
      MY_APP_VITE_API_URL: "https://api.example.com/api/v1"   # PUBLIC backend URL
    expose: ["80"]

  gateway:
    image: nginx:stable-alpine
    depends_on: [backend, frontend]
    ports: ["443:443", "80:80"]
    volumes:
      - ./gateway.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certs:/etc/nginx/certs:ro

  url-to-pdf:
    image: your-url-to-pdf:latest     # the /convert-url-pdf service
    expose: ["5000"]
```

`gateway.conf` = the nginx from **Step 4** (serve/pass the frontend on `/`, `/api/` and
`/socket.io/` to `backend:3000`). If instead you expose the backend on its **own** public
hostname, drop the gateway and just point `MY_APP_VITE_API_URL` at that hostname — only make
sure that hostname's ingress does the Step 4 upgrade handling.

---

## 6. Run and verify

```bash
docker compose up -d
```

Verify each layer — in order — so you know exactly where a failure is:

1. **Backend is up:**
   `curl -fsS https://api.example.com/api/v1/health` → 200.

2. **Chromium is present in the backend container:**
   ```bash
   docker compose exec backend /usr/bin/chromium --version
   ```
   Prints a version → Playwright can launch it. (Command not found → the image didn't build
   the Chromium layer.)

3. **WebSocket upgrades reach the backend.** Open the app, launch the navigator, and in the
   browser **DevTools → Network → WS**: you should see a request to `…/socket.io/…` return
   **101 Switching Protocols** and stay open, with `frame`/`navigated`/`loading` messages
   flowing. Anything else means Step 4 isn't done:
   - **404 / 400 on `/socket.io/`** → the proxy isn't routing that path to the backend.
   - **200 but no upgrade / connection drops after ~60 s** → missing `Upgrade` headers or a
     short `proxy_read_timeout`.
   - **CORS error on the handshake** → `CORS_ORIGIN` doesn't include the frontend origin.
   - **Connects to the frontend origin, not the API** → `MY_APP_VITE_API_URL` unset/wrong.

4. **A page actually renders** in the navigator canvas → Chromium + screencast + WS all good.

5. **Indexing works:** select pages → *Indexer* → PDFs appear. If this errors but browsing
   works, it's the **url-to-pdf** service (`URL_TO_PDF_API_URL`), not the browser session.

---

## 7. Troubleshooting quick table

| Symptom | Most likely cause | Fix |
|---|---|---|
| Navigator canvas stays blank / "connecting" forever | WebSocket never upgrades | Step 4: route `/socket.io/` + `Upgrade` headers |
| Works locally, breaks in prod behind a proxy | Proxy forwards `/api` only | Add a `/socket.io/` location block |
| Session drops after ~1 minute | Proxy/LB idle timeout too low | Raise `proxy_read_timeout` / target-group idle timeout to 3600 s |
| REST works, socket handshake fails with CORS | `CORS_ORIGIN` missing frontend origin | Add the exact frontend origin (scheme+host) |
| Socket tries to hit the frontend host | Public backend URL never injected | Build with `--build-arg VITE_API_URL=...` or set `MY_APP_VITE_API_URL` on the container |
| Backend logs "Chromium/Target closed" on launch | Missing libs or tiny `/dev/shm` | Use the provided image; set `shm_size: 1gb`; `--no-sandbox`/`--disable-dev-shm-usage` are already on |
| Browsing fine, "Indexer" fails | url-to-pdf service unreachable | Deploy it and set `URL_TO_PDF_API_URL` (+ key) |
| Multiple backend replicas, random disconnects | Session pinned to one pod | Enable sticky sessions or keep browsing on one replica |

---

## 8. Final checklist

- [ ] Backend image built (includes Chromium at `/usr/bin/chromium`).
- [ ] Frontend image built with the public backend URL incl. `/api/v1` (`--build-arg VITE_API_URL=...`, or `MY_APP_VITE_API_URL` on the container).
- [ ] `CORS_ORIGIN` includes the frontend origin.
- [ ] The proxy/ingress in front of the backend forwards **`/api/`** *and* **`/socket.io/`**.
- [ ] `/socket.io/` block sets `proxy_http_version 1.1`, `Upgrade`/`Connection` headers, and a long read timeout.
- [ ] `url-to-pdf` deployed and `URL_TO_PDF_API_URL` set (for indexing).
- [ ] DevTools shows `101 Switching Protocols` on `/socket.io/` and a page renders.
