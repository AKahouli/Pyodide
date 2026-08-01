# YellowStorm Frontend — Coding Guidelines

> **Golden rule:** before introducing a new pattern, look at an existing sibling module (`playbook`, `conversation`, `workspace`, `admin`). If a pattern already exists, follow it.

---

## 1. Stack

| Layer | Tech |
|-------|------|
| Framework | React 18 + TypeScript (strict) |
| Bundler | Vite 6 |
| Routing | `react-router-dom` v6 (hash router) |
| State & UI State | Zustand 5 (`devtools` middleware) + React Context for auth/theme/settings |
| Data Fetching | `@tanstack/react-query` v5 (playbook, worky, governance; alongside Zustand where migration is staged) |
| Workflow / State Machines | `xstate` v5 + `@xstate/react` v6 (execution lifecycle, autosave, stream lifecycle) |
| HTTP | Axios (single shared instance with interceptors) |
| Forms | `react-hook-form` + `zod` + `@hookform/resolvers` |
| UI primitives | Radix UI + shadcn/ui wrappers under `src/components/ui/` |
| Styling | Tailwind CSS v4 + `class-variance-authority` + `clsx` + `tailwind-merge` |
| Icons | `lucide-react` + custom `Icons` map in `src/components/icons.tsx` |
| i18n | `i18next` + `react-i18next` (lazy namespace loading) |Identifying Playbook State Management
terminal:powershell
 wwhat stack are we using for state managment in playbook ?
12:05 PM
In the playbook module, we use a layered state management stack as documented in the 

FRONTEND_GUIDELINES.md
:

Zustand (v5):
Used as the default local module/UI state store.
Defined in 

store.ts
 and 

uiStore.ts
.
TanStack Query (v5):
Used for server-state caching, fetching, cache invalidation, and mutations under the query/ subdirectory.
XState (v5):
Used for orchestration of complex stateful lifecycles (e.g., execution lifecycles, autosave coordination, stream lifecycles) under the machines/ subdirectory.
React Context:
Provides client scope mapping, such as PlaybookQueryProvider.
Migration and feature coexistence between these layers (e.g., Zustand vs. TanStack Query / XState) are controlled by the local flags configured in 

features.ts
 (see 

playbookFeatures
).

Summary of Actions
Read and verified state management guidelines in 

FRONTEND_GUIDELINES.md
.
Checked the playbook module structure using list_dir to confirm files such as 

store.ts
 and 

uiStore.ts
.
Verified the state migration feature flags in 

features.ts
.
12:05 PM
by implementing elerticsql is trhere any chance to reduce the app complexity and improve reliability and maintainbility
12:07 PM
Implementing a full client-side integration of ElectricSQL (subscribing directly from the React frontend rather than using NestJS as an intermediate mirror) offers significant potential to reduce application complexity, improve reliability, and enhance maintainability.

Here is an analysis of how this architectural shift would impact the application.

1. Reducing App Complexity
Currently, the system uses a CDC (Change Data Capture) hybrid mirror architecture as described in the 

Worky gRPC Manager + Electric SQL Sync Plan
:

Python/Postgres (ADK Agent) 
   └── [ElectricSQL Shape Stream] 
           └── NestJS WorkyElectricConsumerService 
                   └── [Mapper & MongoDB Upsert] 
                           └── MongoDB 
                                   └── [NestJS SSE Broadcast] 
                                           └── Frontend (SSE Listener -> TanStack Query Refetch -> MongoDB Read API)
By allowing the React client to subscribe directly to ElectricSQL's HTTP Shape Streams:

Eliminate NestJS Mirroring Layer: We could delete the 

WorkyElectricConsumerService
, Mongoose schemas (WorkyTask, WorkyMessage, WorkyPlanProjection), and mapper files.
Eliminate Custom SSE Channels: You would no longer need to manage custom SSE connection logic and event dispatchers for UI synchronization.
Fewer Data Hops: The data pipeline simplifies from a 7-step process to a direct sync channel: Postgres (Python ADK) -> ElectricSQL -> React Client.
2. Improving Reliability
Network & Offline Resilience: ElectricSQL handles connection drops, exponential backoff, and offset-resuming out of the box. In case of network timeout issues (like the Mongo and gRPC timeout errors seen in your terminal logs), a local-first client will seamlessly resume the shape stream from its last acknowledged offset as soon as connection is restored.
Reduced Database Serialization Overhead: Storing Postgres rows, mapping them, and then re-upserting them into MongoDB creates multiple points of serialization failure. Removing the Mongo persistence step on the read-path reduces write bottlenecks on the database.
3. Improving Maintainability
Single Source of Truth: Postgres remains the sole database schema for Worky session states. A schema change on the Python ADK side would propagate directly to the frontend types without needing updates to NestJS contract/mapper files.
Less Backend Boilerplate: No need to write or maintain REST read endpoints (like /worky/board or /worky/messages), nor shape stream cursor-persistence tables in MongoDB (WorkyElectricCursor).
Key Trade-offs & Caveats to Consider
Write Path Stays RPC-Based: ElectricSQL simplifies the read (sync) path, but the write path (e.g. user messages, execution commands like start/pause) must still pass through a NestJS/gRPC gateway for authorization, validation, and agent kickoff.
Access Control & Scoping: Direct frontend sync requires configuring Electric shapes to dynamically filter rows based on the logged-in user's session identifier (typically verified using a proxy or JWT middleware), preventing users from reading other sessions.
ElectricSQL Versioning: ElectricSQL v1.0 recently pivoted to focus on lightweight HTTP-based Shape Streams, which can easily map into TanStack Query or custom React state. This avoids the bundle size and setup complexity (e.g. OPFS/Wasm headers) of the previous SQLite-in-Wasm local-first client.
Summary of Actions
Analyzed the existing 

