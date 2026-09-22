# App Builder Module

## Overview

The App Builder module is a frontend hub that lets users **browse, manage, share, and delete** their deployed apps, shared apps, and drafts. It also provides an inline **Agent entry point** to create new apps via conversational AI. The module does **not** contain app creation logic itself — it delegates that to the `conversation-v2` module.

**Route:** `/app-builder` (lazy-loaded via `React.lazy` in `Router.tsx`)

---

## Architecture & File Structure

```
app-builder/
├── index.ts                              # Public API: exports AppBuilderPage, AppBuilderButton, useAppBuilderStore, DeployedApp
├── api.ts                                # REST API client for app catalog & end-user grants
├── types.ts                              # All TypeScript interfaces & type aliases
├── store.ts                              # Zustand global store (catalog state, fetch, remove)
├── store.test.ts                         # Unit tests for the store
├── status-i18n.ts                        # Maps tab keys → i18n translation keys
├── hooks/
│   └── useAppBuilderFilters.ts           # URL-synced filter/sort/view/search logic
├── components/
│   ├── AppBuilderPage.tsx                # Main page component (entry point)
│   ├── AppBuilderPage.test.tsx           # Integration tests for the page
│   ├── AppBuilderButton.tsx              # Sidebar navigation button
│   ├── DeployedAppCard.tsx              # Card for deployed & shared apps
│   ├── DraftAppCard.tsx                 # Card for draft apps
│   ├── DeleteDeployedAppButton.tsx       # Delete/unshare button with confirmation dialog
│   ├── DeleteDraftAppButton.tsx          # Delete draft button with confirmation dialog
│   ├── AppEndUsersDialog.tsx             # Dialog to manage end-user CRUD + useAi permissions
│   ├── AppAiBadge.tsx                    # Badge when session/app has AI features
│   └── hub/
│       ├── AppBuilderCreateWithAgent.tsx # Inline Agent composer for creating new apps
│       ├── AppBuilderFilters.tsx         # Search, tab, sort, view-mode, optional AI filter
│       ├── AppBuilderGrid.tsx            # Grid/list layout with pagination
│       └── AppBuilderPagination.tsx      # Previous/Next pagination controls
└── locales/
    ├── en.json                           # English translations
    └── fr.json                           # French translations
```

### App Builder AI (hub)

- Cards show `AppAiBadge` when `hasAiFeatures` is set on the catalog item / session.
- `AppEndUsersDialog` can toggle end-user **AI** grant (`useAi`) in addition to CRUD — forwarded to Nest App Data (MS ACL `use_ai` when remote).
- Filters may include an AI facet via `useAppBuilderFilters` (see locales `app-builder`).

Backend counterpart: [`../../../../back/src/modules/app-builder-ai/README.md`](../../../../back/src/modules/app-builder-ai/README.md).

---

## Types & Interfaces

All defined in `types.ts`:

| Type | Description |
|---|---|
| `AppBuilderTab` | `'all' \| 'deployed' \| 'shared' \| 'draft'` — filter tab identifier |
| `DeployedAppSource` | `'owned' \| 'shared'` — whether the user owns or received the app |
| `DraftDeployStatus` | `'idle' \| 'deploying' \| 'error'` — draft publication state |
| `AppCatalogItem` | Discriminated union: `{ kind: 'deployed', app: DeployedApp } \| { kind: 'draft', app: DraftApp }` |
| `DeployedApp` | `{ sessionId, title, deployedUrl, lastDeployedAt, source, shareId, canOpenConversation? }` |
| `DraftApp` | `{ sessionId, title, lastUpdatedAt, deployStatus }` |
| `AppBuilderCatalog` | `{ deployed: DeployedApp[], shared: DeployedApp[], drafts: DraftApp[] }` |
| `AppEndUserGrants` | `{ create: boolean, read: boolean, update: boolean, delete: boolean }` |
| `AppEndUserSummary` | `{ id, email, displayName, status, grants, createdAt }` |

Additional types exported from `hooks/useAppBuilderFilters.ts`:

