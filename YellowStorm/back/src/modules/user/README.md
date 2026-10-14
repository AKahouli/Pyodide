# User Module

The user module manages user accounts, profiles, consents, and administrative user operations including suspension, activation, and plan assignment.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Directory Structure](#directory-structure)
- [Data Model](#data-model)
- [User Lifecycle](#user-lifecycle)
- [Profile Completion](#profile-completion)
- [Email Verification](#email-verification)
- [Microsoft Integration](#microsoft-integration)
- [API Endpoints](#api-endpoints)
- [Admin Operations](#admin-operations)
- [User Invitations](#user-invitations)
- [Security](#security)
- [Usage](#usage)
- [Error Handling](#error-handling)

---

## Overview

The user module provides:

- **User Management**: Create, read, update user accounts
- **Profile System**: First name, last name, company with completion workflow
- **Consent Tracking**: Privacy policy and data sharing acceptance with timestamps
- **Email Verification**: Token-based email verification with expiry
- **Microsoft OAuth**: Link Microsoft accounts for SSO
- **Plan Assignment**: Associate users with subscription plans
- **Status Management**: Active, inactive, suspended account states
- **Admin Operations**: List, filter, suspend, activate users; Super Admin registration approve/reject and email invitations
- **RBAC Integration**: Role-based access control via roles reference

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                               USER MODULE                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────┐           ┌─────────────────────┐                   │
│  │   UserController   │           │ AdminUserController │                   │
│  │                    │           │                     │                   │
│  │ GET  /users/me     │           │ GET  /admin/users   │                   │
│  │ PUT  /users/me     │           │ GET  /admin/users/:id│                  │
│  │ POST /complete     │           │ POST /suspend       │                   │
│  └─────────┬──────────┘           │ POST /activate      │                   │
│            │                      │ POST /invite        │                   │
│            │                      │ POST /approve-registration │            │
│            │                      │ POST /reject-registration  │            │
│            │                      │ POST /assign-plan   │                   │
│            │                      └─────────┬───────────┘                   │
│            │                                │                                │
│            └───────────────┬────────────────┘                               │
│                            ▼                                                 │
│                  ┌──────────────────┐                                        │
│                  │   UserService    │                                        │
│                  │                  │                                        │
│                  │ - create()       │                                        │
│                  │ - findById()     │                                        │
│                  │ - findByEmail()  │                                        │
│                  │ - updateProfile()│                                        │
│                  │ - completeProfile()│                                      │
│                  │ - verifyEmail()  │                                        │
│                  │ - generatePasswordResetToken()│                           │
│                  │ - resetPassword()│                                        │
│                  │ - suspendUser()  │                                        │
│                  │ - assignPlan()   │                                        │
│                  └────────┬─────────┘                                        │
│                           │                                                  │
│                           ▼                                                  │
│                  ┌──────────────────┐      ┌────────────────────┐           │
│                  │   PgUserStore    │      │  Related Modules   │           │
│                  │ (identity.users) │      │                    │           │
│                  │                  │◄────►│ - AuthModule       │           │
│                  │ - email          │      │ - UsageModule      │           │
│                  │ - profile        │      │ - AuthorizationModule│         │
│                  │ - consents       │      └────────────────────┘           │
│                  │ - roles          │                                        │
│                  │ - planId         │                                        │
│                  └──────────────────┘                                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **NestJS** | Module framework with dependency injection |
| **Drizzle ORM / PostgreSQL** | User persistence (`identity.users`, `identity.user_roles`) via the `USER_STORE` port and `PgUserStore` |
| **bcrypt** | Password hashing (12 rounds) |
| **crypto** | Token generation for email verification |
| **class-validator** | DTO validation |
| **class-transformer** | Type transformation for query params |

---

## Directory Structure

```
user/
├── index.ts                     # Module exports
├── user.module.ts               # NestJS module definition
├── user.controller.ts           # User-facing API endpoints
├── admin-user.controller.ts     # Admin API endpoints
├── user.service.ts              # Business logic
├── registration-approval.service.ts  # Super Admin registration notice + approve/reject
├── user-invitation.service.ts   # Super-admin email invitations (issue, resolve, consume)
├── persistence/
│   ├── user.store.ts            # USER_STORE port + UserRecord types
│   ├── pg-user.store.ts         # PgUserStore (Drizzle adapter)
│   ├── user-record.mapper.ts    # toUserWire() wire-shape mapper
│   ├── user-invitation.store.ts # USER_INVITATION_STORE port + record types
│   └── pg-user-invitation.store.ts # PgUserInvitationStore (Drizzle adapter)
├── adapters/
│   └── pg-user-lookup.adapter.ts # USER_LOOKUP_PORT implementation
├── interfaces/
│   └── user.interface.ts        # TypeScript interfaces
└── dto/
    ├── complete-profile.dto.ts  # Profile completion validation
    ├── update-profile.dto.ts    # Profile update validation
    └── admin-user.dto.ts        # Admin query/response DTOs
```

---

## Data Model

### User Table

Users live in the Postgres table `identity.users` (Drizzle: `postgres/schema/identity.schema.ts`), accessed through the `USER_STORE` port bound to `PgUserStore`. Ids are 24-char hex strings (`char(24)`). The API wire shape is built by `toUserWire()` in `persistence/user-record.mapper.ts` and keeps the nested `profile`, `appearance` and `consents` objects; in the table they are flat columns:

| Wire field | Column(s) |
|------------|-----------|
| `email` | `email` (`varchar(320)`, unique, CHECK lower-case + trimmed) |
| `passwordHash` | `password_hash` (never serialised) |
| `emailVerified`, verification token / expiry | `email_verified`, `email_verification_token`, `email_verification_expiry` (token never serialised) |
| password reset token / expiry | `password_reset_token`, `password_reset_expiry` (token never serialised) |
| `profile.firstName / lastName / company / role / description` | `first_name`, `last_name`, `company`, `profile_role`, `description` |
| `appearance.colorTheme / language` | `color_theme` (CHECK `default`/`yellow`/`orange`/`blue`), `language` |
| `consents.privacyPolicy / dataSharing` (+ accepted-at) | `consent_privacy_policy`, `consent_privacy_policy_accepted_at`, `consent_data_sharing`, `consent_data_sharing_accepted_at` |
| `profileComplete` | `profile_complete` |
| `microsoftAccountId` | `microsoft_account_id` |
| `planId`, `planSlug`, `planStartedAt` | `plan_id` (plain `char(24)`, no FK), `plan_slug`, `plan_started_at` |
| `roles` | junction table `identity.user_roles` (`user_id` and `role_id` FKs with `ON DELETE CASCADE`; `position` preserves order) |
| `permissionsVersion` | `permissions_version` (integer, default 1) |
| `status` | `status` (CHECK `active`/`inactive`/`suspended`) |
| `registrationApproval` | `registration_approval` (CHECK `pending`/`approved`/`rejected`, nullable) |
| `createdAt`, `updatedAt`, `lastLoginAt` | `created_at`, `updated_at`, `last_login_at` (`timestamptz`) |

Unset optional fields are omitted from the wire shape (never emitted as `null`), and `fullName` is derived by `fullNameOf()` when the JSON is built.

### UserStatus Enum

```typescript
enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}
```

### Database Indexes

| Index | Fields | Purpose |
|-------|--------|---------|
| Unique | `email` (`uq_users_email`) | Prevent duplicate accounts |
| Partial | `microsoft_account_id` WHERE NOT NULL | Microsoft SSO lookup |
| Regular | `plan_id`, `status`, `created_at` (desc) | Plan queries, status filter, recent users list |
| Partial | `email_verification_token` / `password_reset_token` WHERE NOT NULL | Token lookups |
| GIN trigram | `email`, `first_name`, `last_name` | Admin substring search |

### Full Name

`fullNameOf()` (`persistence/user-record.mapper.ts`) computes `fullName` when the wire shape is built: "First Last" when both exist, otherwise whichever exists.

### User Invitations Table

Super-admin invitations live in `identity.user_invitations` (Drizzle: `postgres/schema/identity.schema.ts`), accessed through the `USER_INVITATION_STORE` port bound to `PgUserInvitationStore`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `char(24)` | Primary key |
| `email` | `varchar(320)` | Invited address; CHECK `email = lower(btrim(email))` |
| `token_hash` | `text` | SHA-256 of the raw token; unique (`uq_user_invitations_token_hash`) |
| `invited_by` | `char(24)` | FK to `identity.users(id)`, nullable |
| `expires_at` | `timestamptz` | Issue time + 24h |
| `consumed_at` | `timestamptz` | Set on single-use claim; `NULL` while usable |
| `created_at`, `updated_at` | `timestamptz` | `DEFAULT now()` |

Indexes: `uq_user_invitations_token_hash` (unique), `idx_user_invitations_email`, `idx_user_invitations_expires_at`. Rows are kept after consume for audit.

---

## User Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                      USER LIFECYCLE                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Registration                                                 │
│     ┌─────────────┐                                             │
│     │   User      │  status: ACTIVE                             │
│     │   Created   │  emailVerified: false                       │
│     │             │  profileComplete: false                     │
│     └──────┬──────┘                                             │
│            │                                                     │
│            ▼                                                     │
│  2. Email Verification                                           │
│     ┌─────────────┐                                             │
│     │   Email     │  emailVerified: true                        │
│     │  Verified   │  emailVerificationToken: cleared            │
│     └──────┬──────┘                                             │
│            │                                                     │
│            ▼                                                     │
│  3. Profile Completion                                           │
│     ┌─────────────┐                                             │
│     │  Profile    │  profileComplete: true                      │
│     │  Complete   │  consents.privacyPolicy: true               │
│     └──────┬──────┘                                             │
│            │                                                     │
│            ▼                                                     │
│  4. Active Usage                                                 │
│     ┌─────────────┐                                             │
│     │   Active    │  Full access to application                 │
│     │    User     │                                             │
│     └──────┬──────┘                                             │
│            │                                                     │
│     ┌──────┴──────┐                                             │
│     ▼             ▼                                              │
│  ┌──────┐    ┌──────────┐                                       │
│  │Suspend│   │ Activate │  Admin can toggle status              │
│  └──┬───┘    └────┬─────┘                                       │
│     │             │                                              │
│     └──────┬──────┘                                             │
│            ▼                                                     │
│     status: ACTIVE | SUSPENDED                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Profile Completion

### Purpose

New users must complete their profile before accessing full application features. This ensures:

1. Required information is collected (name, company)
2. Privacy policy is explicitly accepted
3. Data sharing preference is recorded

### Required Fields

| Field | Validation | Required |
|-------|------------|----------|
| `firstName` | string, 1-100 chars | Yes |
| `lastName` | string, 1-100 chars | Yes |
| `company` | string, 1-200 chars | Yes |
| `privacyPolicy` | boolean (must be true) | Yes |
| `dataSharing` | boolean | Yes |

### Flow

```typescript
// POST /users/me/complete-profile
{
  "firstName": "John",
  "lastName": "Doe",
  "company": "Acme Corp",
  "privacyPolicy": true,
  "dataSharing": false
}

// Response
{
  "id": "...",
  "email": "john@example.com",
  "profileComplete": true,
  "profile": {
    "firstName": "John",
    "lastName": "Doe",
    "company": "Acme Corp"
  },
  "consents": {
    "privacyPolicy": true,
    "privacyPolicyAcceptedAt": "2024-01-16T10:00:00Z",
    "dataSharing": false
  }
}
```

---

## Email Verification

### Token Generation

```typescript
const token = crypto.randomBytes(32).toString('hex');
const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
```

### Verification Flow

```
1. User registers
       │
       ▼
2. Service generates token + expiry (24h)
       │
       ▼
3. Email sent with verification link
   (handled by AuthModule)
       │
       ▼
4. User clicks link
       │
       ▼
5. verifyEmail(token) called
       │
       ├── Token not found ──► Error: Invalid token
       │
       ├── Token expired ──► Error: Token expired
       │
       └── Valid ──► emailVerified = true
                     token cleared
```

### Resending Verification

```typescript
const token = await userService.generateEmailVerificationToken(userId);
// Send email with new token (24h expiry)
```

---

## Password Reset

### Token Generation

```typescript
const rawToken = crypto.randomBytes(32).toString('hex');        // 64-char raw token
const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex'); // SHA-256 for storage
const expiry = new Date(Date.now() + passwordResetExpiryHours * 60 * 60 * 1000);
```

### Reset Flow

```
1. User requests password reset
       │
       ▼
2. generatePasswordResetToken(email) called
       │
       ├── User not found ──► return null (no error — prevents enumeration)
       │
       └── User found ──► Generate token, SHA-256 hash, set expiry
                          Return raw token (for email)
       │
       ▼
3. Email sent with reset link containing raw token
       │
       ▼
4. User clicks link, submits new password
       │
       ▼
5. resetPassword(rawToken, newPassword) called
       │
       ├── Hash token, find user by hashed token
       ├── Token not found ──► Error: ERR_1116 (invalid)
       ├── Token expired ──► Clear token, Error: ERR_1117 (expired)
       └── Valid ──► Hash new password, clear reset fields
                     All sessions invalidated
```

### Configuration

Password reset token expiry is configurable via environment variable:

```bash
AUTH_PASSWORD_RESET_EXPIRY_HOURS=1  # Default: 1 hour
```

### Usage

```typescript
// Generate reset token (returns null if email not found)
const rawToken = await userService.generatePasswordResetToken('user@example.com');

// Reset password with token
const user = await userService.resetPassword(rawToken, 'NewSecurePass123');
```

---

## Microsoft Integration

### Linking Accounts

Users can link their Microsoft account for SSO:

```typescript
await userService.linkMicrosoftAccount(userId, microsoftAccountId);
```

### Lookup by Microsoft ID

```typescript
const user = await userService.findByMicrosoftAccountId(microsoftAccountId);
```

### Conflict Prevention

If a Microsoft account is already linked to another user, linking fails:

```typescript
throw new ConflictException(
  ErrorCode.CONFLICT,
  'Microsoft account is already linked to another user'
);
```

---

## API Endpoints

### User Endpoints

All user endpoints require JWT authentication.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/users/me` | Get current user profile |
| `PUT` | `/users/me` | Update profile fields |
| `POST` | `/users/me/complete-profile` | Complete profile (required fields) |

### GET /users/me

Returns the authenticated user's profile with permissions.

**Response:**
```json
{
  "id": "user123",
  "email": "john@example.com",
  "emailVerified": true,
  "profileComplete": true,
  "profile": {
    "firstName": "John",
    "lastName": "Doe",
    "company": "Acme Corp"
  },
  "consents": {
    "privacyPolicy": true,
    "privacyPolicyAcceptedAt": "2024-01-16T10:00:00Z",
    "dataSharing": false,
    "dataSharingAcceptedAt": null
  },
  "plan": {
    "id": "plan123",
    "slug": "professional",
    "startedAt": "2024-01-01T00:00:00Z"
  },
  "status": "active",
  "permissions": ["conversations.create", "workspaces.read"],
  "roleNames": ["user"]
}
```

### PUT /users/me

Update profile fields. Only provided fields are updated.

**Request:**
```json
{
  "firstName": "Jonathan",
  "company": "New Company Inc"
}
```

### POST /users/me/complete-profile

Complete profile with all required fields. Privacy policy must be accepted.

**Request:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "company": "Acme Corp",
  "privacyPolicy": true,
  "dataSharing": false
}
```

---

## Admin Operations

### Admin Endpoints

All admin endpoints require `PermissionsGuard` with specific permissions.

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| `GET` | `/admin/users` | `USERS_READ` | List users with pagination/filtering |
| `GET` | `/admin/users/:id` | `USERS_READ` | Get user by ID |
| `POST` | `/admin/users/:id/suspend` | `USERS_SUSPEND` | Suspend user account |
| `POST` | `/admin/users/:id/activate` | `USERS_ACTIVATE` | Activate a **suspended** user |
| `POST` | `/admin/users/:id/approve-registration` | `SUPER_ADMIN` (`*`) | Approve a pending classic registration |
| `POST` | `/admin/users/:id/reject-registration` | `SUPER_ADMIN` (`*`) | Reject a pending classic registration |
| `POST` | `/admin/users/:id/assign-plan` | `USERS_ASSIGN_PLAN` | Assign plan to user |
| `POST` | `/admin/users/invite` | `SUPER_ADMIN` (`*`) | Send an email invitation to a new address |

### GET /admin/users

List users with filtering and pagination.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Items per page (max 100) |
| `search` | string | - | Search email, firstName, lastName |
| `status` | enum | - | Filter by status |
| `emailVerified` | boolean | - | Filter by email verified |
| `profileComplete` | boolean | - | Filter by profile complete |
| `sortBy` | string | createdAt | Sort field |
| `sortOrder` | asc/desc | desc | Sort direction |

**Response:**
```json
{
  "users": [
    {
      "id": "user123",
      "email": "john@example.com",
      "emailVerified": true,
      "profileComplete": true,
      "profile": {
        "firstName": "John",
        "lastName": "Doe",
        "company": "Acme Corp"
      },
      "status": "active",
      "registrationApproval": "approved",
      "plan": {
        "id": "plan123",
        "slug": "professional",
        "startedAt": "2024-01-01T00:00:00Z"
      },
      "roles": [
        { "id": "role123", "name": "user" }
      ],
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-16T10:00:00Z",
      "lastLoginAt": "2024-01-16T09:00:00Z"
    }
  ],
  "total": 150,
  "page": 1,
  "limit": 20,
  "totalPages": 8
}
```

### POST /admin/users/:id/suspend

Suspend a user account. Suspended users cannot log in.

**Response:**
```json
{ "message": "User suspended successfully" }
```

### POST /admin/users/:id/activate

Reactivate a **suspended** user account. Do not use this to approve a pending classic registration.

**Response:**
```json
{ "message": "User activated successfully" }
```

### POST /admin/users/:id/approve-registration

Super Admin only (`*`). Sets `status: active` and `registrationApproval: approved`. Sends a best-effort confirmation email. Re-approving an already approved user is a 200 no-op. Approving a rejected user is allowed.

**Response:**
```json
{ "message": "Registration approved" }
```

### POST /admin/users/:id/reject-registration

Super Admin only (`*`). Leaves `status: inactive` and sets `registrationApproval: rejected`. No email is sent. Re-rejecting an already rejected user is a 200 no-op.

**Response:**
```json
{ "message": "Registration rejected" }
```

### POST /admin/users/:id/assign-plan

Assign a subscription plan to a user.

**Request:**
```json
{ "planId": "plan123" }
```

**Response:** Updated `AdminUserResponse`

### POST /admin/users/invite

Super Admin only (`*`). Emails a new address a unique invitation link. Rejects an address that already has an account with `409 USER_ALREADY_EXISTS`. Re-inviting the same address supersedes any still-pending invitation, so only the newest link stays usable. A transport failure surfaces as `503 ERR_1203` and the just-created row is removed, so no undiscoverable pending invite is left behind. Audits `users.invite` on success.

**Request:**
```json
{ "email": "invitee@example.com" }
```

**Response:**
```json
{
  "message": "Invitation sent successfully",
  "email": "invitee@example.com",
  "expiresAt": "2026-10-15T13:45:39.295Z"
}
```

---

## User Invitations

A Super Admin invites a user by email from `/#/admin/users`. The invitee receives a professional HTML email whose unique link (`{APP_FRONTEND_URL}/#/?invite=<token>`) resolves server-side and opens the **existing** register modal with the invited address pre-filled and read-only.

```text
1. Super Admin → POST /admin/users/invite { email }
   ├── address already has an account → 409 USER_ALREADY_EXISTS
   ├── UserInvitationService.invite()
   │   ├── supersede still-pending invites for the address (consumePendingForEmail)
   │   ├── randomBytes(32) base64url  → raw token (email only)
   │   ├── SHA-256 hash               → identity.user_invitations.token_hash
   │   ├── expires_at = now + 24h, invited_by = acting admin
   │   └── render EmailTemplate.USER_INVITE + send (row deleted if the send fails)
   └── audit users.invite

2. Invitee opens the link → frontend GET /auth/invite?token=<token>
   ├── unknown / consumed → ERR_1132 ; expired → ERR_1133
   └── valid → { email, expiresAt } → register modal, address locked

3. Invitee submits POST /auth/register { email, password, inviteToken }
   ├── assertUsableForEmail(token, email)  (before user creation)
   │   └── token bound to another address → ERR_1134
   ├── user created (inactive, pending approval)
   └── markConsumed(token)  (single-use claim, after the user exists)
```

### Token & single-use rules

- The raw token exists **only** in the email link; only its SHA-256 hash is stored (same at-rest rule as the password-reset / app-share tokens).
- Validity is **exactly 24 hours** (`USER_INVITATION_TTL_HOURS`), enforced server-side against `expires_at`.
- Single use is enforced by an atomic conditional claim (`PgUserInvitationStore.consumeIfValid` — `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now()`), so two concurrent registrations can never both win.
- Re-inviting an address supersedes its still-pending invitations (`consumePendingForEmail` marks them consumed), so at most one invitation is usable at a time. If the invitation email cannot be sent, the just-created row is deleted (best-effort) so no undiscoverable pending invite lingers.
- The invitation is claimed **after** the user row is created, so a failed or rejected registration never burns the link. A lost concurrent claim is a handled outcome — the account already exists, so it is neither thrown nor reported as an HTTP failure (the `201` registration response is the terminal outcome).
- The invite is a pre-fill/binding only: the invitee still verifies their email and waits for Super Admin approval (`POST /admin/users/:id/approve-registration`).

### Refused-invite telemetry

`GET /auth/invite` and the `inviteToken` branch of `POST /auth/register` emit `http.request.failed` (method, route, status) on refusal; a failed send emits `dependency.request.failed` (`dependency: 'smtp'`, `operation: 'user_invitation.send'`, `attempt`). A lost single-use claim after the user is created is not reported as an `http.request.failed`, since the registration request itself succeeded. No new event names are registered.

### Refused-invite telemetry

`GET /auth/invite` and the `inviteToken` branch of `POST /auth/register` emit `http.request.failed` (method, route, status) on refusal; a failed send emits `dependency.request.failed` (`dependency: 'smtp'`, `operation: 'user_invitation.send'`, `attempt`). No new event names are registered.

---

## Security

### Password Hashing

Passwords are hashed using bcrypt with 12 rounds:

```typescript
private readonly bcryptRounds = 12;
const passwordHash = await bcrypt.hash(password, this.bcryptRounds);
```

### Sensitive Field Protection

`passwordHash`, `emailVerificationToken` and `passwordResetToken` are stored as columns on `identity.users` and are present on the internal `UserRecord`, but `toUserWire()` never emits them, so they are absent from every API response.

### Audit Logging

All admin operations are logged:

```typescript
this.auditLogService.logSuccess({
  actorId: actor._id.toString(),
  actorEmail: actor.email,
  action: 'users.suspend',
  targetId: userId,
  targetType: 'User',
  metadata: { targetEmail: user.email },
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
});
```

---

## Usage

### Importing the Module

```typescript
import { UserModule, UserService } from '@modules/user';

@Module({
  imports: [UserModule],
})
export class SomeModule {
  constructor(private readonly userService: UserService) {}
}
```

### Creating a User

```typescript
const user = await userService.create({
  email: 'john@example.com',
  password: 'securePassword123',
  profile: {
    firstName: 'John',
    lastName: 'Doe',
  },
  emailVerified: false,
});
```

### Finding Users

```typescript
// By ID
const user = await userService.findById('user123');

// By email
const user = await userService.findByEmail('john@example.com');

// By Microsoft account
const user = await userService.findByMicrosoftAccountId('ms-account-id');

// With sensitive fields (for auth)
const user = await userService.findByEmailWithSensitiveFields('john@example.com');
```

### Validating Password

```typescript
const isValid = await userService.validatePassword(user, 'attemptedPassword');
```

### Updating Last Login

```typescript
await userService.updateLastLogin(userId);
```

### Assigning Plans

```typescript
const updatedUser = await userService.assignPlan(
  userId,
  planId,
  'professional'
);
```

### Getting Users Without Plans

```typescript
// For migration or bulk assignment
const users = await userService.getUsersWithoutPlan(100);
```

---

## Error Handling

### Error Codes

| Code | Scenario |
|------|----------|
| `USER_NOT_FOUND` | User ID does not exist |
| `USER_ALREADY_EXISTS` | Email already registered |
| `USER_INVITE_EMAIL_FAILED` (`ERR_1203`) | Invitation email could not be sent (503) |
| `AUTH_INVITE_TOKEN_INVALID` (`ERR_1132`) | Invitation token invalid or already used |
| `AUTH_INVITE_TOKEN_EXPIRED` (`ERR_1133`) | Invitation token expired |
| `AUTH_INVITE_EMAIL_MISMATCH` (`ERR_1134`) | Invitation was issued for a different email |
| `CONFLICT` | Microsoft account already linked |
| `BadRequest` | Privacy policy not accepted |
| `BadRequest` | Invalid/expired verification token |

### Examples

```typescript
// User not found
throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'User not found');

// Duplicate email
throw new ConflictException(ErrorCode.USER_ALREADY_EXISTS, 'Email already registered');

// Profile validation
if (!data.privacyPolicy) {
  throw new BadRequestException('Privacy policy must be accepted');
}
```

---

## Response Interfaces

### UserResponse (User-facing)

```typescript
interface UserResponse {
  id: string;
  email: string;
  emailVerified: boolean;
  profileComplete: boolean;
  profile: IUserProfile;
  consents: IUserConsents;
  plan?: IUserPlan;
  status: UserStatus;
  permissions?: string[];   // From JWT payload
  roleNames?: string[];     // From JWT payload
}
```

### AdminUserResponse (Admin-facing)

```typescript
interface AdminUserResponse {
  id: string;
  email: string;
  emailVerified: boolean;
  profileComplete: boolean;
  profile: IUserProfile;
  status: UserStatus;
  plan?: {
    id: string;
    slug: string;
    startedAt?: Date;
  };
  roles: { id: string; name: string }[];
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
}
```

### InviteUserResponse (Admin-facing)

```typescript
interface InviteUserResponse {
  message: string;
  email: string;
  expiresAt: Date;
}
```
