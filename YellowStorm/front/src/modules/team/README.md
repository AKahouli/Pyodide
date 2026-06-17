# Team Module (frontend)

UI for **teams** — user-owned groups of agents arranged as an editable org-chart, shareable with other users, and creatable from a prompt via the AI auto-builder. Teams can be mentioned (`@TeamName`) in conversations to address all their agents at once.

## Key Features

- **Teams list** (`TeamsPage`) — cards with agent count, open-org-chart / share / edit / delete actions, and a "shared with me" state (badge + remove).
- **Org-chart editor** (`TeamOrgChartPage`) — a XYFlow canvas (`@xyflow/react`) with draggable agent nodes, parent→child edges, cycle prevention, **auto-layout** (`@dagrejs/dagre`), and save/revert. Read-only when the team is shared with `read` permission. Double-clicking an owned agent opens its edit dialog.
- **Sharing** (`ShareTeamDialog`) — the same UX as the workspace share modal: a debounced **user-search autocomplete** (`UserSearchInput`, `/users/search`) with per-person `read`/`write` picker, pending-invite chips, and a "people with access" list (owner row + per-share permission menu + revoke).
- **AI auto-builder** — an "Auto Builder" tab in the create dialog (prompt → generate). Generation shows a `/teams/generating` overlay and redirects to the new org-chart on completion. Admin configuration lives in the **admin** module (`TeamAutoBuilderPage`, `/admin/team-auto-builder`).

## Module Structure

```
team/
  index.ts                       # Public API (store hooks, components, types)
  api.ts                         # REST calls (CRUD, hierarchy, generate, shares, user search)
  store.ts                       # Zustand store (teams, currentTeam, isGenerating, actions)
  types.ts                       # Team, TeamMember(WithAgent), share + search types
  translation.ts                 # translateTeam() — non-React i18n for store toasts
  components/
    TeamButton.tsx               # Sidebar entry
    TeamsPage.tsx                # Teams list
    CreateEditTeamDialog.tsx     # Create/edit + Manual | Auto Builder tabs
    TeamOrgChartPage.tsx         # Org-chart editor
    OrgChartNode.tsx             # Canvas node
    AddMemberPopover.tsx         # Add-agent picker
    ShareTeamDialog.tsx          # Share modal (workspace-style)
    UserSearchInput.tsx          # User-search autocomplete
  hooks/useTeamCanvas.ts         # Canvas state (nodes/edges, dirty, save/revert)
  utils/
    auto-layout.ts               # Dagre hierarchical layout
    cycle-detection.ts           # Prevent cyclic parent links
  locales/{en,fr}.json           # `team` i18n namespace
```

## Conventions

- **i18n** — all UI strings live in `locales/{en,fr}.json` under the `team` namespace (registered in `modules/localization`). Components use `useModuleTranslation('team')`; the store uses `translateTeam()` for toasts outside React.
- **Routing** — `/teams` (list), `/teams/:id` (org-chart), `/teams/generating` (AI overlay). Admin config at `/admin/team-auto-builder`.
- **Agent data** — org-chart nodes are enriched from the backend (`members[].agent`) and fall back to the agent store for optimistic rendering of newly added members.
- **Error messages** — backend `ERR_33xx` codes are mapped via `@/lib/error-codes`.
