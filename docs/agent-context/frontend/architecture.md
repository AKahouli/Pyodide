# Frontend architecture and conventions

Read only the sections relevant to the task. Paths such as `src/` are relative to `YellowStorm/front/`; verify descriptive module examples and recorded debt against current source. Essential edit rules are in [frontend AGENTS.md](../../../YellowStorm/front/AGENTS.md).

## Stack

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
| i18n | `i18next` + `react-i18next` (lazy namespace loading) |
| Toasts | `sonner` via `@/lib/notifications` wrapper |
| Streaming | Native `EventSource` SSE, fetch + `ReadableStream` SSE, singleton services, BroadcastChannel leader-election, per-session hooks |
| Charts / tables / graphs / flow | `recharts`, `@tanstack/react-table`, `@xyflow/react`, `@dagrejs/dagre` |
| Virtualization | `virtua` |
| AI / LLM UI | Vercel AI SDK (`ai`), `@anthropic-ai/sdk`, `streamdown`, `react-markdown`, `shiki`, `tokenlens` |
| Realtime sockets | `socket.io-client` for WhatsApp pairing, browser sessions, and the browser-hosted app runtime |
| Document viewers | `@embedpdf/react-pdf-viewer`, `@cyntler/react-doc-viewer`, `@novnc/novnc` |
| Animation / interaction | `motion`, `cmdk`, `react-resizable-panels`, `embla-carousel-react` |
| Testing | Vitest 2 + React Testing Library + `jest-dom` |

**Do not add a new library** without confirming nothing already in `package.json` covers it.

## Project Structure

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
├── config/                 # Static app/menu config + shared build-time rollout flags (dataRoomFeatures, governedConversationFeatures)
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

**Imports:** use `@/...` for cross-module and root-shared imports. Relative imports are appropriate within the same module, but must not climb out of the owning module to reach another module or `src/lib` (for example, never use `../../../lib/...`).

```ts
import { apiClient } from '@/lib/api/client';
import { useConversationStore } from '@/modules/conversation';
```

## Module Anatomy

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

**Barrel rules:** Export **only** the public surface (pages, store hook, public types). Cross-module consumers import from `@/modules/<name>`, never from internals. Code inside the same module should import its sibling implementation directly rather than routing back through its own barrel.

The app shell has a scoped exception for existing lightweight public entrypoints:
`admin/api`, `admin/constants`, `admin/navigation`, `admin/hooks` and
`profile/SettingsContext`. Shell providers/navigation and shared permission
consumers use these instead of page-exporting barrels, so a conversation does not
eagerly load administrative pages or the settings modal. Public types can still
come from the main barrel with `import type`. Existing barrel exports remain
compatible. RootGuard's index page uses the same direct lazy route import as the
router. This changes import timing only, not permissions or provider ownership.

Representative current modules include: `admin`, `agent`, `app-marketplace`, `auth`, `connected-app`, `connector`, `conversation`, `conversation-v2`, `file-viewer`, `governance`, `groups`, `localization`, `models`, `notifications`, `platform-copilot`, `platform-overview`, `playbook`, `profile`, `project`, `semantic-model`, `sidebar`, `skill`, `team`, `usage`, `workspace`, `worky`. This list is descriptive, not an exhaustive registry; verify `src/modules/`. When adding a module, follow the closest sibling by domain and keep the barrel export limited to the public surface.

```ts
export { ConversationPage } from './ConversationPage';
export { useConversationStore } from './store';
export type { Conversation, Message } from './types';
```

## Routing

`src/Router.tsx` — `createHashRouter`, lazy-load heavy pages (`React.lazy` + `<Suspense>`), guard routes with existing guards (`RootGuard`, `AdminGuard`, `PermissionGuard`). Do **not** roll a new guard — extend an existing one. Hash routing is deliberate (static hosting behind nginx). The router may import a route module directly when needed to preserve a lazy-loading boundary; do not use that exception to reach into non-route module internals.

## TypeScript Conventions

- `strict: true`. **Never** `any` — use `unknown` + narrowing.
- `import type` for type-only imports.
- Discriminated unions for event streams, action payloads, node types.
- Prefer `as const` objects over `enum`, **except** for error codes (parity with backend).
- `Readonly<Props>` for provider/component props that must not be mutated.
- Use named exports for components by default. Route-only modules may use a default export when loaded directly by `React.lazy`; otherwise keep the explicit named-export shim so the public symbol remains visible.

## File Naming

| Kind | Style | Example |
|------|-------|---------|
| React components | PascalCase | `PlaybookListPage.tsx` |
| Hooks | `use-<name>.ts` or `useXxx.ts` — match neighbours | `use-mobile.ts`, `useApiAction.ts` |
| Utilities / services | kebab-case | `form-utils.ts`, `api-error.ts` |
| Types | `types.ts` | `src/modules/playbook/types.ts` |
| Locale files | `{en,fr}.json` | `src/modules/admin/locales/en.json` |
| Tests | `.test.ts(x)` colocated | `store.test.ts` |
| Barrel | `index.ts` | `src/modules/auth/index.ts` |

## Integrations

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
| `socket.io-client` | WhatsApp QR pairing channels, `/browser-session` interactive web import (Pattern 6), and `/app-runtime` browser-hosted execution (Pattern 7) |
| `cmdk` | Command menu primitives |
| `react-resizable-panels` | Split pane layouts |
| `d3` | Custom visualisation where `recharts` is insufficient |
| `exceljs` | Spreadsheet export |
| `date-fns` | Date formatting — **never** moment/luxon |
