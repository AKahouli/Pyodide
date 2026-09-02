# Authentication Module (Backend)

The authentication module provides secure user authentication with JWT tokens, session management, email verification, password reset, Super Admin review of classic signups, and security features like token rotation and new login location alerts.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Directory Structure](#directory-structure)
- [Security Features](#security-features)
- [Authentication Flow](#authentication-flow)
- [Classic Registration Approval](#classic-registration-approval)
- [Token Strategy](#token-strategy)
- [Session Management](#session-management)
- [API Endpoints](#api-endpoints)
- [Guards & Decorators](#guards--decorators)
- [DTOs](#dtos)
- [Interfaces](#interfaces)
- [Configuration](#configuration)
- [Error Codes](#error-codes)
- [Email Notifications](#email-notifications)

---

## Overview

The authentication module provides:

- **User Registration**: Email/password registration with email verification; classic signups start `inactive` and `pending` Super Admin review
- **Login/Logout**: Secure authentication with JWT access tokens; `suspended` accounts cannot obtain a session; `inactive` pending users can sign in and complete their profile, then wait for Super Admin approval in-app
- **Refresh Token Rotation**: Secure token refresh with reuse detection
- **Session Management**: View and revoke active sessions
- **Email Verification**: Magic link verification flow
- **Password Reset**: Forgot password / reset password flow with secure tokens
- **Security Alerts**: New login location notifications
- **RBAC Integration**: Role-based permissions embedded in JWT

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AUTHENTICATION MODULE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐       │
│  │  AuthController  │───►│   AuthService    │───►│  Session Schema  │       │
│  │  (REST API)      │    │ (Business Logic) │    │    (MongoDB)     │       │
│  └────────┬─────────┘    └────────┬─────────┘    └──────────────────┘       │
│           │                       │                                          │
│           │                       ▼                                          │
│           │              ┌──────────────────┐                                │
│           │              │    JwtService    │                                │
│           │              │ (Token Signing)  │                                │
│           │              └──────────────────┘                                │
│           │                       │                                          │
│           │                       ▼                                          │
│           │              ┌──────────────────────────────┐                    │
│           │              │ RegistrationApprovalService  │                    │
│           │              │ (UserModule — Super Admin    │                    │
│           │              │  registration notice)        │                    │
│           │              └──────────────────────────────┘                    │
│           │                                                                  │
│           ▼                                                                  │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐       │
│  │   JwtAuthGuard   │───►│   JwtStrategy    │───►│   UserService    │       │
│  │  (Global Guard)  │    │ (Token Validate) │    │  (User Lookup)   │       │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘       │
│                                                                              │
│  External Dependencies:                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ UserModule  │  │ EmailModule │  │ UsageModule │  │ AuthzModule │         │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **NestJS 10** | Backend framework with dependency injection |
| **Passport.js** | Authentication middleware |
| **passport-jwt** | JWT strategy for Passport |
| **@nestjs/jwt** | JWT token signing and verification |
| **bcrypt** | Password hashing (12 rounds default) |
| **MongoDB/Mongoose** | Session storage with TTL indexes |
| **ua-parser-js** | User agent parsing for device info |
| **crypto** | Secure token generation |

---

## Directory Structure

```
auth/
├── auth.module.ts              # Module definition
├── auth.controller.ts          # REST API endpoints
├── auth.service.ts             # Authentication business logic
├── index.ts                    # Public exports
├── strategies/
│   └── jwt.strategy.ts         # Passport JWT strategy
├── guards/
│   └── jwt-auth.guard.ts       # Global authentication guard
├── decorators/
│   ├── public.decorator.ts     # @Public() - bypass auth
│   └── current-user.decorator.ts # @CurrentUser() - get user
├── schemas/
│   └── session.schema.ts       # Session/refresh token model
├── interfaces/
│   ├── auth.interface.ts       # Auth response types
│   ├── jwt-payload.interface.ts # JWT token payload
│   └── session.interface.ts    # Session types
└── dto/
    ├── register.dto.ts         # Registration validation
    ├── login.dto.ts            # Login validation
    ├── verify-email.dto.ts     # Email verification
    ├── forgot-password.dto.ts  # Forgot password (email)
    ├── reset-password.dto.ts   # Reset password (token + new password)
    └── microsoft-auth.dto.ts   # OAuth (future)
```

---

## Security Features

### 1. Password Security

- **Hashing**: bcrypt with configurable rounds (default: 12)
- **Validation**: Minimum 8 chars, requires uppercase, lowercase, and number
- **Storage**: Only hash stored, never plaintext

### 2. Token Security

- **Access Token**: Short-lived (15 min default), contains user permissions
- **Refresh Token**: Long-lived (7 days), stored as bcrypt hash
- **Token Rotation**: New refresh token issued on each refresh
- **Reuse Detection**: Token family tracking detects stolen tokens

### 3. Session Security

- **Session Binding**: Access tokens include sessionId for immediate revocation
- **Device Tracking**: User agent parsed and stored with session
- **IP Tracking**: Login IP addresses stored for security alerts
- **Max Sessions**: Limit per user (default: 10), oldest evicted

### 4. Cookie Security

- **HTTP-Only**: Refresh token in HTTP-only cookie (not accessible via JS)
- **Secure**: HTTPS-only in production
- **SameSite**: Configurable (strict/lax/none)
- **Path Scoped**: Cookie only sent to `/api/v1/auth`

### 5. Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/auth/register` | 5 | 1 minute |
| `/auth/login` | 10 | 1 minute |
| `/auth/refresh` | 30 | 1 minute |
| `/auth/verify-email` | 5 | 1 minute |
| `/auth/resend-verification` | 3 | 5 minutes |
| `/auth/forgot-password` | 3 | 5 minutes |
| `/auth/reset-password` | 5 | 1 minute |

---

## Authentication Flow

### Registration Flow

```
1. POST /auth/register { email, password }
2. AuthService.register()
   ├── UserService.create()
   │   ├── hash password, generate verification token
   │   └── persist status: inactive, registrationApproval: pending
   ├── UsageService.getDefaultPlan() - get free plan
   ├── UserService.assignPlan() - assign to new user
   ├── Send verification email (best-effort)
   └── RegistrationApprovalService.notifySuperAdminsOfRegistration() (best-effort)
3. Return { message, userId }
4. User clicks email link
5. GET /auth/verify-email?token=xxx
6. UserService.verifyEmail() - mark emailVerified: true
   (status and registrationApproval are unchanged)
```

New OAuth users are not in this flow (`createOAuthUser` still defaults to `active`). Completing email verification does **not** activate the account.

### Login Flow

```
1. POST /auth/login { email, password }
2. AuthService.login()
   ├── UserService.findByEmail()
   ├── assertAccountAccessible(user)
   │   └── status === 'suspended' → ERR_1110
   ├── UserService.validatePassword() - bcrypt compare
   ├── Check emailVerified === true
   ├── Check for new login location
   ├── AuthService.generateTokens()
   │   ├── Create session with hashed refresh token
   │   ├── Get permissions from AuthorizationService
   │   ├── Sign access token with permissions in payload
   │   └── Return { accessToken, refreshToken, expiresIn }
   ├── UserService.updateLastLogin()
   └── Send new location alert (async, if new IP)
3. Set refresh token in HTTP-only cookie
4. Return { accessToken, expiresIn, user }
```

### Token Refresh Flow

```
1. POST /auth/refresh (refresh token in cookie)
2. AuthService.refreshTokens()
   ├── Parse sessionId from token (format: sessionId.randomBytes)
   ├── Find session by ID
   ├── Verify session.isValid (detect reuse)
   ├── Verify session not expired
   ├── bcrypt.compare(token, session.refreshTokenHash)
   ├── Get user; if suspended, invalidate all sessions and deny (ERR_1110)
   ├── Invalidate old session (isValid = false)
   ├── Create new session in same tokenFamily
   ├── Fetch fresh permissions (propagate role changes)
   └── Sign new access token
3. Set new refresh token in cookie
4. Return { accessToken, expiresIn }
```

### Logout Flow

```
1. POST /auth/logout
2. AuthService.logout()
   └── Set session.isValid = false
3. Clear refresh token cookie
4. Return { message: 'Logged out successfully' }
```

### Forgot Password Flow

```
1. POST /auth/forgot-password { email }
2. AuthService.forgotPassword()
   ├── UserService.generatePasswordResetToken(email)
   │   ├── Lookup user by email (lowercase)
   │   ├── If not found → return null (no exception)
   │   ├── Generate crypto.randomBytes(32) → 64-char hex raw token
   │   ├── SHA-256 hash raw token → store in DB
   │   ├── Set passwordResetExpiry (default 1h)
   │   └── Return raw token
   ├── If token → send password reset email
   └── If null → log debug, do nothing
3. Always return { message: 'If an account exists...' }
```

### Reset Password Flow

```
1. POST /auth/reset-password { token, password }
2. AuthService.resetPassword()
   ├── UserService.resetPassword(token, password)
   │   ├── SHA-256 hash incoming token
   │   ├── Find user by hashed token
   │   ├── If not found → throw ERR_1116 (invalid)
   │   ├── If expired → clear token, throw ERR_1117 (expired)
   │   ├── Hash new password with bcrypt (12 rounds)
   │   ├── Update passwordHash, clear reset fields
   │   └── Return user document
   ├── InvalidateAllUserSessions(user._id)
   └── Log success
3. Return { message: 'Password has been reset successfully...' }
```

**Security measures:**

| Concern | Mitigation |
|---------|-----------|
| Email enumeration | `forgotPassword` always returns generic success |
| Token in DB compromised | SHA-256 hash stored, raw token only in email |
| Brute force | 64-char hex = 256 bits entropy + rate limiting |
| Token replay | Single-use: cleared after successful reset |
| Stale tokens | 1-hour expiry, cleared on expiry check |
| Session hijacking post-reset | All sessions invalidated via `invalidateAllUserSessions` |

---

## Classic Registration Approval

Classic email/password signups wait for Super Admin review. Completing email verification does **not** activate the account.

| Field | Classic `UserService.create()` | OAuth `createOAuthUser()` |
|-------|-------------------------------|---------------------------|
| `status` | `inactive` (explicit) | schema default `active` |
| `registrationApproval` | `pending` | omitted |
| Email verification | required before login | already verified by provider |
| Super Admin notice | yes, after verification email | no |

Approve and reject live on the **user admin API** (not this auth module):

| Method | Endpoint | Permission |
|--------|----------|------------|
| `POST` | `/admin/users/:id/approve-registration` | `*` (Super Admin) |
| `POST` | `/admin/users/:id/reject-registration` | `*` (Super Admin) |

`users.*` (regular admin) cannot call these routes. `POST /admin/users/:id/activate` remains **suspended → active** only.

| Action | `status` | `registrationApproval` | User email |
|--------|----------|------------------------|------------|
| Approve | `inactive` → `active` | `approved` | confirmation (best-effort) |
| Reject | stays `inactive` | `rejected` | none |

Re-approve already `approved` / re-reject already `rejected` → 200 no-op. Approving a rejected account is allowed (recovery). UsersPage Valider/Refuser is Super Admin only; email deep-links open the confirmation dialog (`decision=approve` or `decision=reject`).

### Account access gates

`assertAccountAccessible` / `getAccountAccessDenial` live in the user module and block **suspended** accounts from obtaining or keeping a session:

| Surface | Inactive | Suspended (`ERR_1110`) |
|---------|----------|------------------------|
| `AuthService.login()` | Allowed | Forbidden, before password check |
| `AuthService.refreshTokens()` | Allowed | Forbidden + all sessions invalidated |
| `JwtStrategy.validate()` | Allowed | Unauthorized |
| OAuth login of an **existing** linked user | Allowed | Forbidden |

Inactive classic users can sign in and call `/auth/*` plus `/users/me*`. `AccountApprovalGuard` (global, after JWT) returns `ERR_1202` on every other API until Super Admin approval.

Helper messages:

- Suspended: `Account is suspended`
- Inactive (feature guard / in-app banner): `This account is inactive pending approval.`

### Super Admin notification (best-effort)

After the verification email, `AuthService.register()` calls `RegistrationApprovalService.notifySuperAdminsOfRegistration()`. Failures never fail registration (SMTP down, send error, missing role, or no recipients → log/warn).

Recipients: users with role `super_admin` and `status: active`. One email per recipient (other Super Admin addresses are not exposed in To/CC).

Email links (hash router; Super Admin must already be signed in):

```
{APP_FRONTEND_URL}/#/admin/users?status=inactive&review={userId}&decision=approve
{APP_FRONTEND_URL}/#/admin/users?status=inactive&review={userId}&decision=reject
```

These open the admin users page. They are **not** one-click approve/reject tokens.

`RegistrationApprovalService.approveRegistration()` / `rejectRegistration()` run from `AdminUserController` (permission `*`). Approve sends a best-effort confirmation email to the applicant (`{APP_FRONTEND_URL}/#/`). Mail failure does not roll back the approval.

---

## Token Strategy

### Access Token (JWT)

```typescript
interface JwtPayload {
  sub: string;              // userId
  email: string;
  type: 'access';
  sessionId: string;        // For immediate revocation
  permissions: string[];    // ['users:read', 'chat:write']
  roleNames: string[];      // ['admin', 'user']
  permissionsVersion: number; // For permission change detection
  iat: number;              // Issued at
  exp: number;              // Expires at
}
```

**Properties:**
- Signed with HS256 using JWT_SECRET
- Contains user permissions (no DB lookup needed for auth checks)
- sessionId enables immediate revocation on logout
- Short expiry (15 min) limits exposure window

### Refresh Token

```
Format: {sessionId}.{randomBytes32}
Example: 507f1f77bcf86cd799439011.a1b2c3d4e5f6...
```

**Properties:**
- Session ID for lookup, random bytes for verification
- Random portion hashed with bcrypt before storage
- Token family tracks rotation chain for reuse detection
- Long expiry (7 days) for convenience
- Stored in HTTP-only cookie

---

## Session Management

### Session Schema

```typescript
class Session {
  userId: ObjectId;           // Reference to user
  refreshTokenHash: string;   // bcrypt hash of token
  deviceInfo: {
    userAgent: string;
    browser?: string;
    browserVersion?: string;
    os?: string;
    osVersion?: string;
    device?: string;
    deviceType?: string;      // 'desktop' | 'mobile' | 'tablet'
  };
  ipAddress: string;
  isValid: boolean;           // false = revoked
  expiresAt: Date;            // TTL for auto-cleanup
  lastActivityAt?: Date;
  tokenFamily: string;        // For reuse detection
  createdAt: Date;
  updatedAt: Date;
}
```

### Database Indexes

```javascript
{ userId: 1, isValid: 1 }     // Active session queries
{ expiresAt: 1 }              // TTL index (auto-delete expired)
{ tokenFamily: 1 }            // Token reuse detection
```

### Token Reuse Detection

When an old refresh token is used:

```
1. Session found but isValid = false
2. Potential attack: attacker using stolen old token
3. Invalidate ALL sessions in tokenFamily
4. Log security warning
5. Throw UnauthorizedException
```

---

## API Endpoints

### Public Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register new user |
| POST | `/auth/login` | Login with credentials |
| POST | `/auth/refresh` | Refresh access token |
| GET | `/auth/verify-email?token=xxx` | Verify email address |
| POST | `/auth/resend-verification-public` | Resend verification (token-based, no auth) |
| POST | `/auth/forgot-password` | Request password reset email |
| POST | `/auth/reset-password` | Reset password with token |

### Protected Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/logout` | Logout current session |
| POST | `/auth/resend-verification` | Resend verification email |
| GET | `/auth/sessions` | List active sessions |
| DELETE | `/auth/sessions/:sessionId` | Revoke specific session |

### Request/Response Examples

**Register:**
```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123"
}
```

```json
{
  "success": true,
  "data": {
    "message": "Registration successful. Please check your email to verify your account.",
    "userId": "507f1f77bcf86cd799439011"
  }
}
```

The created user is `inactive` with `registrationApproval: pending`. Login succeeds after email verification; app features stay blocked (`ERR_1202`) until a Super Admin calls `POST /admin/users/:id/approve-registration`.

**Login:**
```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123"
}
```

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 900,
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "email": "user@example.com",
      "emailVerified": true,
      "profileComplete": false,
      "profile": {},
      "consents": {},
      "plan": {
        "id": "...",
        "slug": "free"
      },
      "status": "active"
    }
  }
}
```

**Refresh (cookie-based):**
```http
POST /api/v1/auth/refresh
Cookie: refresh_token=507f1f77bcf86cd799439011.a1b2c3d4...
```

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 900
  }
}
```

**Forgot Password:**
```http
POST /api/v1/auth/forgot-password
Content-Type: application/json

{
  "email": "user@example.com"
}
```

```json
{
  "success": true,
  "data": {
    "message": "If an account exists with this email, a password reset link has been sent."
  }
}
```

**Reset Password:**
```http
POST /api/v1/auth/reset-password
Content-Type: application/json

{
  "token": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6abcd",
  "password": "NewSecurePass123"
}
```

```json
{
  "success": true,
  "data": {
    "message": "Password has been reset successfully. Please sign in with your new password."
  }
}
```

---

## Guards & Decorators

### JwtAuthGuard (Global)

Applied globally to all routes. Validates JWT access tokens.

```typescript
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    // Skip OPTIONS requests (CORS preflight)
    // Skip routes with @Public() decorator
    // Otherwise validate JWT
  }
}
```

### JwtStrategy

Passport strategy for JWT validation.

```typescript
async validate(payload: JwtPayload) {
  // 1. Verify token type is 'access'
  // 2. Check session is still valid (enables immediate revocation)
  // 3. Load user from database
  // 4. Deny suspended (ERR_1110); inactive pending users may keep a session
  // 5. Attach permissions to user object
  return user;
}
```

### @Public() Decorator

Bypass authentication for specific routes.

```typescript
@Public()
@Post('register')
async register(@Body() dto: RegisterDto) { ... }
```

### @CurrentUser() Decorator

Extract authenticated user from request.

```typescript
@Get('profile')
async getProfile(@CurrentUser() user: UserDocument) {
  return user;
}

// Or extract specific field
@Get('email')
async getEmail(@CurrentUser('email') email: string) {
  return email;
}
```

---

## DTOs

### RegisterDto

```typescript
class RegisterDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
  password: string;
}
```

### LoginDto

```typescript
class LoginDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @MaxLength(128)
  password: string;
}
```

### ForgotPasswordDto

```typescript
class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(255)
  email: string;
}
```

### ResetPasswordDto

```typescript
class ResetPasswordDto {
  @IsString()
  @Length(64, 64)
  token: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
  password: string;
}
```

---

## Interfaces

### TokenPair

```typescript
interface TokenPair {
  accessToken: string;
  refreshToken: string;  // Format: sessionId.randomBytes
  expiresIn: number;     // Seconds until access token expires
}
```

### LoginResponse

```typescript
interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    profileComplete: boolean;
    profile: {
      firstName?: string;
      lastName?: string;
      company?: string;
    };
    consents: {
      privacyPolicy: boolean;
      privacyPolicyAcceptedAt?: Date;
      dataSharing: boolean;
      dataSharingAcceptedAt?: Date;
    };
    plan?: {
      id: string;
      slug?: string;
      startedAt?: Date;
    };
    status: string;
  };
}
```

### SessionInfo

```typescript
interface SessionInfo {
  id: string;
  deviceInfo: DeviceInfoData;
  ipAddress: string;
  createdAt: Date;
  lastActivityAt?: Date;
  isCurrent: boolean;  // True for requesting session
}
```

---

## Configuration

### Environment Variables

```bash
# JWT Configuration
JWT_SECRET=your-secret-key-min-32-chars  # Required in production
JWT_ISSUER=yellostorm                     # Token issuer claim
JWT_AUDIENCE=yellostorm-app               # Token audience claim

# Token Expiry
JWT_ACCESS_EXPIRY=15m    # Access token lifetime
JWT_REFRESH_EXPIRY=7d    # Refresh token lifetime

# Authentication
AUTH_BCRYPT_ROUNDS=12              # Password hashing rounds
AUTH_EMAIL_VERIFICATION_EXPIRY_HOURS=24  # Email verification token expiry (hours)
AUTH_PASSWORD_RESET_EXPIRY_HOURS=1       # Password reset token expiry (hours, default: 1)
AUTH_MAX_SESSIONS_PER_USER=10      # Session limit per user
AUTH_REFRESH_TOKEN_COOKIE_NAME=refresh_token
AUTH_COOKIE_SECURE=true            # HTTPS only
AUTH_COOKIE_SAME_SITE=strict       # CSRF protection

# Application
APP_NAME=YelloStorm
APP_FRONTEND_URL=https://app.yellostorm.com
```

### Module Configuration

```typescript
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        secret: config.get('jwt.secret'),
        signOptions: {
          issuer: config.get('jwt.issuer'),
          audience: config.get('jwt.audience'),
        },
      }),
    }),
    MongooseModule.forFeature([{ name: Session.name, schema: SessionSchema }]),
    UserModule,
    UsageModule,
    AuthorizationModule,
  ],
  providers: [AuthService, JwtStrategy, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard, JwtStrategy],
})
```

---

## Error Codes

| Code | Constant | Description |
|------|----------|-------------|
| ERR_1100 | AUTH_INVALID_CREDENTIALS | Wrong email or password |
| ERR_1101 | AUTH_TOKEN_EXPIRED | Auth token expired |
| ERR_1102 | AUTH_TOKEN_INVALID | Auth token invalid |
| ERR_1103 | AUTH_SESSION_EXPIRED | Session expired |
| ERR_1104 | AUTH_EMAIL_NOT_VERIFIED | Login attempt before email verified |
| ERR_1105 | AUTH_PROFILE_INCOMPLETE | Profile not completed |
| ERR_1106 | AUTH_SESSION_NOT_FOUND | Session not found for revocation |
| ERR_1107 | AUTH_REFRESH_TOKEN_INVALID | Refresh token invalid or reused |
| ERR_1108 | AUTH_REFRESH_TOKEN_EXPIRED | Refresh token has expired |
| ERR_1109 | AUTH_MICROSOFT_AUTH_FAILED | Microsoft auth failed |
| ERR_1110 | AUTH_ACCOUNT_SUSPENDED | Account has been suspended |
| ERR_1111 | INVALID_CREDENTIALS | Invalid email or password |
| ERR_1112 | INVALID_TOKEN | Generic invalid token |
| ERR_1113 | AUTH_SESSION_REVOKED | Session was revoked (logout/security) |
| ERR_1114 | VERIFICATION_TOKEN_EXPIRED | Email verification token expired |
| ERR_1115 | EMAIL_ALREADY_VERIFIED | Email is already verified |
| ERR_1116 | AUTH_RESET_TOKEN_INVALID | Password reset token invalid or already used |
| ERR_1117 | AUTH_RESET_TOKEN_EXPIRED | Password reset token has expired |
| ERR_1120 | AUTH_TOKEN_MISSING | Auth token missing (SSE) |
| ERR_1202 | USER_INACTIVE | Account is inactive pending Super Admin approval (app features; login still succeeds) |

---

## Email Notifications

### Verification Email

Sent on registration with magic link (best-effort: unavailable mail is logged, registration still succeeds):

```
Subject: Verify your email address - YelloStorm

Contains:
- Branded HTML template
- Verification button/link
- 24-hour expiry notice
- Plain text fallback
```

Verifying the address does not change `status` or `registrationApproval`.

### Super Admin Registration Notice

Sent after the verification email to every **active** user with the `super_admin` role (best-effort; never fails registration):

```
Subject: New registration request - YelloStorm

Contains:
- Applicant email, user id, requested-at (ISO UTC)
- Approve and Reject buttons/links to /#/admin/users?status=inactive&review={userId}&decision=...
- Notice that the Super Admin must be signed in
- Plain text fallback
```

Links are deep-links into the admin UI, not public action tokens. If there is no `super_admin` role or no active Super Admin users, the service logs a warning and skips sending.

### Registration Approved (user confirmation)

Sent after Super Admin approval (best-effort; mail failure does not roll back status `active`):

```
Subject: Your account has been approved - YelloStorm

Contains:
- Notice that access is active
- Sign-in button/link to /#/
- Reminder to complete email verification if needed
- Plain text fallback
```

Rejection does not send mail to the applicant.

### Password Reset Email

Sent on forgot password request:

```
Subject: Reset your password - YelloStorm

Contains:
- Branded HTML template (same gradient header style)
- Reset password button/link
- 1-hour expiry notice (configurable via AUTH_PASSWORD_RESET_EXPIRY_HOURS)
- Plain text fallback
- Priority: high
```

### New Login Location Alert

Sent when login detected from new IP:

```
Subject: 🔔 New login to your YelloStorm account

Contains:
- Login timestamp
- IP address
- Device info (browser, OS)
- Security recommendations
- Branded HTML template
```

---

## Usage Examples

### Protecting Routes

```typescript
// Protected by default (JwtAuthGuard is global)
@Controller('users')
export class UserController {
  @Get('me')
  getProfile(@CurrentUser() user: UserDocument) {
    return user;
  }
}
```

### Making Routes Public

```typescript
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return { status: 'ok' };
  }
}
```

### Checking Session Validity

```typescript
// In other services
@Injectable()
export class SomeService {
  constructor(private authService: AuthService) {}

  async checkSession(sessionId: string) {
    const isValid = await this.authService.isSessionValid(sessionId);
    if (!isValid) {
      throw new UnauthorizedException('Session expired');
    }
  }
}
```

### Invalidating All User Sessions

```typescript
// When user changes password or is suspended
await this.authService.invalidateAllUserSessions(userId);
```
