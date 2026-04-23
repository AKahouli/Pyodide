# YellowStorm Frontend — Coding Guidelines

> Audience: frontend developers (human or agent) contributing to `YellowStorm/front`.
> Goal: produce code that is **compliant** with existing patterns, **maintainable**, and **coherent** across modules.
>
> **Golden rule:** before introducing a new pattern, look at an existing sibling module (`playbook`, `conversation`, `workspace`, `admin`). If a pattern already exists, follow it — do not invent a new one.

---

## 1. Stack

| Layer | Tech |
|-------|------|
| Framework | React 18 + TypeScript (strict) |
| Bundler | Vite 6 |
| Routing | `react-router-dom` v6 (hash router) |
| State | Zustand 5 (with `devtools` middleware) + React Context for auth/theme/settings |
| HTTP | Axios (single shared instance with interceptors) |
| Forms | `react-hook-form` + `zod` + `@hookform/resolvers` |
| UI primitives | Radix UI (40+ primitives) |
| UI components | shadcn/ui wrappers under `src/components/ui/` |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`) + `class-variance-authority` + `clsx` + `tailwind-merge` |
| Icons | `lucide-react` + custom `Icons` map in `src/components/icons.tsx` |
| i18n | `i18next` + `react-i18next` (lazy namespace loading) |
| Toasts | `sonner` via `src/lib/notifications.ts` wrapper |
| Streaming | Native `EventSource` SSE, wrapped in singleton services |
| Charts / tables / graphs | `recharts`, `@tanstack/react-table`, `@xyflow/react` |
| Virtualization | `virtua` |
| Testing | Vitest 2 + React Testing Library + `jest-dom` |

**Do not add a new library** without confirming nothing already in `package.json` solves the problem. Check first: there is almost always an existing primitive (`Dialog`, `Form`, `Button`, `Select`, etc.) that covers the need.

---

## 2. Project Structure

```
src/
├── App.tsx                 # CombinedProvider → RouterProvider + global <Toaster>
├── main.tsx                # i18n init → ReactDOM.createRoot
├── Router.tsx              # createHashRouter, lazy routes, guards
├── index.css               # Tailwind directives + CSS variables
├── components/
│   ├── ui/                 # shadcn/ui primitives (Button, Dialog, Form, ...)
│   ├── ai-elements/        # AI-specific shared widgets
│   ├── layouts/            # Page/app shells
│   └── icons.tsx           # Custom SVG icon map + AppLogo
├── contexts/               # React Context providers that are NOT Zustand (Theme)
├── providers/              # CombinedProvider (composes all app-wide providers)
├── hooks/                  # Cross-cutting hooks (use-mobile, useTheme)
├── lib/
│   ├── api/                # axios client, config, endpoint registry
│   ├── api-error.ts        # parseApiError / handleApiError
│   ├── use-api-action.ts   # generic async action hook
│   ├── error-codes.ts      # ErrorCode enum (mirror of backend codes)
│   ├── notifications.ts    # sonner wrapper (showSuccess, showError, ...)
│   ├── form-utils.ts       # scrollToFirstError, rhf helpers
│   ├── download.ts         # blob / url download helpers
│   └── utils.ts            # cn() class merger
├── modules/
│   ├── auth/               # AuthContext, login/register, session
│   ├── conversation/       # Chat, SSE stream service, messages
│   ├── playbook/           # Playbook canvas, executions, triggers
│   ├── workspace/          # Workspaces, documents
│   ├── admin/              # Admin pages (users, roles, logs, models...)
│   ├── profile/            # User profile + SettingsModal context
│   ├── notifications/      # System SSE notifications
│   ├── localization/       # i18n init, namespace loaders, hooks
│   ├── connected-app/      # OAuth connectors
│   ├── sidebar/            # App sidebar
│   ├── models/             # Model catalog
│   ├── usage/              # Usage quotas
│   ├── file-viewer/        # PDF / doc viewer
│   └── agent/              # Agent metadata
├── pages/                  # Top-level route pages that are not module-owned
├── test/                   # Vitest global setup + helpers
└── utils/                  # App-wide utilities (kept small; prefer lib/)
```

### Path alias

Always import via `@/...` (configured in `tsconfig.json` and `vite.config.ts`):

```ts
import { apiClient } from '@/lib/api/client';
import { useConversationStore } from '@/modules/conversation';
```

**Never** use relative paths that climb two or more levels (`../../../`).

---

## 3. Module Anatomy

Every feature module under `src/modules/<name>/` follows the same skeleton. When creating a new module, copy this layout.

```
<module>/
├── index.ts           # Barrel: export public surface only
├── types.ts           # All module types, enums, discriminated unions
├── api.ts             # API functions (thin wrappers over apiClient)
├── api.test.ts        # Vitest tests for api.ts
├── store.ts           # Zustand store (single file — see §5)
├── store.test.ts
├── hooks/             # Module-specific hooks (useXxx.ts or use-xxx.ts — match neighbours)
├── components/        # PascalCase React components, colocated tests
├── services/          # Long-lived service classes (SSE, buffers) — optional
├── effects/           # Extracted effect logic — optional
├── constants/         # Static maps/lists — optional
├── utils/             # Pure helpers — optional
├── locales/           # en.json, fr.json (flat keys, dot-notation)
├── test-utils.ts      # Module test fixtures / factories — optional
└── README.md          # What the module does + notable decisions
```

### Barrel (`index.ts`) rules

- Export **only** the public surface: page components, the store hook, public types.
- Do **not** re-export internal utils, sub-components, or services that outside callers shouldn't touch.
- Other modules import from `@/modules/<name>`, **never** from `@/modules/<name>/components/XyzPanel`.

```ts
// src/modules/conversation/index.ts
export { ConversationPage } from './ConversationPage';
export { useConversationStore } from './store';
export type { Conversation, Message } from './types';
```

---

## 4. Routing

Defined in `src/Router.tsx` with `createHashRouter`.

- **Lazy-load heavy pages** with `React.lazy` + `<Suspense fallback={null}>`. Inline `default` shim when the component is a named export:

```tsx
const PlaybookListPage = React.lazy(() =>
  import('./modules/playbook/components/PlaybookListPage')
    .then((m) => ({ default: m.PlaybookListPage }))
);
```

- **Guard routes** with the existing guards: `<RootGuard />` (auth), `<AdminGuard />` (admin role), `<PermissionGuard permissions={[...]}>` (fine-grained). Do **not** roll a new guard — extend an existing one if needed.
- Hash routing is deliberate (static hosting behind nginx). New routes must also be hash-addressable.

---

## 5. State Management

### 5.1 Zustand (default for module state)

One `store.ts` per module, created with `devtools`:

```ts
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface PlaybookState { /* state */ }
interface PlaybookActions { /* actions */ }
type PlaybookStore = PlaybookState & PlaybookActions;

