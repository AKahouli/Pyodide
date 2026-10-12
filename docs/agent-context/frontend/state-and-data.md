# State, caching and configuration

Read only the sections relevant to the task. Paths such as `src/` are relative to `YellowStorm/front/`; verify descriptive module examples and recorded debt against current source. Essential edit rules are in [frontend AGENTS.md](../../../YellowStorm/front/AGENTS.md).

## State Management

The frontend uses a **layered state architecture**. The legacy/default layer is Zustand; newer code paths add TanStack Query for server-state caching and XState for complex lifecycle orchestration. Modules may use all three during staged migrations, gated behind feature flags.

### Zustand (default for module state)

New or materially modified Zustand stores use `devtools({ name: '<module>-store' })` and keep an exported `initialState` constant for resets and tests. Existing stores that predate this convention are migration debt, not examples to copy. Use `useShallow` when selecting multiple fields:

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

The frontend has two distinct feature-flag layers. Do not mix them. Both layers currently use Vite build-time environment substitution unless a runtime `/config.js` entry is added for container-only settings.

**Shared cross-module rollout flags** live in `src/config/` as frozen objects backed by `import.meta.env.VITE_*`:

- `src/config/dataRoomFeatures.ts` exposes `VITE_DATA_ROOM_*` flags (e.g. `governanceEnabled`, `decisionFlowArtifactsEnabled`).
- `src/config/governedConversationFeatures.ts` exposes governed-conversation rollout flags.

These are consumed across module boundaries (e.g. `workspace` reads Data Room flags, `governance` reads governed-conversation flags). Treat them as cross-module contracts: changing a default or removing a flag requires tracing every consumer. Vite replaces `import.meta.env.VITE_*` expressions during the production build; these values cannot be changed when the built container starts.

**Module-local state-migration flags** live in `<module>/features.ts` (currently `playbook`, with a separate app-runtime rollout switch under `conversation-v2`). These gate staged migrations between Zustand and TanStack Query / XState. They are also build-time `VITE_*` values.

When adding a flag: shared rollouts go in `src/config/<domain>Features.ts`; state-layer migrations go in `<module>/features.ts`. Declare the `VITE_*` env key in `src/vite-env.d.ts`, document how the build receives it, and list it in the deployment env template. For runtime-only public settings (API URL), use `VITE_*` on the container and `env.sh` → `/config.js`.

Example shared rollout pattern from `dataRoomFeatures.ts`:

```ts
export const dataRoomFeatures = Object.freeze({
  governanceEnabled: import.meta.env.VITE_DATA_ROOM_GOVERNANCE_ENABLED === 'true',
});
```

### React Context (cross-cutting only)

Used for: `AuthProvider`, `ThemeProvider`, `SettingsModalProvider`, `UsageProvider`, `NotificationsProvider`, `LocalizationProvider`, and `PlaybookQueryProvider`. Do **not** add new Context unless app-wide and very infrequent updates. Otherwise use Zustand.

Provider order is fixed in `src/providers/CombinedProvider.tsx`: localization outermost, then auth, playbook query, notifications, usage, theme, settings. If adding a provider, place it there with a rationale comment for ordering.

## Caching & Data Fetching

The frontend uses a **hybrid approach** during staged migration:

### TanStack Query (newer modules, migrating modules)

Modules using `@tanstack/react-query` v5 declare query hooks, mutation actions, and cache keys under `<module>/query/`. SSE events can update the query cache directly via `queryClient.setQueryData()`.

- Reads: `useQuery` with stale-while-revalidate defaults
- Mutations: `useMutation` with cache invalidation or optimistic updates
- Cache keys use structured factories in `query/queryKeys.ts`
- Register required query providers through the existing `CombinedProvider.tsx` composition; follow the ownership limits in State Management rather than adding a client per new module.

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

`localStorage` for `yellostorm_user` (display cache) and UI prefs — never credentials: the access token lives in memory
(`lib/api/access-token-store.ts`) and session continuity comes from the HttpOnly refresh cookie (`restoreSessionFromCookie()`).
`sessionStorage` for maintenance info and the refresh attempt id. Keys always declared as exported constants.

## Environment & Configuration

Frontend configuration has two distinct delivery mechanisms:

| Kind | Mechanism | Change time |
|------|-----------|-------------|
| Local and build-time flags | `import.meta.env.VITE_*` | Vite build |
| Production API/socket URLs | Container `VITE_API_URL` / `VITE_SOCKET_BASE_URL` → `/config.js` via `env.sh` | Container startup |

Vite substitutes `import.meta.env.VITE_*` while building. The production Dockerfile does not copy the repository `.env`; supply values via build args and/or container env. At start, `env.sh` writes `window.__APP_CONFIG__` in `/config.js` from `VITE_API_URL` (runtime overrides build-time when both are set). Never put secrets in either mechanism — frontend configuration is public to the browser.

Every `VITE_*` key read in code must be declared in `src/vite-env.d.ts` and listed in the deployment/build env template. Current debt extends beyond Data Room and governed-conversation flags: API/socket/app URLs, Worky MCP, Conversation V2 app runtime, and several Playbook migration flags are also undeclared or undocumented. Fix this when touching those areas; do not replicate the drift.
