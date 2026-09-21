# Team Module

User-owned **teams** of agents, organised as an editable org-chart hierarchy. A team serves four purposes:

1. **Conversation mentions** — mentioning `@TeamName` in a conversation expands into the team's agents at send time, so a user can address several agents at once.
2. **Org-chart** — agents are arranged into a parent/child hierarchy (with canvas positions) that can be edited and persisted.
3. **Sharing** — a team can be shared with other users by email, with `read` or `write` access.
4. **AI auto-builder** — a team (and any missing agents) can be generated from a natural-language prompt via an LLM.

## Key Features

- **Hierarchy** — `members[]` (rows of `teams.team_members`, keyed by `(team_id, agent_id)`, `position` keeps array order) hold `agentId`, `parentAgentId` (null = root), `order`, and `positionX/Y`. Validated for duplicates, self-references, dangling parents, and cycles.
- **Mention expansion** — `resolveAgentIds(teamIds, userId)` returns the team's agents in BFS (root-first) order; consumed by the conversation send path.
- **Sharing & permissions** — `SharedTeam` records grant `read`/`write`; a `TeamPermissionGuard` + `@RequireTeamPermission` protect owner-only share-management endpoints, while read/write access is enforced in the service for view/edit.
- **AI auto-builder** — `generateTeam` calls `ChatCompletionService` (LiteLLM, **not** the gRPC AI service), parses the JSON plan, creates the proposed agents (reusing an existing agent when the name already exists), validates the hierarchy, and persists the team. Configured via an admin singleton (`TeamAutoBuilderConfig`).
- **Agent details on demand** — for the org-chart, members are enriched with agent name/type/role/description via `AgentService` (owner) or `findByIdsUnrestricted` (shared viewers).
- **Legacy flat teams** — the pre-hierarchy `agentIds` shape no longer exists in Postgres: `teams.team_members` is the only member store. The Mongo→Postgres backfill found no legacy flat team (all 42 source teams used `members`), so nothing was lost; `readMembers` keeps a harmless fallback for such a record shape.

## Module Structure

```
team/
  team.module.ts
  team.service.ts                          # CRUD, hierarchy, mention expansion, generateTeam
  team.service.spec.ts
  controllers/
    team.controller.ts                     # /teams CRUD + hierarchy + generate
    team-share.controller.ts               # /teams/:id/shares...
    admin-team-auto-builder.controller.ts  # /admin/teams/auto-builder-config
  services/
    team-share.service.ts                  # share/list/update/revoke/unshare
    team-auto-builder-config.service.ts    # get/upsert singleton config
  guards/team-permission.guard.ts          # owner | write | read access
  decorators/require-team-permission.decorator.ts
  persistence/
    team.store.ts                          # TEAM_STORE, TEAM_SHARE_STORE, TEAM_AUTO_BUILDER_STORE ports
    pg-team.store.ts                       # PgTeamStore (teams.teams + teams.team_members), PgTeamShareStore (teams.shared_teams), PgTeamAutoBuilderStore (teams.auto_builder_config)
  dto/                                      # create / update / query / hierarchy / share / generate / upsert-config
  interfaces/
    team.interface.ts
    team-auto-builder-config.interface.ts
```

## Endpoints

| Method | Path | Access | Summary |
|--------|------|--------|---------|
| GET | `/teams` | owner | List the user's teams (paginated) |
| GET | `/teams/all` | owner + shared | All teams the user can see (carries `shareInfo`) |
| GET | `/teams/:id` | owner / shared | Team with members enriched with agent details |
| POST | `/teams` | owner | Create a team (optional `agentIds`) |
| POST | `/teams/generate` | owner | AI-generate a team + hierarchy from a prompt |
| PATCH | `/teams/:id` | owner / write | Update name/description/agent list |
| PATCH | `/teams/:id/hierarchy` | owner / write | Replace the full org-chart hierarchy |
| DELETE | `/teams/:id` | owner | Delete a team (and its shares) |
| POST | `/teams/:id/shares` | owner | Share with users by email (`read`/`write`) |
| GET | `/teams/:id/shares` | owner | List a team's shares |
| PATCH | `/teams/:id/shares/:shareId` | owner | Change a share's permission |
| DELETE | `/teams/:id/shares/:shareId` | owner | Revoke a share |
| DELETE | `/teams/:id/unshare` | recipient | Remove a shared team from your own list |
| GET | `/admin/teams/auto-builder-config` | `team_auto_builder.read` | Read auto-builder config |
| PUT | `/admin/teams/auto-builder-config` | `team_auto_builder.update` | Upsert auto-builder config |

## Error Codes

`ERR_3300–3306` (team / hierarchy), `ERR_3307–3311` (sharing), `ERR_3312–3313` (auto-builder). See `modules/exceptions/constants/error-codes.ts`.

## Notes

- **Persistence** — Postgres `teams` schema (`postgres/schema/teams.schema.ts`): `teams` (unique on name + creator), `team_members` (`team_id` and `agent_id` FKs with `ON DELETE CASCADE`, `parent_agent_id` FK `ON DELETE SET NULL`), `shared_teams` (`ON DELETE CASCADE` on the team, unique on team + recipient, permission `read`/`write`) and the singleton `auto_builder_config`. Deleting a team therefore removes its members and shares by FK cascade.
- **Module wiring** — `TeamModule` and `AgentModule` depend on each other via `forwardRef` (agent→team for delete cleanup, team→agent for org-chart population and validation).
- **Admin permissions** — the new `team_auto_builder.read/update` permissions must be granted to the admin role for the config page to be usable.
- **LLM cost** — `generateTeam` creates real agents; validate against a dev account.