const initialState: PlaybookState = { /* … */ };

export const usePlaybookStore = create<PlaybookStore>()(
  devtools(
    (set, get) => ({
      ...initialState,
      loadPlaybooks: async (query) => {
        set({ playbooksLoading: true });
        try {
          const data = await api.getPlaybooks(query);
          set({ playbooks: data.playbooks, playbooksLoading: false });
        } catch (err) {
          set({ playbooksLoading: false });
          throw err;
        }
      },
    }),
    { name: 'playbook-store' },
  ),
);
```

**Rules:**
- Always pass `{ name: '<module>-store' }` to `devtools` so it shows up in Redux DevTools.
- Keep `initialState` in a `const` at the top of the file for resets and tests.
- Use `useShallow` when selecting multiple fields to avoid re-renders:
  ```ts
  import { useShallow } from 'zustand/react/shallow';
  const { playbooks, loading } = usePlaybookStore(
    useShallow((s) => ({ playbooks: s.playbooks, loading: s.playbooksLoading })),
  );
  ```
- Single `store.ts` per module is the convention. Do **not** split into slices unless you can justify it and match `playbook`'s (currently unused) `store/` layout is **not** a green light — treat it as legacy.
- Persist only what must survive reload (UI prefs, panel open/closed). Use direct `localStorage` in actions; we do **not** use Zustand's `persist` middleware.

### 5.2 React Context (for cross-cutting concerns only)

React Context is used for:
- `AuthContext` (`src/modules/auth/AuthContext.tsx`) — auth state; updates are rare, fan-out is app-wide.
- `ThemeContext` (`src/contexts/ThemeContext.tsx`) — theme & color theme.
- `SettingsModalProvider`, `UsageProvider`, `NotificationsProvider`, `LocalizationProvider`.

**Do not** add new Context unless (a) the state is app-wide and (b) updates are very infrequent. Otherwise use Zustand.

### 5.3 Provider composition

Order is fixed in `src/providers/CombinedProvider.tsx`:

```
LocalizationProvider
  └ AuthProvider
      └ NotificationsProvider
          └ UsageProvider
              └ ThemeProvider
                  └ SettingsModalProvider