| Type | Description |
|---|---|
| `AppSortKey` | `'deployed' \| 'name' \| 'updated'` |
| `AppViewMode` | `'grid' \| 'list'` |
| `AppBuilderFilterState` | `{ search, tab, sort, view }` |

---

## Zustand Store

**File:** `store.ts`  
**Name:** `app-builder-store`

### State

```ts
{
  deployed: DeployedApp[];
  shared: DeployedApp[];
  drafts: DraftApp[];
  loading: boolean;
  error: boolean;
  deletingSessionId: string | null;  // tracks which app is being deleted (for spinner)
}
```

### Actions

| Action | Description |
|---|---|
| `fetchApps()` | Calls `GET /conversation-v2/apps`, sets `deployed`, `shared`, `drafts`. Sets `loading`/`error` flags. |
| `removeApp(sessionId)` | Calls `DELETE /conversation-v2/apps/:sessionId`. Removes from `deployed` and `shared` arrays locally. |
| `removeDraft(sessionId)` | Calls `useConversationV2PointersStore.getState().remove(sessionId)` (soft-delete via conversation-v2). Removes from `drafts` locally. |

**Key behavior:** After successful API call, items are removed from local state immediately (optimistic UI). On error, the action re-throws so the calling component can show a toast.

**Cross-module dependency:** `removeDraft` accesses the `conversation-v2` store directly — it does NOT call `appBuilderApi`.

---

## API Client

**File:** `api.ts`

All requests go through `apiClient` (axios-based, from `@/lib/api/client`).

| Method | Endpoint | Description |
|---|---|---|
| `listApps()` | `GET /conversation-v2/apps` | Returns the full catalog: `{ deployed, shared, drafts }` |
| `removeApp(sessionId)` | `DELETE /conversation-v2/apps/:sessionId` | Removes an app from the App Builder catalog |
| `listEndUsers(sessionId)` | `GET /conversation-v2/sessions/:sessionId/app-data/end-users` | Lists registered users of a deployed app |
| `updateEndUserGrants(sessionId, userId, grants)` | `PUT /conversation-v2/sessions/:sessionId/app-data/end-users/:userId/grants` | Updates CRUD permissions for a specific user |

**Response wrapper:** All endpoints return `ApiResponse<T>` where the payload is in `data.data`.

---

## Components

### `AppBuilderPage` (main entry)

The root component rendered at `/app-builder`. Responsibilities:
1. Fetches the catalog on mount via `fetchApps()`
2. Applies filters via `useAppBuilderFilters(catalog)`
3. Renders one of four states: error, loading, global-empty, or the filterable app grid
4. Always shows `AppBuilderCreateWithAgent` when not in error state

### `AppBuilderButton`

A `SidebarMenuItem` that navigates to `/app-builder`. Rendered in the sidebar when `featureVisibility.appBuilder` is true.

### `AppBuilderCreateWithAgent`

An inline section at the top of the page with:
- A `AgentComposer` (reused from `conversation-v2`) for text input
- Suggestion chips ("A sales dashboard...", "A task tracker...", "A contact form...")
- On submit, calls `startConversationV2AgentSession()` with `source: 'app-builder'`
- On success, navigates to `/conversation-v2/:sessionId` (the conversation page handles the rest)
- Clears selected skills/connectors on mount

### `AppBuilderGrid`

Renders the app list as a grid or list layout with client-side pagination (9 items per page via `APP_BUILDER_PAGE_SIZE`). Resets to page 1 when tab, deployed, shared, drafts, or all items change. Normalizes all items into `AppCatalogItem[]` for uniform rendering.

### `AppBuilderFilters`

A filter bar with:
- **Search input** (debounced 200ms, synced to `?q=` URL param)
- **Status tab select** (all / deployed / shared / draft)
- **Sort select** (recently deployed, recently updated, or name — varies by tab)
- **View toggle** (grid / list)
- **Clear filters** button (visible when active filters exist)

### `DeployedAppCard`

Card for both `owned` and `shared` deployed apps. Supports grid and list views.

