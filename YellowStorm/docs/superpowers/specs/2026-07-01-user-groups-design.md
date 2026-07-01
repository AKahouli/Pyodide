# User Groups + Mass-Share — Design

**Date:** 2026-07-01
**Status:** Approved

## Summary

Let a user create private **User Groups** (named lists of registered users they pick),
then use a group to mass-share a workspace with all its members in one action.

`team` already exists but models a group of **agents** (org-chart). This is a genuinely
new concept, so we add a **User Group** (sidebar tab: **Groups**).

## Decisions (from brainstorming)

- **Share model — snapshot.** Sharing to a group expands its members into the emails that
  the *existing* workspace-share flow already consumes. No new sharing logic. Later edits to
  a group do NOT affect workspaces already shared.
- **Membership.** Members are registered users only, added via the existing `GET /users/search`.
  Stored as user references (ObjectId).
- **Entry point.** Mass-share lives in the existing **Share Workspace Dialog** (not a separate flow).
- **Privacy.** Groups are fully private to their creator. No sharing groups between users.
- **Naming.** Group name is set/changed freely by the owner; unique per owner.

## 1. Data model — new `user-group` backend module

Location: `back/src/modules/user-group`, mirroring existing module layout
(`schemas / dto / interfaces / user-group.controller.ts / user-group.service.ts / user-group.module.ts / index.ts`).

**`UserGroup` schema**
- `name`: string, required, trim, 2–100
- `description`: string, optional, default `''`, max 2000
- `members`: `Types.ObjectId[]`, `ref: 'User'`, default `[]`
- `createdBy`: `Types.ObjectId`, `ref: 'User'`, required, indexed
- `timestamps: true`, `collection: 'user_groups'`
- Indexes: `{ createdBy: 1 }`, unique `{ name: 1, createdBy: 1 }`
- `toJSON` transform: `_id` → `id`, drop `__v` (match other schemas)

## 2. Backend API (`@Controller('user-groups')`, `@ApiBearerAuth`, owner-scoped)

- `POST   /user-groups` — create `{ name, description?, memberIds?: string[] }`
- `GET    /user-groups` — list mine (members populated: `id, email, firstName, lastName`)
- `GET    /user-groups/:id` — detail with populated members
- `PATCH  /user-groups/:id` — update `{ name?, description? }`
- `DELETE /user-groups/:id`
- `POST   /user-groups/:id/members` — add `{ userIds: string[] }` (idempotent, `$addToSet`)
- `DELETE /user-groups/:id/members/:userId` — remove one

Every read/write asserts `createdBy === currentUser`; otherwise `NotFoundException`
(don't leak existence). Duplicate name per owner → validation/conflict error.

**DTOs:** `create-user-group.dto.ts`, `update-user-group.dto.ts`, `add-members.dto.ts`.
**Interfaces:** `user-group.interface.ts` (response shape: `id, name, description, members[], memberCount, createdAt, updatedAt`).
Register `UserGroupModule` in `AppModule`. Depends on `UserModule` for populate/validation.

## 3. Frontend — new `groups` module

Location: `front/src/modules/groups`, mirroring `modules/team`:
`api.ts / store.ts (zustand) / types.ts / components/ / hooks/ / locales/{en,fr}.json / index.ts`.

- **`GroupsButton`** — sidebar nav button, added to `AppSidebar` after `TeamButton`, routes to `/groups`.
- **`GroupsPage`** — cards list of my groups; create button; edit/delete per card; shows member count.
- **`CreateEditGroupDialog`** — name + description fields + member management. Reuses the existing
  `UserSearchInput` search-and-chip pattern (search users → add chip → remove chip).
- Route `groups` added to `Router.tsx`; endpoints added to `API_ENDPOINTS` config.

## 4. Mass-share integration (zero new sharing logic)

In the existing **`ShareWorkspaceDialog`** (`front/src/modules/workspace/components/ShareWorkspaceDialog/index.tsx`):

- Add a compact **"Share with a group"** row above `UserSearchInput`: a dropdown of my groups
  (loaded from the groups store) + a `read` / `readwrite` selector + an **Add** button.
- Selecting a group + Add **expands its members into the existing `pendingShares` list**
  (one `{ email, permission }` per member), de-duped against emails already pending and against
  the workspace owner's own email.
- The user then clicks the existing **Share** button → existing
  `POST /workspaces/:id/shares` handles the loop. Snapshot semantics.

The groups module exposes a `useGroups()` selector / `fetchGroups()` the dialog consumes; the
dialog does not talk to the group API directly beyond reading the store.

## Testing

- **Backend:** `user-group.service.spec.ts` — CRUD scoped to owner, ownership rejection,
  add/remove members idempotency, duplicate-name rejection.
- **Frontend:** store tests for groups CRUD; a test that "Add group" expands members into
  pending shares with de-dup.

## Out of scope (YAGNI)

- Live/dynamic group shares (membership changes propagating to past shares).
- A backend "share workspace with group" endpoint (expansion is client-side).
- Sharing groups between users; nested groups; free-typed non-registered emails.