```

If you add a provider, put it in `CombinedProvider` with a rationale comment for its ordering.

---

## 6. API Layer

### 6.1 Axios client

Single instance: `src/lib/api/client.ts`. **Never** create another axios instance.

- `withCredentials: true` — backend uses an HTTP-only refresh cookie.
- Request interceptor attaches `Authorization: Bearer <token>` from `localStorage`.
- Response interceptor handles:
  - `503` maintenance mode → redirects to `/#/maintenance`
  - `401` → silent refresh (with subscriber queue to prevent duplicate refreshes), then retry; logout + redirect on refresh failure
  - All other errors → re-throw as `ApiError` shape.

### 6.2 Endpoint registry

All URLs live in `src/lib/api/config.ts` as `API_ENDPOINTS`. **Do not** hardcode paths in module `api.ts` files:

```ts
// GOOD
await apiClient.get(API_ENDPOINTS.playbooks.byId(id));

// BAD
await apiClient.get(`/playbooks/${id}`);
```

Add new endpoints there, grouped by resource. Parameterised routes are functions: `byId: (id) => \`/playbooks/${id}\``.

### 6.3 Module `api.ts`

Thin typed wrappers around `apiClient`:

```ts
import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type { Playbook, PlaybookQueryParams } from './types';

export async function getPlaybooks(query: PlaybookQueryParams) {
  const res = await apiClient.get<ApiResponse<{ playbooks: Playbook[]; pagination: Pagination }>>(
    API_ENDPOINTS.playbooks.list,
    { params: query },
  );
  return res.data.data; // unwrap ApiResponse
}
```

**Rules:**
- Every API function is typed with `ApiResponse<T>` and returns `res.data.data` (the inner `data` field).
- No business logic, no toasts — API functions only fetch and parse. UI concerns belong in components/hooks.
- No retries at this layer. Refresh is handled centrally by the interceptor.

### 6.4 Calling APIs from components — `useApiAction`

`src/lib/use-api-action.ts` is the canonical way to call an API from a component:

```ts
const { execute, isLoading, error, data, clearError } = useApiAction(api.updateProfile, {
  showSuccessToast: true,
  successMessage: t('profile.saved'),
  onSuccess: (updated) => setUser(updated),
});
```

Options:
- `showErrorToast` (default `true`) — set `false` for forms that render error inline.
- `showSuccessToast` / `successMessage`.
- `onSuccess`, `onError`, `onReAuthRequired`.

Prefer `useApiAction` over hand-rolled `try/catch + useState`.

---

## 7. Caching & Data Fetching