**Actions available:**
| Action | Visible when |
|---|---|
| Open app (`window.open`) | Always |
| Go to conversation | Owned apps always; shared apps only if `canOpenConversation === true` |
| Manage users (opens `AppEndUsersDialog`) | Owned apps only |
| Share (opens `ShareDeployDialog`) | Owned apps always; shared apps only if `canOpenConversation === true` |
| Delete/Remove (opens `DeleteDeployedAppButton`) | Always |

**Visual distinction:** Owned apps use emerald/green theme. Shared apps use sky/blue theme.

### `DraftAppCard`

Card for draft apps. Supports grid and list views.

**Actions:**
- Continue building → navigates to `/conversation-v2/:sessionId`
- Delete → opens `DeleteDraftAppButton`

**Status badges:** idle (amber), deploying (amber with spinner), error (destructive with alert icon).

### `DeleteDeployedAppButton`

Opens an `AlertDialog` confirmation. On confirm:
- Calls `removeApp(sessionId)` from the store
- Shows success toast (different messages for owned vs shared)
- On error, shows error toast

For **shared apps**, the dialog text changes to "Remove shared app?" (not "Delete"), and the success message says "removed from your App Builder" (the owner's conversation is unaffected).

### `DeleteDraftAppButton`

Opens an `AlertDialog` confirmation. On confirm:
- Calls `removeDraft(sessionId)` from the store (which soft-deletes the conversation)
- Shows success/error toast

**Warning:** Deleting a draft **permanently deletes the associated conversation**.

### `AppEndUsersDialog`

A full-featured dialog for managing end-user CRUD permissions on a deployed app.

**Features:**
- Loads users via `appBuilderApi.listEndUsers(sessionId)` on open
- Search/filter by name or email
- Table view (desktop) and card view (mobile)
- Per-user CRUD switches (create, read, update, delete)
- Preset dropdown: None, Read-only, Full access
- Refresh button
- Error state with retry

**Note:** Only visible for **owned** deployed apps.

---

## Hooks

### `useAppBuilderFilters(catalog)`

The central filtering/sorting/search hook. Manages URL search params (`?q=`, `?tab=`, `?sort=`, `?view=`) via `useSearchParams`.

**Returns:**
- `filters`: Current `{ search, tab, sort, view }` state
- `searchInput` / `setSearchInput`: Local input state with 200ms debounce before URL sync
- `setTab`, `setSort`, `setView`: URL param setters with smart defaults
- `clearAll`: Resets search and sort (keeps tab)
- `hasActiveFilters`: Boolean — true if search or non-default sort is active
- `tabCounts`: `{ all, deployed, shared, draft }` counts (unfiltered)
- `filteredDeployed`, `filteredShared`, `filteredDrafts`, `filteredAll`: Filtered & sorted arrays
- `activeList`: The currently visible list based on active tab
- `isEmpty`: True if the active filtered list is empty
- `isCatalogEmpty`: True if the entire catalog is empty (no apps at all)

**Sort logic:**
- `'deployed'` / `'updated'`: Descending by date
- `'name'`: Alphabetical (localeCompare)
- Default sort is `'deployed'` for non-draft tabs, `'updated'` for draft tab
- Switching to draft tab auto-switches sort to `'updated'`; switching away auto-removes `'updated'`

**Search logic:**
- Deployed/shared apps: matches against `title` and `deployedUrl`
- Drafts: matches against `title` only

---

## Localization

**Namespace:** `app-builder`  
**Files:** `locales/en.json`, `locales/fr.json`

Translation keys are accessed via `useModuleTranslation('app-builder')`. The `status-i18n.ts` file maps `AppBuilderTab` values to the correct i18n keys for labels, descriptions, empty states, and list headings.

---

## Interactions with Other Modules

| Module | Usage |
|---|---|
| `conversation-v2` | `AgentComposer` component for the create-with-agent input; `startConversationV2AgentSession` to launch a new session; `useConversationV2Store` to clear skills/connectors; `useConversationV2PointersStore` to soft-delete drafts; `ShareDeployDialog` for sharing |
| `localization` | `useModuleTranslation('app-builder')` throughout all components |
| `sidebar` | `AppBuilderButton` rendered in the sidebar; active state detection via `pathname.startsWith('/app-builder')` |
| `platform-overview` | Links to `/app-builder` from quick actions and marketplace section |
| `lib/api/client` | `apiClient` (axios) for all HTTP requests |
| `lib/notifications` | `showSuccess` / `showError` toasts |
| `components/ui/*` | Shared Radix UI components (Button, Dialog, Badge, Select, Table, Switch, etc.) |

---

## Routing

| Path | Component | Notes |
|---|---|---|
| `/app-builder` | `AppBuilderPage` (lazy) | Main hub page |

The sidebar button (`AppBuilderButton`) navigates to `/app-builder`. The platform overview page also links there.

URL search params are used for filter state:
- `?q=<search>` — search query
- `?tab=<all|deployed|shared|draft>` — active tab (omitted for "all")
- `?sort=<deployed|name|updated>` — sort key (omitted for default)
- `?view=list` — list view (omitted for grid default)

---

## Business Rules

1. **Deployed apps vs Shared apps:** Both use the `DeployedApp` type but differ in `source`. Shared apps may lack conversation access (`canOpenConversation`), which hides the conversation and share buttons.

2. **Delete semantics:**
   - Deleting an **owned deployed app** removes it from App Builder but keeps the conversation and hosted app. Re-publishing adds it back.
   - Deleting a **shared deployed app** ("unshare") only removes it from the current user's view. The owner is unaffected.
   - Deleting a **draft** permanently deletes the associated conversation (irreversible).

3. **End-user permissions:** Only the app owner can manage end-user grants. New users have no permissions by default. Sharing with an email that has no YellowMind account still sends an invite: the guest opens `{deployedUrl}register?invite=TOKEN`, the email is prefilled and locked, and register creates an app end-user with deny-all grants. If they later create a YellowMind account with the same email, the App Builder share is claimed automatically.

4. **Pagination:** Client-side only, 9 items per page. Resets to page 1 on tab/data change.

5. **Agent creation flow:** The inline agent creates a new `conversation-v2` session with `source: 'app-builder'`. The conversation page shows a special banner when entered from App Builder.

---

## Edge Cases & Behaviors

- **Empty catalog:** Shows `AppBuilderCreateWithAgent` + a prominent empty state message
- **Empty filtered results (with active filters):** Shows "No apps match your filters" with a clear button
- **Empty filtered results (no active filters):** Shows the tab-specific empty message
- **Loading + empty catalog:** Shows a spinner instead of the empty state
- **Draft `deployStatus`:** `'deploying'` shows a spinner badge, `'error'` shows an error badge, `'idle'` shows a plain badge
- **Search debounce:** 200ms delay before updating URL params; cleanup on unmount
- **Sort auto-switch:** Changing to draft tab auto-selects "Recently updated"; changing away auto-removes it
- **Page overflow:** If `page > totalPages` (e.g., after filtering), page is clamped to `totalPages`
- **Disabled users in end-users dialog:** Shown with `opacity-60`; switches are disabled

---

## Dependencies

| Dependency | Purpose |
|---|---|
| `zustand` | Global state management |
| `react-router-dom` | Navigation and URL search params |
| `lucide-react` | Icons throughout the module |
| `sonner` | Toast notifications (in `AppBuilderCreateWithAgent`) |
| `@/components/ui/*` | Radix-based UI primitives |
| `@/lib/api/client` | Axios HTTP client |
| `@/lib/notifications` | `showSuccess` / `showError` helpers |
| `@/lib/utils` | `cn()` classname merger |
| `@/modules/localization` | i18n hook |
| `@/modules/conversation-v2` | AgentComposer, startAgentSession, stores, ShareDeployDialog |

---

## Testing

- **Store tests** (`store.test.ts`): Test `fetchApps`, `removeApp`, `removeDraft` with mocked API
- **Page tests** (`AppBuilderPage.test.tsx`): Integration tests covering rendering, filtering, tab switching, delete confirmation, share dialog, pagination, empty states, URL sync

Run tests with: `npm test` (Vitest)

---

## How to Modify This Feature

### Add a new filter option
1. Add the new filter value to the relevant type in `types.ts` (e.g., extend `AppBuilderTab`)
2. Add i18n keys in `locales/en.json` and `locales/fr.json`
3. Update `status-i18n.ts` if it's a tab
4. Update `useAppBuilderFilters` to handle the new param in URL parsing and filtering logic
5. Update `AppBuilderFilters` to render the new option

### Add a new action to app cards
1. Add the action button to `DeployedAppCard.tsx` or `DraftAppCard.tsx`
2. Use the `ActionButton` wrapper for consistent styling and tooltip
3. If the action opens a dialog, add the dialog state (`useState`) and render it in the `dialogs` fragment
4. If the action calls an API, add the endpoint to `api.ts` and a store action if needed

### Add a new API endpoint
1. Add the method to `appBuilderApi` in `api.ts`
2. Import the response type from `types.ts` (or add it)
3. Call it from the appropriate component or store action
4. Handle loading/error states

### Modify the delete behavior
1. `DeleteDeployedAppButton.tsx` for deployed/shared apps
2. `DeleteDraftAppButton.tsx` for drafts
3. Both call store actions (`removeApp` or `removeDraft`) which handle the API call and local state update
4. Toast messages are in the locale files under `card.*`

### Add a new card type
1. Create a new component in `components/` (e.g., `NewAppCard.tsx`)
2. Follow the pattern from `DraftAppCard` or `DeployedAppCard` (memo, view prop, ActionButton)
3. Update `AppBuilderGrid` to render the new card type based on `AppCatalogItem.kind`
4. Update `AppBuilderCatalog` and related types if needed

### Change pagination behavior
1. Modify `APP_BUILDER_PAGE_SIZE` in `AppBuilderGrid.tsx` (currently 9)
2. The pagination is purely client-side — for server-side, you'd need to modify the API and store

---

## Troubleshooting

### Apps not loading (infinite spinner)
- Check browser Network tab for `GET /conversation-v2/apps`
- Verify the user is authenticated
- Check the store's `error` state — if `true`, the API call failed
- Check `loading` state — if stuck `true`, the await may have hung

### Filter state not persisting in URL
- `useAppBuilderFilters` syncs to URL via `useSearchParams` with `{ replace: true }`
- The search input has a 200ms debounce — rapid changes may not appear immediately
- Tab changes auto-adjust sort (draft → "updated", non-draft removes "updated")

### Draft deletion not working
- `removeDraft` calls `useConversationV2PointersStore.getState().remove()` — not the `appBuilderApi`
- If the conversation-v2 store's `remove` fails, the draft won't be deleted
- Check that the conversation-v2 module is loaded and functional

### Share dialog not appearing for shared apps
- The share button only appears when `canOpenConversation === true` on the shared app
- This field is controlled by the backend based on whether the share included conversation access

### End-users dialog shows no users
- Only works for **owned** deployed apps (the button is hidden for shared apps)
- Check `GET /conversation-v2/sessions/:id/app-data/end-users`
- Users must have registered on the deployed app to appear

### Pagination resets unexpectedly
- Pagination resets to page 1 whenever `tab`, `deployed`, `shared`, `drafts`, or `all` change
- This is by design — if items change, page 1 is the safest default

### Tests failing
- Store tests mock `./api` and `@/modules/conversation-v2/store`
- Page tests mock `../api`, `@/lib/notifications`, and `react-router-dom`
- Both use `vi.hoisted()` for mock declarations and `beforeEach` to reset store state

---

## Important Notes for AI/Developer

- The module uses **no direct backend calls for draft operations** — drafts are managed through the `conversation-v2` pointers store.
- The `DeployedApp` type is shared between owned and distinguished by the `source` field.
- All UI text goes through i18n — never hardcode strings.
- Cards use `React.memo` for performance.
- The `ActionButton` pattern (local helper in card files) is duplicated in both card components — if you need to change the action button style, update both files.
- `AppBuilderGrid` normalizes all items into `AppCatalogItem[]` for uniform rendering regardless of tab.
- The module is feature-flagged via `featureVisibility.appBuilder` in the sidebar.