WorkyElectricConsumerService
 sync mechanisms.
Assessed the architectural trade-offs of the current Postgres $\rightarrow$ Electric $\rightarrow$ Mongo $\rightarrow$ SSE 
| Toasts | `sonner` via `@/lib/notifications` wrapper |
| Streaming | Native `EventSource` SSE, fetch + `ReadableStream` SSE, singleton services, BroadcastChannel leader-election, per-session hooks |
| Charts / tables / graphs / flow | `recharts`, `@tanstack/react-table`, `@xyflow/react`, `@dagrejs/dagre` |
| Virtualization | `virtua` |
| AI / LLM UI | Vercel AI SDK (`ai`), `@anthropic-ai/sdk`, `streamdown`, `react-markdown`, `shiki`, `tokenlens` |
| Realtime sockets | `socket.io-client` for WhatsApp pairing flows only |
| Document viewers | `@embedpdf/react-pdf-viewer`, `@cyntler/react-doc-viewer`, `@novnc/novnc` |
| Animation / interaction | `motion`, `cmdk`, `react-resizable-panels`, `embla-carousel-react` |
| Testing | Vitest 2 + React Testing Library + `jest-dom` |

**Do not add a new library** without confirming nothing already in `package.json` covers it.

---

## 2. Project Structure

```
src/
├── App.tsx                 # CombinedProvider → RouterProvider + global <Toaster>
├── main.tsx                # i18n init → ReactDOM.createRoot
├── Router.tsx              # createHashRouter, lazy routes, guards
├── index.css               # Tailwind directives + CSS variables
├── components/ui/          # shadcn/ui primitives (Button, Dialog, Form, …)
├── components/ai-elements/ # AI-specific shared widgets
├── components/layouts/     # Page/app shells
├── contexts/               # React Context providers (not Zustand): Theme
├── providers/              # CombinedProvider (composes all app-wide providers)
├── hooks/                  # Cross-cutting hooks (use-mobile, useTheme)
├── config/                 # Static app/menu config + shared runtime rollout feature flags (dataRoomFeatures, governedConversationFeatures)
├── lib/api/                # axios client, config, endpoint registry
├── lib/api-error.ts        # parseApiError / handleApiError
├── lib/use-api-action.ts   # generic async action hook
├── lib/error-codes.ts      # ErrorCode enum (mirror of backend)
├── lib/notifications.ts    # sonner wrapper (showSuccess, showError, …)
├── lib/form-utils.ts       # scrollToFirstError, rhf helpers
├── lib/utils.ts            # cn() class merger
├── modules/                # Feature modules: auth, conversation-v2, playbook, worky, governance, admin, …
├── pages/                  # Top-level route pages not owned by a module
├── test/                   # Vitest global setup + helpers
└── utils/                  # App-wide utilities (prefer lib/)
```

**Path alias:** always import via `@/...` — **never** `../../../`.

```ts
import { apiClient } from '@/lib/api/client';
import { useConversationStore } from '@/modules/conversation';
```

---

## 3. Module Anatomy

```
<module>/
├── index.ts           # Barrel: export public surface only
├── types.ts           # All module types, enums, discriminated unions
├── api.ts             # Thin typed wrappers over apiClient (+ api.test.ts)
├── store.ts           # Zustand store — single file (+ store.test.ts)
├── features.ts        # Feature flags for staged migrations — optional (playbook)
├── uiStore.ts         # UI-only Zustand store — optional when UI state is large
├── hooks/             # Module-specific hooks (match neighbour naming)
├── components/        # PascalCase React components, colocated tests
├── services/          # Long-lived service classes (SSE, buffers) — optional
├── query/             # TanStack Query hooks, client, keys, mutation actions — optional
├── machines/          # XState state machines + react actor hooks — optional
├── stream/            # SSE event types, dispatchers, event mergers — optional
├── locales/           # en.json, fr.json (flat keys, dot-notation)
└── test-utils.ts      # Module test fixtures / factories — optional
```

