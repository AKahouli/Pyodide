# Frontend API and error contracts

Read only the sections relevant to the task. Paths such as `src/` are relative to `YellowStorm/front/`; verify descriptive module examples and recorded debt against current source. Essential edit rules are in [frontend AGENTS.md](../../../YellowStorm/front/AGENTS.md).

## API Layer

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

Direct `fetch` is allowed only when the shared Axios semantics are inappropriate: presigned object-storage transfers, fetch-based SSE/manual stream readers, external MCP/JSON-RPC calls, the generated widget runtime, and maintenance polling that must bypass the maintenance interceptor. Keep these calls in a module API/service/helper rather than a component where feasible. Check `response.ok`, define cancellation and retry behavior where applicable, validate configurable endpoint origins/protocols, and document intentional fail-open or fail-closed error handling. Ordinary YellowStorm REST calls still use `apiClient` and `API_ENDPOINTS`.

## Error Handling

All API errors surface as `ApiError`: `{ code, message, statusCode, details?[] }`. Mirror backend in `src/lib/error-codes.ts`; add translations in `locales/.../errors.json`. Surfacing: toast (default, via `useApiAction` or `handleApiError`), or inline (`showErrorToast: false` + render in `<Alert>` / `<FormMessage>`). **Never** `console.error` user-actionable errors silently. Use `getErrorMessage(code)` so codes resolve to localised strings.

**Error-code parity is mandatory and currently drifted.** The frontend `ErrorCode` enum in `src/lib/error-codes.ts` must mirror the backend enum in `back/src/modules/exceptions/constants/error-codes.ts`. Unknown backend codes are silently normalised to `ERR_1000` (`error-codes.ts`), so any unmapped code loses its specific message in the UI. When the backend adds a code, the same change must: (a) add it to `front/src/lib/error-codes.ts`, (b) add EN + FR messages to `front/src/modules/localization/locales/{en,fr}/errors.json`, (c) verify the code renders the expected message via `getErrorMessage(code)`. Known current drift includes `ERR_1009` (idempotency), extended chat codes (`ERR_1403`–`ERR_1420`), indexing/share codes (`ERR_1950`–`ERR_1960`), and `WIDGET_CITATION_NOT_FOUND` (`ERR_3409`) — fix when touching the relevant area.