**There is no TanStack Query / React Query.** Caching is handled inside Zustand stores.

### 7.1 Cache patterns in the codebase

- **By-id map:** `conversations: Map<string, Conversation>` keyed on resource id.
- **By-page map:** `documents: Map<pageNumber, Document[]>` for paginated lists.
- **Singletons:** `currentPlaybook: Playbook | null` for the active resource.
- **Loading flags:** `playbooksLoading`, `currentPlaybookLoading` — booleans, not arrays.

### 7.2 Rules

- No TTL / time-based expiration today. Cache invalidation is **explicit**: after a mutation, either refetch or mutate the cache in place.
- After a successful `PUT`/`POST`/`DELETE`, update the relevant store entry immediately — do not rely on refetching.
- Do not store derived data; compute it inline in selectors/components.
- If you need request deduplication, gate it with an `inFlight` flag in the store before adding a new library.

### 7.3 Browser storage

- `localStorage`:
  - `yellostorm_access_token`, `yellostorm_user` — via `AUTH_STORAGE_KEYS` from `@/lib/api/config`.
  - UI preferences (theme, color theme, panel open/closed).
- `sessionStorage`: maintenance info (`MAINTENANCE_STORAGE_KEY`).
- Keys are always declared as exported constants, never inlined as string literals.

---

## 8. Forms

Stack: `react-hook-form` + `zod` + shadcn `<Form>` primitives.

```tsx
const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
type Values = z.infer<typeof schema>;

const form = useForm<Values>({
  resolver: zodResolver(schema),
  defaultValues: { email: '', password: '' },
});

async function onSubmit(values: Values) {
  await execute(values); // from useApiAction
}

return (
  <Form {...form}>
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <FormField
        control={form.control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('email')}</FormLabel>
            <FormControl><Input {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {t('submit')}
      </Button>
    </form>
  </Form>
);
```

**Rules:**
- Zod schema first, type derived with `z.infer`.
- Validation messages from the schema map to translation keys where user-facing.
- Use `<FormField>` / `<FormMessage>` — do not render errors manually.
- Use `scrollToFirstError` from `@/lib/form-utils` on submit failure for long forms.

---

## 9. UI & Styling

### 9.1 Composition

- **Use primitives in `src/components/ui/` first.** They wrap Radix with project defaults and i18n-ready shapes.
- New UI primitives (Dialog variant, new Combobox flavour, etc.) go into `src/components/ui/`, not into a module.
- Module-specific widgets live in `src/modules/<name>/components/`.

### 9.2 `cn()` helper

Always merge classNames with `cn()` from `@/lib/utils`:

```ts
import { cn } from '@/lib/utils';

<div className={cn('rounded-md border', isActive && 'bg-muted', className)} />
```

This runs `clsx` then `tailwind-merge` to resolve conflicts (`px-2` vs `px-4`).

### 9.3 Variants — `class-variance-authority`

For components with variants, use CVA (see `src/components/ui/button.tsx`):

```ts
const buttonVariants = cva('inline-flex items-center justify-center ...', {
  variants: {
    variant: { default: '...', destructive: '...', outline: '...' },
    size: { default: 'h-9 px-4', sm: 'h-8 px-3', lg: 'h-10 px-6' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});
```

Expose `VariantProps<typeof buttonVariants>` on the props type.

### 9.4 `asChild` composition

Radix Slot pattern (`asChild`) is preferred over wrapping. Use it when passing a custom child should take over rendering.

### 9.5 Theming

- Light / dark via class on `<html>` (`ThemeContext` toggles it).
- Color themes: `default | yellowsys | claude | kpmg` — add via `COLOR_THEMES` in `ThemeContext`, not ad-hoc.
- Never hardcode brand colors; use Tailwind semantic tokens (`bg-primary`, `text-muted-foreground`).

### 9.6 Icons