**Barrel rules:** Export **only** the public surface (pages, store hook, public types). Other modules import from `@/modules/<name>`, never from internals.

Current modules include: `admin`, `agent`, `auth`, `connected-app`, `connector`, `conversation`, `conversation-v2`, `file-viewer`, `governance`, `groups`, `localization`, `models`, `notifications`, `playbook`, `profile`, `project`, `sidebar`, `skill`, `team`, `usage`, `workspace`, `worky`. When adding a new module, follow the closest sibling by domain and keep the barrel export limited to the public surface.

```ts
export { ConversationPage } from './ConversationPage';
export { useConversationStore } from './store';
export type { Conversation, Message } from './types';
```

---

## 4. Routing

`src/Router.tsx` — `createHashRouter`, lazy-load heavy pages (`React.lazy` + `<Suspense>`), guard routes with existing guards (`RootGuard`, `AdminGuard`, `PermissionGuard`). Do **not** roll a new guard — extend an existing one. Hash routing is deliberate (static hosting behind nginx).

---

## 5. State Management

The frontend uses a **layered state architecture**. The legacy/default layer is Zustand; newer code paths add TanStack Query for server-state caching and XState for complex lifecycle orchestration. Modules may use all three during staged migrations, gated behind feature flags.

### Zustand (default for module state)

One `store.ts` per module, always with `devtools({ name: '<module>-store' })`. Keep `initialState` as a `const` for resets and tests. Use `useShallow` when selecting multiple fields:

```ts
const { playbooks, loading } = usePlaybookStore(
  useShallow((s) => ({ playbooks: s.playbooks, loading: s.playbooksLoading })),
);
```

Single `store.ts` per module — do **not** split into slices. Persist only UI prefs (panel state) via direct `localStorage`; do not use Zustand's `persist` middleware. If UI state grows large, extract a second `uiStore.ts` (e.g. `playbook/uiStore.ts`).

### TanStack Query (server-state cache)

`@tanstack/react-query` v5 is used alongside Zustand for **server-state ownership** — reads, cache invalidation, and mutation integration. Used in `playbook`, `worky`, and `governance`; do not introduce another server-state cache.

- Query hooks live in `<module>/query/hooks/`
- Mutation actions live in `<module>/query/mutationActions.ts`
- Query keys in `<module>/query/queryKeys.ts`
- Module-owned query clients/providers are allowed only when an existing module already owns one (`playbook/query/queryProvider.tsx`). Otherwise prefer the nearest existing query provider pattern and do not add a second global client casually.

Zustand stores remain the UI/orchestration layer; they may read from the Query cache with `queryClient.fetchQuery()` when the matching feature flag is enabled. If UI-only state grows large, use a sibling `uiStore.ts` (`playbook`, `worky`, `governance`) rather than mixing panel/dialog state into server-state query hooks.

### XState (lifecycle orchestration)

`xstate` v5 + `@xstate/react` v6 are used for **complex stateful workflows** where Zustand actions become unwieldy — execution lifecycle, autosave coordination, and stream lifecycle. Used in `playbook` and `worky`.

- Machines live in `<module>/machines/<domain>/`
- Actor hooks in `<module>/hooks/` wrap `useSelector` from `@xstate/react`

Gated behind feature flags (e.g. `xstateExecutionEnabled`, `xstateAutosaveEnabled`).

### Feature flags — two layers

The frontend has two distinct feature-flag layers. Do not mix them.

**Shared cross-module rollout flags** live in `src/config/` as frozen objects backed by `import.meta.env.VITE_*`:

- `src/config/dataRoomFeatures.ts` exposes `VITE_DATA_ROOM_*` flags (e.g. `governanceEnabled`, `decisionFlowArtifactsEnabled`).
- `src/config/governedConversationFeatures.ts` exposes governed-conversation rollout flags.

These are consumed across module boundaries (e.g. `workspace` reads Data Room flags, `governance` reads governed-conversation flags). Treat them as cross-module contracts: changing a default or removing a flag requires tracing every consumer. They are **runtime values read at boot**, not compile-time constants — Vite does not tree-shake them away in production builds.

**Module-local state-migration flags** live in `<module>/features.ts` (currently only `playbook`). These gate staged migrations between Zustand and TanStack Query / XState. They are also runtime-env-backed (`VITE_PLAYBOOK_* === 'true'`), despite earlier documentation describing them as compile-time `const` booleans — Vite does not eliminate them.

When adding a flag: shared rollouts go in `src/config/<domain>Features.ts`; state-layer migrations go in `<module>/features.ts`. Declare the `VITE_*` env key in `src/vite-env.d.ts` and document it in the deployment env template.

Example shared rollout pattern from `dataRoomFeatures.ts`:

```ts
export const dataRoomFeatures = Object.freeze({
  governanceEnabled: import.meta.env.VITE_DATA_ROOM_GOVERNANCE_ENABLED === 'true',
});
```

### React Context (cross-cutting only)

Used for: `AuthProvider`, `ThemeProvider`, `SettingsModalProvider`, `UsageProvider`, `NotificationsProvider`, `LocalizationProvider`, and `PlaybookQueryProvider`. Do **not** add new Context unless app-wide and very infrequent updates. Otherwise use Zustand.

Provider order is fixed in `src/providers/CombinedProvider.tsx`: localization outermost, then auth, playbook query, notifications, usage, theme, settings. If adding a provider, place it there with a rationale comment for ordering.

---

## 6. API Layer

**Single axios instance** (`src/lib/api/client.ts`). **Never** create another. `withCredentials: true` (HTTP-only refresh cookie). Request interceptor attaches `Authorization: Bearer <token>`. Response interceptor handles: `503` → maintenance redirect, `401` → silent refresh with subscriber queue (no duplicate refreshes) + retry, then logout on failure. All other errors re-throw as `ApiError`.

**Endpoint registry:** all URLs in `src/lib/api/config.ts` as `API_ENDPOINTS`. **No** hardcoded paths in module code. Parameterised routes are functions: `byId: (id) => \`/playbooks/${id}\``.

**Module `api.ts`:** thin typed wrappers returning `res.data.data` (unwrapping `ApiResponse`). No business logic, no toasts, no retries.

**`useApiAction`** (`src/lib/use-api-action.ts`) is the canonical way to call an API from a component:

```ts
const { execute, isLoading, error } = useApiAction(api.updateProfile, {
  showSuccessToast: true,
  successMessage: t('profile.saved'),
  onSuccess: (updated) => setUser(updated),
});
```

Options: `showErrorToast` (default `true` — set `false` for inline form errors), `showSuccessToast`, `onSuccess`, `onError`, `onReAuthRequired`. Prefer over hand-rolled `try/catch + useState`.

---

## 7. Caching & Data Fetching

The frontend uses a **hybrid approach** during staged migration:

### TanStack Query (newer modules, migrating modules)

Modules using `@tanstack/react-query` v5 declare query hooks, mutation actions, and cache keys under `<module>/query/`. SSE events can update the query cache directly via `queryClient.setQueryData()`.

- Reads: `useQuery` with stale-while-revalidate defaults
- Mutations: `useMutation` with cache invalidation or optimistic updates
- Cache keys use structured factories in `query/queryKeys.ts`
- The `queryClient` instance per module is registered in `CombinedProvider.tsx`

### Zustand stores (legacy / non-migrated modules)

For modules that have not adopted TanStack Query:

- **By-id map:** `conversations: Map<string, Conversation>`
- **By-page map:** `documents: Map<pageNumber, Document[]>`
- **Singletons:** `currentPlaybook: Playbook | null`
- **Loading flags:** boolean per operation (not arrays)

Cache invalidation is **explicit**: after mutation, update the store entry immediately — don't rely on refetching. No TTL-based expiration. For request deduplication, gate with an `inFlight` flag in the store.

### Migration pattern

During migration a module may run **both paths** — Zustand store reads from the Query cache via `queryClient.fetchQuery()` when a feature flag is enabled, with SSE events updating both layers (controlled by `querySseMirrorZustandEnabled`). Avoid mixing Query and Zustand for the same concern unless a feature flag or documented transition explains which layer owns writes.

### Browser storage

`localStorage` for `yellostorm_access_token`, `yellostorm_user`, and UI prefs. `sessionStorage` for maintenance info. Keys always declared as exported constants.

---

## 8. Forms

`react-hook-form` + `zod` + shadcn `<Form>` primitives. Zod schema first, type with `z.infer`. Use `<FormField>` / `<FormMessage>` — don't render errors manually. Use `scrollToFirstError` from `@/lib/form-utils` for long forms on submit failure. Validation messages map to translation keys where user-facing.

**Autosaved editors:** keep editable form data in a single draft object (or a form library state object), not scattered independent `useState` fields. Autosave effects should depend on that single draft object so adding a field cannot be missed in a dependency list. Standalone state is acceptable only for UI-only concerns such as dialog open state, loading flags, selected tabs, or transient search input.

**Delta patch saves (playbook):** when `PLAYBOOK_DELTA_AUTOSAVE_ENABLED` is on, autosave sends `PATCH /playbooks/:id/delta` with only changed fields instead of the full object. Fall back to full save on 4xx/5xx. The autosave XState machine manages the retry/fallback logic.

When adding a new editable field to an autosaved editor, update all layers in one change: frontend type, draft initialization, change handler/draft patch, save payload, backend DTO/schema/serializer when persisted, and tests where the editor has coverage.

---

## 9. UI & Styling

