# ADR-0029: in-memory access-token handoff after refresh

Status: proposed; implemented and qualified as the phase 4 reload regression fix. Architectural acceptance remains proposed.
Date: 2026-10-18

## Context

Refresh cookies are shared by same-origin browser tabs; access tokens live only in
each tab's memory. The backend rotates the session and immediately rejects its
predecessor session ID. The existing Web Lock serialized refresh calls, but the
BroadcastChannel carried only a completion signal. Peers reconnected SSE with an
old token, rotated the cookie again and revoked the previous winner. Live logs
showed repeated successful rotations, revoked-session errors and refresh throttling;
both QA profiles then returned to sign-in on reload.

## Proposed decision / implementation constraints

Reuse the existing same-origin BroadcastChannel to hand off the rotated access
token transiently, before peers reconnect. No credential is written to browser
storage or logs. HttpOnly refresh cookies, atomic server rotation, revocation,
single-flight refresh and the existing Web Lock remain authoritative.

Bound and validate the envelope and JWT routing claims. Authenticated peers accept
only their current principal and a fresh update; malformed, expired, stale,
out-of-order, payload-free and post-logout messages do not restore a session. JWT
claims in the browser route the handoff; they do not verify authorization. The
backend still validates the token and current permissions on every request.
An empty-memory tab can accept a peer only during active cookie restoration for
its current auth generation. Recheck peer recovery after acquiring the Web Lock,
so a waiting tab does not rotate unnecessarily. Dispose listeners and timers when
the development module is replaced.

## Compatibility / limits

The channel is same-origin and transient, not a cross-profile identity bridge.
Same-origin injected code remains an application compromise; this does not make
BroadcastChannel a trust boundary. Old running bundles that reconnect with their
own stale token must load the updated client. Do not close user tabs or discard
drafts to force that rollout. No backend session policy or authentication bypass
is introduced.

## Sources and verification

- `YellowStorm/front/src/lib/api/client.ts`, `crossTabRefresh.ts` and focused tests.
- Two isolated client module graphs with shared cookie/lock/channel reproduce the
  race and verify one rotation plus adoption before reconnect.
- Phase 4 live reload, two-user isolation and final review are recorded in
  `../architecture/conversation-files-artifacts-plan.md`.