- Default to `lucide-react` imports: `import { Check, Mail, Trash2 } from 'lucide-react';`.
- Brand / custom SVGs go in `src/components/icons.tsx` under the `Icons` object: `<Icons.logo />`, `<Icons.microsoft />`.
- Use `<AppLogo />` for the app mark — it's theme-aware.

---

## 10. Internationalisation (i18n)

**No hardcoded user-facing string. Ever.** Every visible label, placeholder, tooltip, toast message, validation message, and aria-label goes through i18n.

### 10.1 Namespaces

- Core (always loaded): `common`, `errors`, `auth`.
- Module namespaces (`playbook`, `conversation`, `admin`, …) are **lazy-loaded** on first use.
- Files: `src/modules/<module>/locales/{en,fr}.json` and shared in `src/modules/localization/locales/{en,fr}/<namespace>.json`.

### 10.2 Usage

```ts
import { useModuleTranslation } from '@/modules/localization';

const { t } = useModuleTranslation('playbook');
return <Button>{t('list.createButton')}</Button>;
```

- Keys are **flat with dot-notation**: `"store.errors.notFound"` — not nested objects with more than one level.
- Shared strings (`save`, `cancel`, …) come from `common`.
- Error code messages come from `errors` and are resolved automatically by `getErrorMessage(code)`.

### 10.3 Adding strings

1. Add the key to `en.json` **and** `fr.json` for the target namespace.
2. Reference via `useModuleTranslation('<ns>')`.
3. If introducing a new namespace, register it in `src/modules/localization/namespace-loaders.ts` patterns (Vite glob usually picks it up automatically — verify).

Admin sidebar / permission entries follow the `labelKey` / `descriptionKey` pattern defined in `src/modules/admin/constants.ts` + `src/modules/admin/locales/{lang}.json`.

---

## 11. Notifications (Toasts)

Always go through `@/lib/notifications`:

```ts
import { showSuccess, showError, showWarning, showInfo, showLoading, showPromise } from '@/lib/notifications';

showSuccess(t('profile.saved'));
showError(t('profile.saveFailed'), { description: err.message });

const loading = showLoading(t('uploading'));
try {
  await upload();
  loading.success(t('uploaded'));
} catch (e) {
  loading.error(t('uploadFailed'));
}
```

**Do not** import `toast` from `sonner` directly in feature code. Centralising in `notifications.ts` means defaults (duration, action shape) stay consistent.

The global `<Toaster />` is rendered in `App.tsx` (position `top-right`, `richColors`). Don't add another.

---

## 12. Streaming (SSE)

Two SSE services — both singletons:
- `ConversationStreamService` (`src/modules/conversation/stream.ts`)
- `NotificationsService` (`src/modules/notifications/...`)

### 12.1 Rules

- **One `EventSource` per service.** Never open an ad-hoc `new EventSource` in a component.
- Services live behind a provider (`NotificationsProvider`) or are imported as a singleton and subscribed to via `service.subscribe(listener)` returning an unsubscribe fn.
- Token refresh integration is mandatory: the axios response interceptor calls `notificationsService.reconnectWithNewToken()` on refresh. New streaming services must expose the same hook.
- Exponential backoff (base 1s, cap 60s, max ~10 retries) + heartbeat timeout (~30s) + eviction handling (`TOO_MANY_TABS`) are standard — copy the pattern, don't reinvent.
- Apply high-frequency chunks through a buffer (see `StreamingBuffer` in `conversation/store.ts`) with a ~30ms drain interval to avoid React thrash.

---

## 13. Error Handling

### 13.1 Error shape

All API errors surface as `ApiError` (`src/lib/api/client.ts`):

```ts
interface ApiError {
  code: string;         // e.g. 'ERR_1101'
  message: string;      // fallback, usually backend-provided
  statusCode: number;
  details?: Array<{ field: string; message: string }>;
}
```

### 13.2 Codes