- Use primitives in `src/components/ui/` first. New primitives go there, not into a module.
- Merge classNames with `cn()` from `@/lib/utils` (runs `clsx` then `tailwind-merge`).
- Variants via CVA (`class-variance-authority`), expose `VariantProps<typeof …>` on props.
- `asChild` (Radix Slot) preferred over wrapping.
- Theming: light/dark via class on `<html>`. Color themes: `default | yellowsys | claude | kpmg` in `COLOR_THEMES`. Use Tailwind semantic tokens (`bg-primary`, `text-muted-foreground`), never hardcode brand colors.
- Icons: default to `lucide-react`; brand/custom SVGs in `src/components/icons.tsx` under `<Icons.*>`. `<AppLogo />` is theme-aware.

---

## 10. Internationalisation (i18n)

**No hardcoded user-facing string. Ever.** Every label, placeholder, tooltip, toast, validation message, and aria-label goes through i18n.

```ts
const { t } = useModuleTranslation('playbook');
return <Button>{t('list.createButton')}</Button>;
```

Namespaces: `common`, `errors`, `auth` always loaded; module namespaces lazy-loaded on first use. Keys are **flat with dot-notation** (`"store.errors.notFound"`). Adding strings: add to both `en.json` and `fr.json`. Shared strings from `common`; error codes resolved automatically by `getErrorMessage(code)`.

---

## 11. Notifications (Toasts)

Always go through `@/lib/notifications`: `showSuccess`, `showError`, `showWarning`, `showInfo`, `showLoading`, `showPromise`. **Do not** import `toast` from `sonner` directly. The global `<Toaster />` is in `App.tsx` — don't add another.

---

## 12. Streaming (SSE)

Six streaming patterns coexist depending on module requirements:

### Pattern 1: Singleton EventSource Service (conversation, notifications)

Legacy pattern: `ConversationStreamService` and `NotificationsService`. One `EventSource` per service. Token refresh integration via axios response interceptor calling `reconnectWithNewToken()`. Exponential backoff (base 1s, cap 60s), heartbeat timeout (~30s), eviction handling (`TOO_MANY_TABS`) where applicable.

### Pattern 2: BroadcastChannel Leader-Election (playbook)

`PlaybookStreamService` — one `EventSource` shared across tabs via `BroadcastChannel` with leader election. Leader owns the connection and broadcasts events to followers. Followers sync state via channel messages. Heartbeat, reconnect, and buffered step updates. SSE events dispatched into TanStack Query cache (when `querySseEnabled`) and optionally mirrored to Zustand.

### Pattern 3: Singleton Per-User Multiplexed Stream (conversation-v2)

`ConversationV2StreamService` opens **one** `EventSource` per authenticated user to `/conversation-v2/stream`, kept alive for the whole app session. The connection hook (`useConversationV2StreamConnection`) is mounted **once at the app shell** (`RootGuard`), not per conversation page. The connection is intentionally decoupled from any single conversation view: it stays open across navigation so multiple conversations can stream at the same time and the user can switch between them freely.

Events are tagged with their `sessionId`; the Zustand store renders the current session live and accumulates the rest in a background cache. Session pages hydrate background state and replay paged historical events for gap recovery. Heartbeat, backoff, and reconnect are handled in the service; token refresh reintegrates via the axios interceptor.

- Mount the connection hook exactly once. Never open a second per-session `EventSource` from a page component.
- Preserve the backend `sequence` cursor for gap detection and resume.
- The Zustand store is the event sink; do not mix TanStack Query into this pipe.

### Pattern 4: Fetch + ReadableStream SSE (worky)

`worky/stream/sse.ts` uses `fetch` with a `ReadableStream` reader instead of `EventSource` because the stream needs custom headers and tighter retry control. Keep parsing, reconnect, and abort logic in the module stream helper; components subscribe through module hooks.

### Pattern 5: Socket.IO Pairing Channels

`socket.io-client` is used for WhatsApp QR pairing flows in `agent`, `admin`, and `worky`. Do not use Socket.IO for generic app realtime until an event schema and backend gateway contract are agreed.

### Pattern 6: Socket.IO Browser Session (workspace web import)

`useBrowserSession` opens the `/browser-session` Socket.IO namespace (JWT handshake via the access token) to drive an interactive remote browser for workspace web import / indexing. The server emits JPEG `frame` events plus `navigated` / `blocked` / `closed`; the client emits `start` / `input` / `navigate`. `BrowserSessionViewer` draws frames 1:1 to a canvas and maps local input back to the remote viewport; `AddLinkDialog` collects visited URLs, asks the backend which are already indexed, and submits selected links with auto/deep-index settings.

**Hard coordinate contract:** the client uses fixed `VIEWPORT_W = 1280` / `VIEWPORT_H = 720` (16:9) to match the backend Playwright viewport so input coordinates map correctly. Change both sides together — see backend §15.

