# DISCOVERY — Playbooks Homepage Refactor (Ops Console)

Date: 2026-09-13 · Repo: `C:\prog\YellowStorm-poc` · Frontend root: `YellowStorm/front`

## 2.1 Code inventory

| Concern | Finding |
|---|---|
| List route component | `src/modules/playbook/components/PlaybookListPage.tsx` (route `#/playbooks`, hash router confirmed, `src/Router.tsx:265`) |
| Card / badge / filters / bulk bar / counter band | `PlaybookCard.tsx` (also reused by `PlaybooksCarousel.tsx` — **kept**), `PlaybookStatusBadge.tsx`, filter popover + bulk bar inline in the page, `PlaybookExecutionKpiCards.tsx` (deleted with the page) |
| Data layer | Zustand (`store.ts`, 5.7k lines). TanStack Query exists behind env flags (`features.ts`) — **off by default**; store calls `api.ts` directly |
| List loading | Store actions `fetchPlaybooks(query)` / `fetchMorePlaybooks()` → `api.getPlaybooks` → `GET /playbooks` (`page`/`limit` offset pagination, backend max limit **100**) |
| Item type | `PlaybookSummary` in `types.ts:1114-1132` (verbatim below). **The backend actually returns the raw flow doc** (`nodes[]`, `triggerConfig`, `isFavorite`, `ownerId`, `workspaces`, overlays `executionStatus`, `lastExecutionAt`) — the TS type is narrower than reality. `taskCount`, `scheduleEnabled`, `executionSchedule`, `integrationToken` are `undefined` at runtime today (root cause of B1). |
| shadcn primitives | All exist under `src/components/ui/`: `table`, `tabs`, `popover`, `sheet`, `command` (cmdk 1.1.1), `dropdown-menu`, `badge`, `checkbox`, `tooltip`, `skeleton`, `dialog`, `alert-dialog`, `progress` |
| Command palette | cmdk used as list engine inside selects; **no global palette mounted** — `CommandDialog` is free to use |
| Icons | `lucide-react@^0.292` |
| Tailwind | **v4** (`@import 'tailwindcss'`, `@theme inline` in `src/index.css:5`). Tokens in `@layer base`: `:root`, `.dark`, `.theme-yellowsys(.dark)`, `.theme-claude(.dark)`, `.theme-kpmg(.dark)` |
| Routes | `#/playbooks`, `#/playbooks/:id` (canvas), `#/playbooks/:id/executions/:executionId` (run viewer). "Monitor" = canvas run mode |
| i18n | react-i18next, module namespace `playbook`, flat dot keys in `locales/{en,fr}.json`. All new strings must go there |
| localStorage | No `ym.*` keys yet; spec keys `ym.playbooks.view` / `ym.playbooks.tidyDismissedUntil` are introduced by this work |
| Live channel | **SSE exists**: `services/playbookStreamService.ts` singleton (leader election, reconnect), `usePlaybookStreamGlobal` mounted app-wide in `RootGuard.tsx`. `playbook_connected` → `store.hydrateActiveExecutions` (full active execs incl. `taskResults`, `interruptPayload`); step/terminal events project into `executionCache` + `executingPlaybookIds`. REST fallback `GET /playbooks/active-executions` (`api.getActiveExecutions`) |

`PlaybookSummary` (verbatim, `types.ts:1114-1132`):