Mirror the backend in `src/lib/error-codes.ts` (`ErrorCode` enum, `ERR_1xxx` ranges). Add a matching translation in `locales/.../errors.json`.

### 13.3 Surfacing

- **Toast** (default): via `useApiAction` (`showErrorToast: true`) or via `handleApiError(err)` in non-hook code.
- **Inline** (forms, critical flows): `showErrorToast: false` + render `error.message` (or resolve by code) inside an `<Alert>` or `<FormMessage>`.
- Do **not** `console.error` user-actionable errors silently — either surface them or annotate why they're ignored.

### 13.4 Translating errors

Use `getErrorMessage(code)` when available so codes resolve to localised strings. Raw backend messages are a fallback, not the primary UX.

---

## 14. Testing

### 14.1 Setup

- Framework: **Vitest** + **React Testing Library** + `@testing-library/jest-dom`.
- Global setup: `src/test/setup.ts` — mocks for `react-router-dom` navigation, `matchMedia`, `ResizeObserver`, `localStorage`, i18n.
- Run: `npm test` (or `npm run test:cov` for coverage).

### 14.2 Conventions

- Colocate tests next to source: `PlaybookListPage.test.tsx` next to `PlaybookListPage.tsx`; `api.test.ts` next to `api.ts`.
- Mock the axios client with hoisted factories when testing module APIs:

```ts
const apiClientMock = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
}));
vi.mock('@/lib/api/client', () => ({ __esModule: true, default: apiClientMock }));
```

- Use `beforeEach(() => vi.clearAllMocks())`.
- Reach for `mockResolvedValueOnce` / `mockRejectedValueOnce` — prefer per-test arrangement over shared mocks.
- Queries: `getByRole` > `getByLabelText` > `getByText` > `getByTestId` (last resort).
- For store tests, reset state with the store's `setState(initialState, true)` in `beforeEach`.
- Factories / fixtures belong in `<module>/test-utils.ts`.

### 14.3 What to cover

- **API layer**: every function — URL, method, params, body, and unwrap.
- **Stores**: actions (success + failure paths), computed flags, invalidation after mutation.
- **Components**: primary user flow (render + interaction + assertion). Avoid snapshotting whole trees; snapshot small pure components at most.

---

## 15. TypeScript Conventions

- `strict: true`. **Never** `any`. Use `unknown` + narrowing or a tight type.
- `import type` for type-only imports so they are stripped at build.
- Discriminated unions in `types.ts` for event streams, action payloads, node types. Pattern:

  ```ts
  export type PlaybookExecutionEvent =
    | { type: 'started'; data: PlaybookExecutionStartEvent }
    | { type: 'step_start'; data: PlaybookStepStartEvent }
    | { type: 'step_complete'; data: PlaybookStepCompleteEvent };
  ```

- Prefer **`const` objects with `as const`** for closed sets of values over `enum`, **except** for error codes (kept as `enum` for parity with backend).
- `Readonly<Props>` for provider / component props that must not be mutated.
- No default exports for components — use named exports so lazy-load shims stay explicit.

---

## 16. File Naming

| Kind | Style | Example |
|------|-------|---------|
| React components | PascalCase | `PlaybookListPage.tsx`, `ExecutionPanel.tsx` |
| Hooks (files) | `use-<name>.ts` or `useXxx.ts` — match neighbours in the same folder | `use-mobile.ts`, `useApiAction.ts` |
| Utilities / services | kebab-case | `form-utils.ts`, `api-error.ts`, `auto-layout.ts` |
| Types | `types.ts` or `<Name>.types.ts` | `src/modules/playbook/types.ts` |
| Locale files | `{en,fr}.json` | `src/modules/admin/locales/en.json` |
| Tests | `.test.ts(x)` colocated | `store.test.ts`, `PlaybookListPage.test.tsx` |
| Barrel | `index.ts` (one per module, optional per folder) | `src/modules/auth/index.ts` |

---

## 17. Environment & Configuration

