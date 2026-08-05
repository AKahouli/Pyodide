# Human Agents — Design

**Date:** 2026-08-04
**Branch:** `feature/human_agent`
**Scope:** `back/` (NestJS + Mongoose) and `front/` (React + Vite)

---

## 1. Concept

Every user has **exactly one** "human agent": an `Agent` of type `humain` that
represents the user — a clone built from their profile. The `humain` agent type
is assumed to already exist (created in the admin panel); this feature does **not**
seed it.

The human agent is:
- **Owned by the user** — `createdBy = userId`.
- **Unique per user** — identified by `{ createdBy, agentType: <humain type id> }`,
  so a user can never have more than one.
- **A mirror of the profile** — its `role` and `description` reflect the user's
  profile fields and are kept in sync automatically.

The `humain` agent-type slug constant (`HUMAIN_AGENT_TYPE_SLUG = 'humain'`) and the
public listing endpoint (`GET /public/agents` → `findHumainAgentsPublic`) already
exist on this branch. This feature fills the missing piece: **auto-creating and
maintaining one human agent per user**.

## 2. Data model (backend)

Add two optional fields to `UserProfile` (`back/src/modules/user/schemas/user.schema.ts`):

| Field         | Type     | Default | Constraints        | Meaning                          |
|---------------|----------|---------|--------------------|----------------------------------|
| `role`        | `string` | `''`    | maxlength ~200     | Job title, e.g. "Product Manager"|
| `description` | `string` | `''`    | maxlength 1000     | Free-text bio                    |

**Source of truth:** the User profile. The human agent mirrors these values; the
profile page is the single place a user edits them.

**Agent `role` field note:** an `Agent`'s own `role` is `required` and doubles as
its system prompt (maxlength 50000). When the user's profile role is empty (e.g.
existing users on first login), the human agent is seeded with a minimal generated
prompt — `You are {fullName}, a human agent.` (fallback to email local-part when no
name yet) — to satisfy the `required` constraint. It is overwritten with the real
role once the profile provides one.

## 3. New service: `HumainAgentService`

Lives in the agent module (`back/src/modules/agent/services/`). Two idempotent
operations, both reusing existing codebase patterns (`findOneAndUpdate` upsert,
lookup-by-slug):

### `ensureForUser(userId)`
1. Look up the `humain` agent type by slug. **If it does not exist, log a warning
   and return** (never throw — the feature degrades gracefully).
2. If the user already has a human agent (`{ createdBy: userId, agentType }`),
   return it unchanged.
3. Otherwise create one:
   - `name` / `slug` derived from the user's full name; fallback to the email
     local-part when the profile has no name yet.
   - `role` = profile role, or the generated placeholder prompt when empty.
   - `description` = profile description, or `''`.
   - `createdBy = userId`, `agentType = <humain type id>`.

### `syncFromProfile(userId)`
Update the existing human agent's `name`, `role`, and `description` to match the
current profile. Calls `ensureForUser` first so it is safe even if the agent does
not exist yet.

**Idempotency & uniqueness:** existing unique indexes are `{ name, createdBy }` and
per-user slug uniqueness (`agent.schema.ts`). Because the upsert query keys on
`{ createdBy, agentType }`, only ever the single human-agent document is touched.
Name derivation must tolerate collisions with a user's other agents (e.g. suffix the
slug) — covered by tests.

## 4. Hook points

All calls are wrapped in `try/catch` and logged — a human-agent failure must **never**
break authentication or profile saving.

| Trigger | Location | Call | Purpose |
|---|---|---|---|
| **Login** | `auth.service.ts` → `login()` | `ensureForUser` | Gives already-registered users a human agent (empty role/description) on next login. |
| **Registration** | `auth.service.ts` → `register()` | `ensureForUser` | New users start with a human agent immediately, alongside the existing workspace-creation block. |
| **Profile completion** | `user.service.ts` → `completeProfile()` | `syncFromProfile` | Pushes the newly entered role/description (and name) into the agent. |
| **Profile update** | `user.service.ts` → `updateProfile()` | `syncFromProfile` | Keeps the agent in sync when the user later edits their profile. |

## 5. Frontend

- **`front/src/modules/auth/components/ProfileCompletionPage.tsx`** — add `role` and
  `description` inputs to the form, with matching Zod schema entries and en/fr i18n
  strings.
- **Profile edit page** — add the same two fields so users can change them later.
- **DTOs** — add optional `role` and `description` to `CompleteProfileDto` and
  `UpdateProfileDto` (backend), and mirror the fields in the frontend TS types
  (there are no shared types between back and front — both sides must be updated).

## 6. Testing (TDD)

**Backend unit — `HumainAgentService`:**
- `ensureForUser` creates exactly one agent, then is a no-op on second call (idempotent).
- `ensureForUser` returns/skips gracefully when the `humain` agent type is missing.
- Name/slug derivation handles collisions with the user's existing agents.
- `syncFromProfile` updates `role`/`description`/`name` on the existing agent.

**Backend integration:**
- `login()` creates a human agent for a user who lacks one; is a no-op for a user
  who already has one.
- `completeProfile()` writes role/description through to the human agent.

**Frontend:**
- Profile-completion form validates and submits the new `role`/`description` fields.

## 7. Out of scope

- Seeding the `humain` agent type (assumed created in admin).
- Changing what a human agent *does* at runtime (chat behaviour, A2A, the public
  listing endpoint) — those already exist; this feature only handles creation and
  profile sync.
- Backfilling human agents for existing users in bulk — they are created lazily on
  next login.
