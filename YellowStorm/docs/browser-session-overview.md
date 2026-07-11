# Interactive link picking — how it works

## What it does

The user submits a URL, we open a real browser they can drive, and **every page
they navigate to is recorded** into a sidebar. They pick the pages they want, and
each one is converted to PDF and indexed like any other document.

## Why we couldn't use an iframe

The obvious approach — load the site in an `<iframe>` and watch what the user
clicks — **does not work** because of the browser's Same-Origin Policy:

- Once the iframe loads a third-party site, our app (a different origin) **cannot
  read what happens inside it**: not the current URL after a navigation, not the
  clicks, not the links followed. The browser blocks it with a `SecurityError`.
- Many sites also refuse to be framed at all (`X-Frame-Options` / CSP
  `frame-ancestors`), so they just render blank.

So "let the user browse and silently capture the links" is impossible from the
frontend. We'd get zero navigation data back.

## How we solved it — the browser runs on the backend

We moved the browser to the **server**, where we fully control it:

1. **Playwright (headless Chromium)** runs on the backend, one session per user.
2. We **stream it to the frontend** as a video-like feed: Chrome's DevTools
   Protocol (CDP) screencast emits JPEG frames, relayed over a **WebSocket** and
   painted onto a `<canvas>`. The user's mouse/scroll/keyboard go back over the
   same socket and are replayed into the real browser.
3. Because **we own the browser**, capturing navigations is trivial: Playwright's
   `framenavigated` event gives us the exact URL + title of every page the user
   lands on. That's what fills the sidebar.

The Same-Origin Policy never applies, because from the frontend's point of view
it's just displaying an image and sending input events — not embedding another
site.

## The flow

```
submit URL
  → backend launches a browser session, starts the screencast
  → frontend shows the live page on a canvas; user clicks around
  → each navigation (framenavigated) → { url, title } → sidebar
  → user picks pages → backend converts each to PDF (one at a time) and indexes
```

## Notes

- **Security:** a server-side browser the user steers can reach internal
  addresses, so every navigation is checked against an SSRF guard (private /
  loopback / cloud-metadata ranges are blocked).
- **Rate limits:** picked pages are converted **one at a time** (with a short
  delay) so the target site doesn't rate-limit (429) the conversion service.
