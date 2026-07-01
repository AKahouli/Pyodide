# Public Workspaces — Design

**Date:** 2026-07-01
**Status:** Approved

## Summary

Workspaces are private today (owner-only, plus explicit per-user shares). Add a
per-workspace **Public / Private** switch. A public workspace is readable by
**every logged-in user** with no explicit sharing — read-only (they cannot add
files), usable everywhere a workspace is used, and surfaced in a **Public**
section of the Workspaces hub.

## Decisions (from brainstorming)

- **Reversible toggle.** Owner can flip Public↔Private anytime. While Public,
  sharing is disabled and existing explicit shares are **dormant** (ignored);
  flipping back to Private reactivates them. Nothing is deleted.
- **Audience: all logged-in users.** No anonymous/unauthenticated access; no new
  public/anonymous endpoints. Fits the app's global JWT-guard model.
- **Read-only for everyone but the owner.** Public grants `read`; the owner keeps
  full control. Public users cannot write/add.
- **Discoverable everywhere**, including the conversation workspace picker.
- **Eligibility:** only the owner toggles; **system** workspaces cannot be made
  public (matches sharing, which blocks system workspaces). Personal workspaces
  may be made public (they are shareable today).

## 1. Data model

Add to the `Workspace` schema (`back/src/modules/workspace/schemas/workspace.schema.ts`):

```ts
@Prop({ type: Boolean, default: false, index: true })
isPublic!: boolean;
```

Surface `isPublic` on `WorkspaceResponse` (`mapToResponse`) and on the frontend
`Workspace` type.

## 2. Access enforcement (core)

**`WorkspaceAccessGuard`** (`guards/workspace-access.guard.ts`) — new precedence:

1. owner → role `'owner'`
2. **else `workspace.isPublic` → role `'read'`** (public dominates shares; a
   previously readwrite-shared user is downgraded to read while public — this is
   what makes shares "dormant")
3. else active share → its permission
4. else `ForbiddenException`

`WritePermissionGuard` already blocks the `read` role, so "cannot add to a public
workspace" needs no change.

**`WorkspaceShareService.hasAccess(userId, workspaceId)`** and
**`assertUserHasAccess(userId, workspaceIds[])`** (used by indexing and v2
session creation): treat an `isPublic` workspace as accessible to any user.
- `hasAccess`: return true if owner OR share OR `workspace.isPublic`.
- `assertUserHasAccess`: add public workspaces among the requested ids to the
  accessible set (query `{ _id: { $in }, isPublic: true }`).

## 3. Backend endpoints

**`PATCH /workspaces/:id/visibility`** — body `{ isPublic: boolean }`, guarded by
`WorkspaceOwnerGuard`. New DTO `UpdateVisibilityDto` (`@IsBoolean() isPublic`).
Service `WorkspaceService.setVisibility(workspaceId, ownerId, isPublic)`:
- Load workspace; 404 if missing.
- Reject `isSystem` → `WORKSPACE_PUBLIC_FORBIDDEN_SYSTEM` (new error code).
- Set `isPublic`; leave shares and `shareCount` untouched.
- Return the mapped `WorkspaceResponse`.

(Ownership is already enforced by `WorkspaceOwnerGuard`; the service re-checks
`createdBy` defensively as siblings do.)

