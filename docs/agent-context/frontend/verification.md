# Frontend verification and review

Read only the sections relevant to the task. Paths such as `src/` are relative to `YellowStorm/front/`; verify descriptive module examples and recorded debt against current source. Essential edit rules are in [frontend AGENTS.md](../../../YellowStorm/front/AGENTS.md).

## Testing

Vitest + React Testing Library + `jest-dom`. Colocate tests: `X.test.tsx` next to `X.tsx`. Global setup in `src/test/setup.ts` (mocks for react-router-dom, matchMedia, ResizeObserver, localStorage, i18n).

**Conventions:**
- Mock axios with hoisted factories: `vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), … }))` then `vi.mock('@/lib/api/client', …)`.
- `beforeEach(() => vi.clearAllMocks())`. Prefer `mockResolvedValueOnce`.
- Query priority: `getByRole` > `getByLabelText` > `getByText` > `getByTestId` (last resort).
- Store tests: reset with `setState(initialState, true)`.
- Fixtures in `<module>/test-utils.ts`.

**Coverage:** API layer (every function), stores (actions + error paths + computed flags), components (primary user flow).

## Pre-PR Checklist

- [ ] Module anatomy followed ([Module anatomy](architecture.md#module-anatomy)). Cross-module imports use public barrels; any direct router import is a route-only lazy-loading boundary.
- [ ] All user-facing strings in both `en.json` and `fr.json`, accessed via `useModuleTranslation`.
- [ ] No hardcoded YellowStorm REST paths — use `API_ENDPOINTS`; non-REST protocol URLs follow the documented [API layer](api-and-errors.md#api-layer) exceptions.
- [ ] API calls in components via `useApiAction` (or justified exception).
- [ ] New or materially modified Zustand store: `devtools({ name: '…' })`, `initialState` exported.
- [ ] If using TanStack Query: hooks in `query/hooks/`, mutation actions in `query/mutationActions.ts`, keys in `query/queryKeys.ts`, except documented module-specific conventions (for example governance).
- [ ] If adding or changing streaming/realtime behavior: use an existing module pattern (singleton, BroadcastChannel, per-session hook, fetch stream helper, or sanctioned Socket.IO channel) and preserve sequence/resume semantics where present.
- [ ] If using XState: machines in `machines/<domain>/`, feature-flag gated alongside legacy path.
- [ ] If adding a state migration path (Zustand → Query/XState): gate behind a feature flag in `features.ts`.
- [ ] No new axios instance, no direct `toast` import, no `new EventSource` in components; any direct `fetch` matches a documented protocol exception in [API layer](api-and-errors.md#api-layer).
- [ ] `cn()` for className merging; variants via CVA.
- [ ] Errors surfaced (toast or inline); error codes from `ErrorCode` enum.
- [ ] Autosaved editors store editable data in one draft/form state object; no editable field is saved only through an ad-hoc dependency list.
- [ ] Backend error codes mirrored in `src/lib/error-codes.ts` and EN + FR `errors.json` (see [Error handling](api-and-errors.md#error-handling) parity rule).
- [ ] Every `VITE_*` env key read in code is declared in `src/vite-env.d.ts`, supplied at build time, and listed in the deployment/build env template; container runtime uses the same `VITE_*` names via `/config.js`.
- [ ] Shared rollout flags live in `src/config/*Features.ts`; module state-migration flags live in `<module>/features.ts` — not mixed.
- [ ] If touching streaming/realtime behavior: conversation-v2 connection hook mounted exactly once at the app shell; browser-session viewport constants match backend (Pattern 6); app-runtime ticket and registration semantics remain aligned (Pattern 7).
- [ ] If touching the widget template (`agent/constants/widget-template.ts`): changes must work as standalone vanilla JS, no React/JSX.
- [ ] Tests colocated, `vi.mock` for axios client. `npm test` + `npm run build` pass.
- [ ] Commit: `<type>(<scope>): <subject>` (conventional commit).

## Anti-Patterns

- Creating a second axios instance or calling `fetch` directly for ordinary YellowStorm REST calls outside the documented [API layer](api-and-errors.md#api-layer) exceptions.
- Importing `toast` from `sonner` instead of `@/lib/notifications`.
- Hardcoded strings in JSX (`<Button>Save</Button>`).
- Relative imports climbing out of the owning module to reach another module or root-shared code.
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