Ack messages use raw strings (`BUSY`, `BAD_REQUEST`, `NO_SESSION`), not the global error envelope; handle them in the hook, do not try to route them through `handleApiError`.

### Rules (all patterns)

- Never open ad-hoc `new EventSource` in a component (use the module's service/hook)
- Never hand-roll SSE parsing in a component; use the module stream helper (`conversation-v2/useStream`, `worky/stream/sse.ts`, or service singleton)
- Never open ad-hoc `io()` Socket.IO connections in a component; use the module's hook (`useBrowserSession`, WhatsApp pairing hooks)
- Token refresh integration mandatory where applicable
- Always clean up on unmount / disconnect
- Cap per-user connections (backend enforces, frontend handles eviction with `TOO_MANY_TABS`)
- For ordered streams, preserve and store the backend `sequence` cursor so clients can resume without duplicate events.
- For the browser-session Socket.IO namespace, keep the client viewport constants in sync with the backend (see Pattern 6).

---

## 13. Error Handling

All API errors surface as `ApiError`: `{ code, message, statusCode, details?[] }`. Mirror backend in `src/lib/error-codes.ts`; add translations in `locales/.../errors.json`. Surfacing: toast (default, via `useApiAction` or `handleApiError`), or inline (`showErrorToast: false` + render in `<Alert>` / `<FormMessage>`). **Never** `console.error` user-actionable errors silently. Use `getErrorMessage(code)` so codes resolve to localised strings.

**Error-code parity is mandatory and currently drifted.** The frontend `ErrorCode` enum in `src/lib/error-codes.ts` must mirror the backend enum in `back/src/modules/exceptions/constants/error-codes.ts`. Unknown backend codes are silently normalised to `ERR_1000` (`error-codes.ts`), so any unmapped code loses its specific message in the UI. When the backend adds a code, the same change must: (a) add it to `front/src/lib/error-codes.ts`, (b) add EN + FR messages to `front/src/modules/localization/locales/{en,fr}/errors.json`, (c) verify the code renders the expected message via `getErrorMessage(code)`. Known current drift includes `ERR_1009` (idempotency), extended chat codes (`ERR_1403`–`ERR_1420`), indexing/share codes (`ERR_1950`–`ERR_1960`), and `WIDGET_CITATION_NOT_FOUND` (`ERR_3409`) — fix when touching the relevant area.

---

## 14. Testing

Vitest + React Testing Library + `jest-dom`. Colocate tests: `X.test.tsx` next to `X.tsx`. Global setup in `src/test/setup.ts` (mocks for react-router-dom, matchMedia, ResizeObserver, localStorage, i18n).

**Conventions:**
- Mock axios with hoisted factories: `vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), … }))` then `vi.mock('@/lib/api/client', …)`.
- `beforeEach(() => vi.clearAllMocks())`. Prefer `mockResolvedValueOnce`.
- Query priority: `getByRole` > `getByLabelText` > `getByText` > `getByTestId` (last resort).
- Store tests: reset with `setState(initialState, true)`.
- Fixtures in `<module>/test-utils.ts`.

**Coverage:** API layer (every function), stores (actions + error paths + computed flags), components (primary user flow).

---

## 15. TypeScript Conventions

- `strict: true`. **Never** `any` — use `unknown` + narrowing.
- `import type` for type-only imports.
- Discriminated unions for event streams, action payloads, node types.
- Prefer `as const` objects over `enum`, **except** for error codes (parity with backend).
- `Readonly<Props>` for provider/component props that must not be mutated.
- No default exports for components — named exports keep lazy-load shims explicit.

---

## 16. File Naming

| Kind | Style | Example |
|------|-------|---------|
| React components | PascalCase | `PlaybookListPage.tsx` |
| Hooks | `use-<name>.ts` or `useXxx.ts` — match neighbours | `use-mobile.ts`, `useApiAction.ts` |
| Utilities / services | kebab-case | `form-utils.ts`, `api-error.ts` |
| Types | `types.ts` | `src/modules/playbook/types.ts` |
| Locale files | `{en,fr}.json` | `src/modules/admin/locales/en.json` |
| Tests | `.test.ts(x)` colocated | `store.test.ts` |
| Barrel | `index.ts` | `src/modules/auth/index.ts` |

---

## 17. Environment & Configuration

Read env via `import.meta.env.VITE_*` only. Production uses **runtime injection**: literal placeholder `'MY_APP_VITE_API_URL'` in the build, replaced by `env.sh` at container start. New runtime-configurable values follow the same pattern. Never commit secrets — frontend has none.

Every `VITE_*` key read in code must be declared in `src/vite-env.d.ts` and listed in the deployment env template. The current declarations only cover Playbook flags; Data Room (`VITE_DATA_ROOM_*`) and governed-conversation (`VITE_GOVERNED_CONVERSATION_*`) flags are read from `src/config/*Features.ts` but not yet declared — fix this when touching those files, do not replicate the drift.

---

## 18. Performance

Lazy-load route pages. `useShallow` for multi-field Zustand selectors. Memoise expensive child props with `useMemo`; use `memo` only when a profiler shows hot re-renders. Virtualise long lists with `virtua`. Debounce/throttle high-frequency updates (SSE chunks, resize, search). Avoid large Markdown/code in the critical path.

---

## 19. Integrations

| Library | Use for |
|---------|---------|
| `@xyflow/react` | Playbook canvas (nodes/edges) |
| `@dagrejs/dagre` | Graph layout for playbook canvas |
| `@tanstack/react-table` | Admin tables |
| `@tanstack/react-query` | Server-state cache and data fetching |
| `xstate` + `@xstate/react` | Complex stateful workflows (execution, autosave) |
| `recharts` | Analytics/usage charts |
| `virtua` | Long virtualised lists |
| `ai` (Vercel AI SDK) + `@anthropic-ai/sdk` | LLM streaming UIs |
| `streamdown`, `shiki`, `react-markdown` | Streaming/static markdown |
| `motion` | Animation — use instead of `framer-motion` |
| `@embedpdf/react-pdf-viewer`, `@cyntler/react-doc-viewer` | PDF/document viewers |
| `@novnc/novnc` (`RFB`) | Live remote-browser viewer over a signed VNC URL (conversation-v2 `BrowserToolView`, `useVncSession`) — **not** a document viewer. `viewOnly` toggles takeover; `VM_UNAVAILABLE` falls back to a screenshot. Treat as a realtime session, not a static embed. |
| `socket.io-client` | WhatsApp QR pairing channels **and** the `/browser-session` interactive web-import namespace (Pattern 6) |
| `cmdk` | Command menu primitives |
| `react-resizable-panels` | Split pane layouts |
| `d3` | Custom visualisation where `recharts` is insufficient |
| `exceljs` | Spreadsheet export |
| `date-fns` | Date formatting — **never** moment/luxon |

---

## 20. Module-Specific Patterns

These patterns capture how specific modules extend or deviate from the base rules. Mirror the closest sibling when adding similar behavior.

### 20.1 Governance (Query-first, no SSE)

`governance` is TanStack Query-first with a separate UI-only Zustand store:

- Query hooks live in a single `query/hooks.ts` file (not the `query/hooks/` directory), using `useQuery`, `useQueries`, mutations, structured query keys, and cache invalidation. Active reconciliation runs are polled at 1s — there is **no** governance SSE today.
- UI selection state lives in `uiStore.ts` (devtools-enabled), separate from server state.
- **Established exception to the barrel rule (§3):** `governance/index.ts` re-exports the API surface, every query hook, and all types (`export *`). When adding to governance, follow this expanded surface; do not retrofit the limited-surface rule without a planned refactor.
- The legacy `conversation` module imports governance internals directly for its banner and carousel (`ConversationPage.tsx`, `NewConversationPage.tsx`). This cross-module internal import is a documented exception for governed-conversation integration — do not replicate the pattern for new integrations; expose a public surface on the consumer module instead.

### 20.2 conversation-v2 UI patterns

- Event types beyond messages include `step`, `tool`, `plan`, and `application_component` — discriminated unions in `conversationV2Stream.ts`.
- `StepBlock` renders collapsible execution steps with their tool calls; `ToolCallCard` opens a mutually-exclusive right-panel detail view (only one tool detail visible at a time).
- The current "thinking" UI is `ThinkingIndicator` (three-dot animation). `PulseProgress` is not the canonical CoT component.
- Read-only shared conversations use a token route (`SharedConversationV2Page`) that fetches a snapshot and renders a `MessageList`. Deployed-app sharing UI exists (`ShareDeployDialog`, `DeployControls`) but is currently commented out in `RightPanel` — do not assume it is live.

### 20.3 Widget embedding (administered from `agent`)

There is no separate React widget app on the frontend. The widget is **generated vanilla-JS output** administered from the agent module:

- `AgentDeploymentSection` issues a one-time widget token then calls `buildWidgetCdnSnippet()` to produce a `<script>` snippet. The CDN host is the current origin or `VITE_APP_URL`.
- `agent/constants/widget-template.ts` is a standalone DOM/CSS/JS runtime that builds its own launcher/dialog markup. It uses the runtime placeholder `MY_APP_VITE_API_URL` (same pattern as the rest of the frontend).
- When extending the widget runtime, remember it is **not** React: no hooks, no JSX, no module bundler assumptions beyond what the template emits. Test the generated snippet in isolation.

### 20.4 Browser session viewer (workspace web import)

`useBrowserSession` (Pattern 6) drives an interactive remote browser. `BrowserSessionViewer` paints JPEG frames to a canvas at 1:1 scale and maps local pointer/keyboard events back to the remote viewport. `AddLinkDialog` collects visited URLs, asks the backend which are already indexed, and submits selected links with auto/deep-index settings. The link API wrappers live under `workspace/api.ts` (`addLink`, `addLinks`, `checkUrls`). Do not introduce a second browser-session consumer — extend the workspace hook.

---

## 21. Pre-PR Checklist

- [ ] Module anatomy followed (§3). Public surface exported via barrel only.
- [ ] All user-facing strings in both `en.json` and `fr.json`, accessed via `useModuleTranslation`.
- [ ] No hardcoded API paths — everything through `API_ENDPOINTS`.
- [ ] API calls in components via `useApiAction` (or justified exception).
- [ ] Zustand store: `devtools({ name: '…' })`, `initialState` exported.
- [ ] If using TanStack Query: hooks in `query/hooks/`, mutation actions in `query/mutationActions.ts`, keys in `query/queryKeys.ts`.
- [ ] If adding or changing streaming: use an existing module pattern (singleton, BroadcastChannel, per-session hook, fetch stream helper, or Socket.IO pairing) and preserve sequence/resume semantics where present.
- [ ] If using XState: machines in `machines/<domain>/`, feature-flag gated alongside legacy path.
- [ ] If adding a state migration path (Zustand → Query/XState): gate behind a feature flag in `features.ts`.
- [ ] No new axios instance, no direct `toast` import, no `new EventSource` in components.
- [ ] `cn()` for className merging; variants via CVA.
- [ ] Errors surfaced (toast or inline); error codes from `ErrorCode` enum.
- [ ] Autosaved editors store editable data in one draft/form state object; no editable field is saved only through an ad-hoc dependency list.
- [ ] Backend error codes mirrored in `src/lib/error-codes.ts` and EN + FR `errors.json` (see §13 parity rule).
- [ ] Every `VITE_*` env key read in code is declared in `src/vite-env.d.ts` and listed in the deployment env template.
- [ ] Shared rollout flags live in `src/config/*Features.ts`; module state-migration flags live in `<module>/features.ts` — not mixed.
- [ ] If touching streaming: conversation-v2 connection hook mounted exactly once at the app shell; browser-session viewport constants match backend (Pattern 6).
- [ ] If touching the widget template (`agent/constants/widget-template.ts`): changes must work as standalone vanilla JS, no React/JSX.
- [ ] Tests colocated, `vi.mock` for axios client. `npm test` + `npm run build` pass.
- [ ] Commit: `<type>(<scope>): <subject>` (conventional commit).

---

## 22. Anti-Patterns

- Creating a second axios instance or calling `fetch` directly for backend calls.
- Importing `toast` from `sonner` instead of `@/lib/notifications`.
- Hardcoded strings in JSX (`<Button>Save</Button>`).
- Relative imports climbing `../../../`.
- Cross-module imports reaching into internals (`@/modules/playbook/components/Foo/Bar`).
- New React Context for per-feature state (use Zustand).
- Global singletons for service state other than the documented SSE services.
- Autosaved forms split across independent editable `useState` fields that require manually maintained save-effect dependency lists.
- `console.log` left in production code.
- Silent error swallowing (`catch {}`).
- Adding a dependency that overlaps with an existing one (moment vs date-fns, etc.).
- Disabling `strict` rules or `// @ts-ignore` without a linked issue.
- Mixing Zustand, TanStack Query, and XState for the same concern **without** a feature flag gating the migration.
- Ad-hoc `new EventSource()` in a component instead of using the module's service/hook.
- Ad-hoc `fetch` stream readers in components instead of using a module stream helper.
- Adding a new state management library or pattern without first checking whether an existing pattern (Zustand, Query, XState) fits.
- Treating `src/lib/error-codes.ts` as loosely aligned with backend instead of a strict mirror; or adding a backend code without updating EN + FR `errors.json` in the same change.
- Reading a `VITE_*` env key in code without declaring it in `src/vite-env.d.ts`.
- Mixing the two feature-flag layers: shared rollout flags must live in `src/config/*Features.ts`, module state-migration flags must live in `<module>/features.ts`.
- Mounting the conversation-v2 stream connection hook anywhere other than the app shell, or opening a second per-session `EventSource` for v2.
- Changing the browser-session client viewport constants without updating the backend Playwright viewport in the same change.
- Assuming `PulseProgress` is the canonical CoT indicator — it is `ThinkingIndicator`.
- Assuming deployed-app sharing UI is live — it is currently commented out in `conversation-v2/RightPanel`.
- Treating the generated widget template as React; importing JSX/hooks into `agent/constants/widget-template.ts`.
- Importing `@novnc/novnc` (`RFB`) as a static document viewer; it is a signed live-remote-browser session.