**`GET /workspaces/public`** — paginated. `WorkspaceService.findPublic(userId, params)`:
- Query `{ isPublic: true, isSystem: { $ne: true }, createdBy: { $ne: userId } }`
  (exclude the requester's own — they see those under "mine").
- Populate/attach lightweight owner info `{ id, email, firstName, lastName }`.
- Return `PaginatedPublicWorkspaces` of `PublicWorkspaceResponse` (workspace
  display fields + owner; permission is implicitly `read`, no shareId).
- Controller handler placed BEFORE `@Get(':id')` (like the existing
  `@Get('shared-with-me')` / `@Get('personal')`) so the literal path wins.

**`WorkspaceShareService.share()`** — at the top, if `workspace.isPublic` throw
`WORKSPACE_PUBLIC_NO_SHARE` (new error code): a public workspace can't be shared.

New error codes (workspace range in `exceptions/constants/error-codes.ts`):
`WORKSPACE_PUBLIC_NO_SHARE`, `WORKSPACE_PUBLIC_FORBIDDEN_SYSTEM`, with messages.

## 4. Frontend

Types/api/config:
- `Workspace` type gains `isPublic: boolean`. New `PublicWorkspaceResponse` type
  (mirrors `SharedWorkspaceResponse` minus `permission`/`shareId`).
- `API_ENDPOINTS.workspaces`: add `public: '/workspaces/public'` and
  `visibility: (id) => '/workspaces/${id}/visibility'`.
- `workspaceApi`: `getPublicWorkspaces(page)`, `setVisibility(id, isPublic)`.

Store (`modules/workspace/store.ts`):
- State: `publicWorkspaces: PublicWorkspaceResponse[]` (+ loading/pagination like
  shared). Actions: `fetchPublicWorkspaces(page)`, `setWorkspaceVisibility(id, isPublic)`
  (calls PATCH, updates the owned workspace's `isPublic` in place, toast).

Access switch — in the existing **Share Workspace Dialog**
(`components/ShareWorkspaceDialog/index.tsx`):
- A Public/Private `Switch` at the top bound to `shareModalWorkspace.isPublic`.
- When ON: disable the `GroupShareSelector`, `UserSearchInput`, and the invite
  button, and show a note: "This workspace is public — everyone can read it.
  Existing shares are paused. Turn it off to manage individual access." The
  existing shares list may still render (as paused) but permission edits are
  disabled while public.
- Toggling calls `setWorkspaceVisibility`.

Hub (`useWorkspaceHubFilters.ts` + `WorkspaceHubOverview` + `WorkspaceHubPage`):
- Extend `OwnershipFilter` with `'public'`. Add `publicItems` mapped from the
  store's `publicWorkspaces` (read-only items). Add a `public` count to the
  overview and a filtered group rendered as read-only cards; opening one routes
  to the read-only workspace page. `WorkspaceHubPage` calls
  `fetchPublicWorkspaces(1)` on mount.
- "Public" badge on any workspace card where `isPublic` is true (owner's own).

Picker (`components/WorkspaceSelect.tsx`):
- Load `publicWorkspaces` on mount and render a third `CommandGroup` "Public",
  so public workspaces are selectable in conversations.

## 5. Edge cases

- Going public keeps shares + `shareCount` (dormant); returning to private
  reactivates them via the guard (no data change needed).
- A public workspace shows under the owner's "mine" (with a Public badge) and in
  everyone else's "Public" section; `GET /workspaces/public` excludes the
  requester's own to avoid duplication.
- Opening a public workspace you don't own loads the read-only workspace page
  (the `findById` route's `WorkspaceAccessGuard` now grants public read).
- Delete cascade is unchanged (a deleted workspace still removes its shares).

## 6. Testing

**Backend:**
- `WorkspaceAccessGuard`: non-owner gets `read` on a public workspace; write
  path still blocked by `WritePermissionGuard`; public precedence over a
  readwrite share (dormant).
- `setVisibility`: owner-only (via guard), rejects `isSystem`, flips flag,
  leaves shares intact.
- `share()`: rejects when workspace is public.
- `hasAccess` / `assertUserHasAccess`: public workspace accepted for a non-owner.
- `findPublic`: returns only public non-system workspaces, excludes requester's own.

**Frontend:**
- store `fetchPublicWorkspaces` populates list; `setWorkspaceVisibility` updates
  the workspace's `isPublic` and toasts.
- hub `public` filter renders the public group; picker shows the Public group.
- share dialog disables the sharing controls when `isPublic` is true.

## Out of scope (YAGNI)

- Anonymous/unauthenticated public access or public share links.
- "Fork/copy a public workspace to my own"; subscribing/favoriting.
- Making public workspaces writable by non-owners; per-user public permissions.
- Admin moderation / featured public workspaces.
