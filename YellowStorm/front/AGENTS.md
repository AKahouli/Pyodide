# Frontend agent instructions

Applies to `YellowStorm/front/`; root `AGENTS.md` still governs workflow and delivery.
Read this file before edits, then load only matching references below.

## Essential rules

- New modules, services, runtimes or persistence require the user's approval of a concrete scoped proposal before implementation; follow [change control](../../docs/agent-context/architecture/change-control.md). Architecture changes also update the owning references/ADRs before full completion.

- Find an existing sibling implementation before adding a pattern, helper or dependency; check `package.json` before adding a library.
- Use `@/` for shared/cross-module imports and public module barrels; sibling imports stay within the module. Router lazy-loading and established governance exceptions are documented below.
- Extend existing hash-router guards; preserve route lazy-loading boundaries.
- Use the shared `apiClient`, `API_ENDPOINTS` and thin typed module `api.ts`; components use `useApiAction`. Direct fetch is limited to documented protocol exceptions.
- Preserve refresh-cookie/subscriber-queue behavior. Access tokens stay in memory; never store credentials in browser storage or frontend configuration.
- Use the module's existing Zustand/Query/XState ownership. New or materially changed Zustand stores export `initialState`, use named devtools and remain one `store.ts`; state migrations require feature flags.
- Shared rollout flags belong in `src/config/*Features.ts`; module state migrations belong in `<module>/features.ts`. Declare/document every consumed `VITE_*` key; distinguish build-time flags from startup `/config.js` values.
- Use existing UI primitives, semantic theme tokens, `cn()`, CVA and existing icon wrappers.
- Every user-facing string, including aria labels and validation errors, uses i18n with EN + FR entries. Toasts use `@/lib/notifications`; keep one global Toaster.
- Forms use React Hook Form/Zod and shared error helpers. Autosaved editable data stays in one draft/form object; persisted fields require matching payload, backend contract and coverage.
- Surface errors through toast or inline UI; never silently swallow exceptions. Backend error-code additions require frontend enum parity, EN/FR messages and a verified localized message.
- Reuse module stream/socket owners; preserve cleanup, token refresh, sequence/resume and connection limits. Conversation-v2 connects once at the app shell.
- Browser-session coordinates are 1280x720 on both sides. App-runtime sockets preserve one-shot tickets, registration, heartbeat and revision rehydration. Generated widget runtime remains vanilla JS.
- Keep TypeScript strict; narrow `unknown`, use `import type`, avoid `any` and untracked `@ts-ignore`. Remove production debug logs.
- Add focused behavioral coverage for changed behavior; reuse fixtures and existing tests. Follow root guidance for risk gates and concurrent QA.

## Load references only when relevant

| Change | Reference |
|---|---|
| Module layout, imports, routing, types, dependencies | [Architecture](../../docs/agent-context/frontend/architecture.md) |
| Stores, Query, XState, caching, providers, flags/env | [State and data](../../docs/agent-context/frontend/state-and-data.md) |
| REST, fetch exceptions, authentication, error parity | [API and errors](../../docs/agent-context/frontend/api-and-errors.md) |
| Components, forms, localization, notifications, performance | [UI and forms](../../docs/agent-context/frontend/ui-and-forms.md) |
| Streams, sockets, governance/v2/widget/workspace exceptions | [Realtime and module patterns](../../docs/agent-context/frontend/realtime.md) |
| Test conventions and relevant review checks | [Verification](../../docs/agent-context/frontend/verification.md) |

## Focused verification

Run from `YellowStorm/front/`:

- `npm test -- <pattern>` for affected tests.
- `npx tsc --noEmit -p .` for affected TypeScript changes.
- `npm run build` when bundling, configuration or route imports are affected.
- Visible changes require browser QA under the root policy and [fixture rules](../../docs/agent-context/testing/qa-fixtures.md).

For API/socket/schema changes, read the matching backend contract and verify both sender and receiver. Check source for current descriptive examples; documented debt is not permission to copy it.
