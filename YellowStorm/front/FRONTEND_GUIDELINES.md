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
| Data Fetching | `@tanstack/react-query` v5 (alongside Zustand during staged migration) |
| Workflow / State Machines | `xstate` v5 + `@xstate/react` v6 (execution lifecycle, autosave) |
| HTTP | Axios (single shared instance with interceptors) |
| Forms | `react-hook-form` + `zod` + `@hookform/resolvers` |
| UI primitives | Radix UI + shadcn/ui wrappers under `src/components/ui/` |
| Styling | Tailwind CSS v4 + `class-variance-authority` + `clsx` + `tailwind-merge` |
| Icons | `lucide-react` + custom `Icons` map in `src/components/icons.tsx` |
| i18n | `i18next` + `react-i18next` (lazy namespace loading) |
| Toasts | `sonner` via `@/lib/notifications` wrapper |
| Streaming | Native `EventSource` SSE — singleton services, BroadcastChannel leader-election, per-session hooks |
| Charts / tables / graphs / flow | `recharts`, `@tanstack/react-table`, `@xyflow/react`, `@dagrejs/dagre` |
| Virtualization | `virtua` |
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
├── lib/api/                # axios client, config, endpoint registry
├── lib/api-error.ts        # parseApiError / handleApiError
├── lib/use-api-action.ts   # generic async action hook
├── lib/error-codes.ts      # ErrorCode enum (mirror of backend)
├── lib/notifications.ts    # sonner wrapper (showSuccess, showError, …)
├── lib/form-utils.ts       # scrollToFirstError, rhf helpers
├── lib/utils.ts            # cn() class merger
├── modules/                # Feature modules: auth, conversation, playbook, workspace, admin, …
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

`@tanstack/react-query` v5 is used alongside Zustand for **server-state ownership** — reads, cache invalidation, and mutation integration. Used in modules undergoing staged migration (playbook).

- Query hooks live in `<module>/query/hooks/`
- Mutation actions live in `<module>/query/mutationActions.ts`
- Query keys in `<module>/query/queryKeys.ts`
- The module provides a `QueryClientProvider` via `CombinedProvider.tsx`

Zustand stores remain the UI/orchestration layer; they may read from the Query cache with `queryClient.fetchQuery()` when the matching feature flag is enabled.

### XState (lifecycle orchestration)

`xstate` v5 + `@xstate/react` v6 are used for **complex stateful workflows** where Zustand actions become unwieldy — execution lifecycle, autosave coordination. Used in playbook.

- Machines live in `<module>/machines/<domain>/`
- Actor hooks in `<module>/hooks/` wrap `useSelector` from `@xstate/react`

Gated behind feature flags (e.g. `xstateExecutionEnabled`, `xstateAutosaveEnabled`).

### Feature flags for staged migration

When migrating a module's state layer, gate old and new paths with feature flags in `<module>/features.ts`. Flags are `const` booleans (compile-time eliminated by Vite tree-shaking in production). Example flags pattern from playbook:

```ts
export const queryEnabled = true;
export const queryMutationsEnabled = true;
export const querySseEnabled = true;
export const xstateExecutionEnabled = false; // still rolling out
```

### React Context (cross-cutting only)

Used for: `AuthContext`, `ThemeContext`, `SettingsModalProvider`, `UsageProvider`, `NotificationsProvider`, `LocalizationProvider`. Do **not** add new Context unless app-wide and very infrequent updates. Otherwise use Zustand.

Provider order is fixed in `src/providers/CombinedProvider.tsx`. If adding a provider, place it there with a rationale comment for ordering.

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

During migration a module may run **both paths** — Zustand store reads from the Query cache via `queryClient.fetchQuery()` when a feature flag is enabled, with SSE events updating both layers (controlled by `querySseMirrorZustandEnabled`).

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

Three SSE patterns coexist depending on module requirements:

### Pattern 1: Singleton Service (conversation, notifications)

Legacy pattern: `ConversationStreamService` and `NotificationsService`. One `EventSource` per service. Token refresh integration via axios response interceptor calling `reconnectWithNewToken()`. Exponential backoff (base 1s, cap 60s), heartbeat timeout (~30s), eviction handling (`TOO_MANY_TABS`).

### Pattern 2: BroadcastChannel Leader-Election (playbook)

`PlaybookStreamService` — one `EventSource` shared across tabs via `BroadcastChannel` with leader election. Leader owns the connection and broadcasts events to followers. Followers sync state via channel messages. Heartbeat, reconnect, and buffered step updates. SSE events dispatched into TanStack Query cache (when `querySseEnabled`) and optionally mirrored to Zustand.

### Pattern 3: Per-Session Hook (conversation-v2)

`useStream()` hook — one `EventSource` per active session, scoped to component lifecycle. Closes on `done`/`error`. Supports gap recovery by paging historical events. Zustand store is the state sink; no TanStack Query involvement.

### Rules (all patterns)

- Never open ad-hoc `new EventSource` in a component (use the module's service/hook)
- Token refresh integration mandatory where applicable
- Always clean up on unmount / disconnect
- Cap per-user connections (backend enforces, frontend handles eviction with `TOO_MANY_TABS`)

---

## 13. Error Handling

All API errors surface as `ApiError`: `{ code, message, statusCode, details?[] }`. Mirror backend in `src/lib/error-codes.ts`; add translations in `locales/.../errors.json`. Surfacing: toast (default, via `useApiAction` or `handleApiError`), or inline (`showErrorToast: false` + render in `<Alert>` / `<FormMessage>`). **Never** `console.error` user-actionable errors silently. Use `getErrorMessage(code)` so codes resolve to localised strings.

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
| `exceljs` | Spreadsheet export |
| `date-fns` | Date formatting — **never** moment/luxon |

---

## 20. Pre-PR Checklist

- [ ] Module anatomy followed (§3). Public surface exported via barrel only.
- [ ] All user-facing strings in both `en.json` and `fr.json`, accessed via `useModuleTranslation`.
- [ ] No hardcoded API paths — everything through `API_ENDPOINTS`.
- [ ] API calls in components via `useApiAction` (or justified exception).
- [ ] Zustand store: `devtools({ name: '…' })`, `initialState` exported.
- [ ] If using TanStack Query: hooks in `query/hooks/`, mutation actions in `query/mutationActions.ts`, keys in `query/queryKeys.ts`.
- [ ] If using XState: machines in `machines/<domain>/`, feature-flag gated alongside legacy path.
- [ ] If adding a state migration path (Zustand → Query/XState): gate behind a feature flag in `features.ts`.
- [ ] No new axios instance, no direct `toast` import, no `new EventSource` in components.
- [ ] `cn()` for className merging; variants via CVA.
- [ ] Errors surfaced (toast or inline); error codes from `ErrorCode` enum.
- [ ] Autosaved editors store editable data in one draft/form state object; no editable field is saved only through an ad-hoc dependency list.
- [ ] Tests colocated, `vi.mock` for axios client. `npm test` + `npm run build` pass.
- [ ] Commit: `<type>(<scope>): <subject>` (conventional commit).

---

## 21. Anti-Patterns

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
- Adding a new state management library or pattern without first checking whether an existing pattern (Zustand, Query, XState) fits.
