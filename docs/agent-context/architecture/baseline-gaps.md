# Baseline gaps and unknowns

Recorded 2026-10-13 during the verified-documentation baseline. Inspection only;
nothing here authorizes new schemas, tables, services, modules, or dependencies.
Each item needs owner evidence before it can become an accepted record. Do not
invent rationale from code alone (per [change control](change-control.md)).

## Needs targeted source trace (no decision required)

1. **Full frontend route/guard table** — `YellowStorm/front/src/Router.tsx`
   lazy boundaries + `RootGuard`/`AdminGuard`/`PermissionGuard` coverage were
   sampled, not exhaustively mapped. Needed by: route changes.
2. **Conversation-v2 app-shell single connection** — stated in
   `YellowStorm/front/AGENTS.md`; owner module not fully traced (legacy
   `conversation/stream.ts` and widget template verified; v2 owner unverified).
3. **XState / query-client ownership** — Zustand stores and React Query usage
   sampled (`models`/`agent`/`workspace`/`worky` stores, governance/worky queries);
   XState presence unestablished; global query client owner unconfirmed.
4. **Complete `VITE_*` inventory** — verified keys: `VITE_API_URL`,
   `VITE_SOCKET_BASE_URL`, `VITE_PORT`, `VITE_OPENUI_RENDER_ENABLED`,
   `VITE_CONVERSATION_LATENCY_UI_ENABLED`, `VITE_APP_RUNTIME_ENABLED`,
   `VITE_PLAYBOOK_QUERY_*`, `VITE_WORKY_MCP_URL`, `VITE_APP_URL`, runtime-injected
   `VITE_YM_*`. Full declaration-vs-consumption audit not done
   (`src/vite-env.d.ts`, `src/config/*Features.ts`, `<module>/features.ts`).
5. **Backend per-module controller/service/schema breakdown** — 51 module dirs
   listed; internals beyond the key-ownership table unverified
   (`YellowStorm/back/src/modules/*/*.module.ts`, `src/app.module.ts:112-153`).
6. **Mongo schema inventory** — Mongoose remains a dependency; exact active vs
   legacy collection set beyond conversation not enumerated.
7. **Lease/outbox/idempotency implementations** — Mongo-embedded lease shape and
   named outbox/job call sites sampled from guidance, not exhaustively bound to
   code.
8. **REST envelope/pagination wire shape** — global pipe + `pagination.dto.ts`
   verified; full envelope/error-code registry not dumped here by design (link,
   don't copy).
9. **SSE cleanup/cursor code paths** — owner files identified; per-route cleanup
   verification pending for changed streams.
10. **Prod deployment topology** — process boundaries verified; actual prod
    hosts/ports/scaling, TLS termination, and secret-manager wiring not
    established from scoped sources (`yellowstorm-adk/docker-compose.yaml`,
    `infra/observability/compose.yaml` are dev/local evidence only).
11. **Per-RPC ADK caller inventory** — chat/playbook/widget paths verified; every
    RPC's full caller set not enumerated (dynamic dispatch + serialized
    boundaries need targeted search per change).

## Needs owner decision / rationale (candidate `proposed` ADRs, not yet written)

- Historical rationale for Postgres-vs-Mongo conversation split, store-token
  pattern, `char(24)` id preservation, and `toGrpcStruct` convention was not
  reconstructed — implementation is described in [overview](overview.md) and
  [cross-service contracts](cross-service-contracts.md); no ADR invented from
  code alone.
- Historical rationale for hash-router + lazy boundaries, in-memory token +
  refresh-queue auth, and MCP-delegated (NestJS-authoritative) Playbook design
  likewise not reconstructed.
- If an owner confirms a durable decision with alternatives/rationale, file it as
  `docs/agent-context/decisions/ADR-0008-<topic>.md` (`status: proposed` until
  explicitly approved with reviewed implementation evidence; next free number is
  **0008** — primary agent owns numbering). Supersede accepted records with a new
  ADR; never rewrite them.

## Non-gaps (deliberately out of scope for this baseline)

- Pre-existing unrelated worktree deletions (`.gitignore` tweak, removed
  `YellowStorm/back/docs/*` audit/migration notes, removed QA png) are not part
  of this task and were left untouched. Note: the uncommitted deletion of
  `YellowStorm/back/docs/migrations/conversation-postgres-phase-1.md` leaves the
  existing Conversation index row in `docs/agent-context/README.md` dangling;
  restoring or re-linking it is out of scope for this baseline and left for its
  owning task.
- SDLC native checkpoint tools (`sdlc_checkpoint`/`sdlc_prepare`/`sdlc_diff`)
  are not installed in this session; goal/criteria/ownership/verification are
  recorded in the task log and this report instead.