- Read env through `import.meta.env.VITE_*` only — never `process.env.*` in runtime code (Vite-only exception is in `config.ts`).
- `VITE_API_URL` (optional) overrides the dev API base.
- Production uses **runtime injection**: the build ships with the literal placeholder `'MY_APP_VITE_API_URL'`, replaced by `env.sh` at container start. This lets a single artifact deploy to multiple envs. When introducing a new runtime-configurable value, follow the same placeholder pattern and document it in `env.sh`.
- Never commit secrets. Public frontend has no secrets — if you think you need one, it belongs on the backend.

---

## 18. Performance

- Lazy-load route-level pages (`React.lazy` + `Suspense`).
- Use `useShallow` for multi-field Zustand selectors.
- Memoise expensive child props with `useMemo`; memoise components with `memo` only when a profiler shows they re-render hot.
- Virtualise long lists with `virtua` (already used for conversation / documents).
- Debounce / throttle high-frequency updates (SSE chunks, resize listeners, search inputs).
- Avoid rendering large Markdown/code in the critical path — `streamdown` + `shiki` are the standard renderers.

---

## 19. Integrations (when to reach for them)

| Library | Use for | Source of truth |
|---------|---------|-----------------|
| `@xyflow/react` | Playbook canvas (nodes/edges) | `src/modules/playbook/components/` |
| `@tanstack/react-table` | Admin tables (users, roles, audit logs) | `src/modules/admin/` |
| `recharts` | Analytics/usage charts | `src/modules/admin/pages/`, `src/modules/usage/` |
| `virtua` | Long virtualised lists | `src/modules/conversation/`, `src/modules/workspace/` |
| `ai` (Vercel AI SDK) + `@anthropic-ai/sdk` | LLM streaming UIs | `src/components/ai-elements/`, `src/modules/conversation/` |
| `streamdown`, `shiki`, `react-markdown` | Render streaming/static markdown | `src/components/ai-elements/` |
| `exceljs` | Spreadsheet export | Workspace/admin export flows |
| `date-fns` | Date formatting — **do not** pull in moment/luxon | everywhere |

---

## 20. Checklist Before Opening a PR

- [ ] New module/component follows the module anatomy (§3).
- [ ] All user-facing strings go through `useModuleTranslation` and exist in **both** `en.json` and `fr.json`.
- [ ] No hardcoded API paths; everything goes through `API_ENDPOINTS`.
- [ ] API calls in components go through `useApiAction` (or a justified exception).
- [ ] Zustand store uses `devtools({ name: '…' })` and exposes an `initialState`.
- [ ] No new axios instance, no direct `toast` import, no new `EventSource` in components.
- [ ] `cn()` used for className merging; variants via CVA.
- [ ] Errors surfaced via toast or inline; codes referenced from `ErrorCode` when applicable.
- [ ] Tests colocated, `vi.mock` applied to `@/lib/api/client` when testing module API.
- [ ] `npm test` and `npm run build` pass locally.
- [ ] README updated if architecture or public API of a module changed.
- [ ] Commit message uses the conventional format: `<type>(<scope>): <subject>`.

---

## 21. Anti-Patterns (reject in review)

- Creating a second axios instance, or calling `fetch` directly for a backend call.
- Importing `toast` from `sonner` instead of `@/lib/notifications`.
- Inline string literals in JSX (`<Button>Save</Button>`).
- Relative imports that climb `../../../`.
- Cross-module imports that reach into internals (`@/modules/playbook/components/Foo/Bar`).
- New React Context for per-feature state (use Zustand).
- Global singletons for service state other than the documented SSE services.
- `console.log` left in production code (use the logger — or remove it).
- Swallowing errors with empty `catch {}`.
- Adding a new dependency that overlaps with an existing one (moment vs date-fns, react-query vs Zustand, etc.).
- Disabling `strict` rules or adding `// @ts-ignore` without a linked issue explaining why.