```ts
export interface PlaybookSummary {
  id: string;
  name: string;
  description: string;
  definitionRevision?: number;
  taskCount: number;
  isFavorite: boolean;
  /** True when the playbook has an enabled execution schedule (list API). */
  scheduleEnabled: boolean;
  automatedTriggerType?: 'schedule' | 'mail' | null;
  /** Latest known execution state for the list badge. */
  executionStatus?: ExecutionStatus | null;
  integrationToken?: string | null;
  /** Full schedule data when included by the list API (optional, backend-dependent). */
  executionSchedule?: ExecutionScheduleData | null;
  lastExecutionAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

## 2.2 Data availability audit

| Field (§5.1) | Status | Source |
|---|---|---|
| `stepCount` | **Available client-side** | raw list item carries `nodes: FlowNode[]` → `nodes.length` |
| last run status / started-at | Available | list overlays `executionStatus`, `lastExecutionAt` |
| last run duration / id | Available via companion endpoint | `GET /playbooks/:id/executions?page=1&limit=8` (summary has `id`, `status`, `durationMs`, `startedAt`, `error`) |
| run history (last N) | **Per-playbook only** (no bulk REST; bulk helper is internal to the assistant service) | same endpoint, fetched lazily per playbook |
| trigger kind + schedule | Available | raw `triggerConfig: { kind: 'schedule'|'mail', params }`; manual = implicit |
| next scheduled fire | **Not stored anywhere** | computed client-side from schedule params (`daily.timesLocal`, `weekly.slots`, `monthly.slots`, `advanced`) — backend field `scheduleType` maps to frontend `ExecutionScheduleData.type` |
| `isFavorite` | Available | raw doc field + `POST /playbooks/:id/favorite` toggle |
| `isArchived` | **Does not exist** | no archive concept in schema/API |
| live run state | **SSE channel exists** (see 2.1) | no polling needed; `Approve` (`resumeExecution` → `POST /executions/:id/resume-approval`), `Retry` (`runFromStep`), `Stop` (`stopExecution` → cancel), `Run` (`executePlaybook`) all exist as store actions |

Additional audit finding: the current Filters popover sends `minTasks`/`maxTasks`/`dateField`/`dateFrom`/`dateTo` and `sortBy=taskCount|lastExecutionAt` — the backend `ValidationPipe(forbidNonWhitelisted)` **rejects all of these with 400** (`PlaybookFlowQueryDto` only allows `page, limit, sortBy∈{updatedAt,createdAt,name,activityAt}, sortOrder, search, view`). Those filters were already broken; the refactor applies them client-side.

## Pagination path taken (§11)

Backend caps `limit` at 100. The page **loads all pages up front** (sequential fetches of 100 while `page < totalPages`, ceiling 400 items — `ponytail:` ceiling noted in code; virtualisation is follow-up work if a workspace exceeds it). Search, chips, filters and sort then apply to the whole result set client-side.

## 2.3 Deviations from the spec (spec-sanctioned or unavoidable)

1. **Archive** — no backend concept → Archive segment + bulk archive omitted (§5.3 row "isArchived"). Follow-up issue if the backend adds the flag.
2. **Integration URL** — backend endpoint deferred (`integration-link` controller comment); list returns no token. The existing `⋯` menu item + dialog are kept for capability parity; the drawer's Integration section only renders for webhook triggers, which cannot occur today.
3. **Webhook trigger kind** — does not exist. `TriggerKind = 'manual' | 'schedule' | 'mail'` (mail gets its own icon/label). "Scheduled" segment = any non-manual trigger, matching spec intent.
4. **Run history / Reliability column** — no bulk endpoint. Instead of hiding the column (§5.3) or waiting for a backend aggregate (open question 3), the console fetches `limit=8` history per playbook **lazily, concurrency-limited (3)**, only while total playbook count ≤ 60, cached in the store (`executionHistoryByPlaybook`) and kept fresh by SSE terminal events. Rows without history render no strip (never fake). Upgrade path: aggregate endpoint.
5. **Step/date filters** — applied client-side (backend 400s, see audit).
6. **`purpose` durable fix** — follow-up issue to store a short purpose at creation time; this refactor ships the client-side derivation only (spec §6.1 note).
7. **Virtualisation (§11)** — skipped: load-all ceiling of 400 items renders fine without it; revisit if real workspaces exceed that.
8. **FR/EN string mix** — untouched (§16); all *new* strings are added to both `en.json` and `fr.json`.

No blocker requires a human decision before proceeding: every gap above has a §5.3 degradation rule or a client-side derivation, and all rail mutations (approve/retry/stop/run) have real endpoints.
