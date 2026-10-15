# Auth Module

Authentication module for YellowMind frontend. Handles user authentication, session management, and provides a public API for other components.

## Overview

The auth module implements a secure authentication flow with:
- JWT access tokens (held in memory only, never written to web storage; 15 min expiry)
- HTTP-only refresh token cookies (7 day expiry, auto-rotation)
- Email verification flow
- Forgot password / reset password flow
- Super-admin email invitation flow (the admin picks the plan and roles; an invite link resolves server-side, then opens the register modal with the invited address pre-filled and locked, and the invited account is created active + pre-approved)
- Profile completion flow
- Pending Super Admin approval page (classic signups only — invited users skip it; inactive users can sign in, then a full-screen wait page blocks the app until approval; a rejected request shows declined access instead of “upcoming”)
- Automatic token refresh on 401 responses
- OAuth sign-in (public provider list + `/oauth-callback` exchange)

## Architecture

```
src/modules/auth/
├── AuthContext.tsx      # Auth state provider and context
├── AuthContext.test.tsx # AuthProvider unit tests
├── useAuth.ts           # Public hook for accessing auth
├── useAuth.test.tsx     # useAuth hook unit tests
├── api.ts               # API functions for auth endpoints
├── api.test.ts          # API function tests
├── types.ts             # TypeScript interfaces
├── store.ts             # Zustand auth modal store (invite carrier)
├── store.test.ts        # auth modal store unit tests
├── test-utils/
│   └── makeAuthState.ts # shared auth state factory for tests
├── components/
│   ├── PendingApprovalPage.tsx
│   ├── PendingApprovalPage.test.tsx
│   ├── RootGuard.tsx           # Route guard for "/"
│   ├── RootGuard.test.tsx      # Root guard routing tests
│   ├── LandingPage.tsx         # Landing page for guests (handles ?invite= links)
│   ├── LandingPage.test.tsx    # Landing page modal entry tests
│   ├── EmailVerificationPage.tsx   # Email verification handler
│   ├── EmailVerificationPage.test.tsx # Verification flow tests
│   ├── ResetPasswordPage.tsx       # Password reset page (from email link)
│   ├── ResetPasswordPage.test.tsx  # Reset flow validation and submit tests
│   ├── ProfileCompletionPage.tsx   # Profile completion form
│   ├── ProfileCompletionPage.test.tsx # Profile completion and logout tests
│   ├── modals/
│   │   ├── LoginModal.tsx          # Login form modal (show/hide password)
│   │   ├── LoginModal.test.tsx     # Login modal tests
│   │   ├── RegisterModal.tsx       # Registration form modal (invite prefill/lock, live password feedback)
│   │   ├── RegisterModal.test.tsx  # Register modal tests
│   │   ├── ForgotPasswordModal.tsx # Forgot password modal
│   │   ├── ForgotPasswordModal.test.tsx # Forgot password modal tests
│   │   ├── AuthModals.tsx          # Modal controller
│   │   └── AuthModals.test.tsx     # Modal coordinator tests
│   ├── OAuthCallbackPage.tsx       # /oauth-callback exchange handler
│   ├── OAuthCallbackPage.test.tsx  # OAuth callback tests
│   ├── StatusSection.tsx           # shared status/icon block
│   ├── StatusSection.test.tsx      # shared status section tests
│   └── index.ts                    # Component exports
├── utils/
│   ├── isPendingAdminApproval.ts
│   ├── isPendingAdminApproval.test.ts
│   ├── password-policy.ts   # single source of truth for password rules + zod schema
│   ├── password-policy.test.ts
│   ├── errorHelpers.ts      # error-code → message helpers
│   └── errorHelpers.test.ts # auth error helper tests
├── locales/
│   ├── en.json          # English translations
│   └── fr.json          # French translations
└── index.ts             # Public exports
```

## Password Field UX

The login and register password fields share a live-validation UX built on three pieces:

| Piece | Location | Role |
|-------|----------|------|
| `password-policy.ts` | `utils/` (this module) | Single source of truth for the backend password rules (`RegisterDto`: at least 8 characters, one uppercase, one lowercase, one digit). `createPasswordSchema(t)` builds the zod schema and reports the *first* unmet rule; `isPasswordValid` powers the success feedback. |
| `PasswordInput` | `src/components/ui/password-input.tsx` (shared UI primitive) | Password field with a show/hide eye toggle (`common.actionShowPassword` / `actionHidePassword`). The browser's native reveal/clear controls are suppressed in `src/index.css` so only one eye renders. |
| `FormSuccessMessage` | `src/components/ui/form.tsx` (shared UI primitive) | Green positive-feedback line placed where the error line would be; automatically hidden while the field carries an error. |

On the **register** form nothing is shown until the user types; from the first keystroke the message updates on every change (`form.trigger('password')`), and the confirmation mismatch is reported live as well — both while typing the confirmation and when the password changes after a filled confirmation:

| State | Message key |
|-------|-------------|
| A rule is unmet | `register.error.passwordMin` / `passwordUppercase` / `passwordLowercase` / `passwordNumber` (first unmet rule only) |
| All rules met | `register.password.valid` |
| Confirmation differs | `register.error.passwordMismatch` |
| Confirmation matches | `register.confirmPassword.match` |

The **login** form only has the show/hide toggle (no strength rules, no confirmation field).

`ResetPasswordPage` still carries its own inline rules and has not been migrated to the shared policy yet.

## Testing

### Coverage Scope

- `store.ts`: initial state, action updates, reset behavior
- `useAuth.ts`: provider contract (throws outside provider, returns context inside)
- `AuthContext.tsx`: login/logout core flow and localStorage side effects
- `components/RootGuard.tsx`: guest rendering, profile-completion redirect, authenticated layout flow
- `components/LandingPage.tsx`: translation-ready state, registration visibility, auth modal actions
- `components/EmailVerificationPage.tsx`: token validation, success/error branches, resend flow
- `components/ResetPasswordPage.tsx`: token validation, form validation, success/error submit states
- `components/ProfileCompletionPage.tsx`: redirect logic, profile submit, logout behavior
- `utils/password-policy.ts`: rule order, first-unmet-rule reporting, schema messages
- `components/modals/RegisterModal.tsx` / `LoginModal.tsx`: live password feedback and show/hide toggle

### Test Location

- Tests are co-located next to source files:
  - `src/modules/auth/*.test.tsx`
  - `src/modules/auth/components/*.test.tsx`

### Run Auth Tests

```bash
npm run test -- src/modules/auth
```

### Isolation Rules

- Tests are independent (no shared state between tests)
- Mocks and localStorage are reset between tests
- API calls are mocked; no real network requests

## Usage

### Basic Usage

```tsx
import { useAuth } from "@/modules/auth";

function MyComponent() {
  const { user, isAuthenticated, logout } = useAuth();

  if (!isAuthenticated) {
    return <p>Please log in</p>;
  }

  return (
    <div>
      <p>Welcome, {user?.email}</p>
      <button onClick={logout}>Logout</button>
    </div>
  );
}
```

### Setup

The `AuthProvider` must wrap your app (already configured in `App.tsx`):

```tsx
import { AuthProvider } from "@/modules/auth";

function App() {
  return (
    <AuthProvider>
      <YourApp />
    </AuthProvider>
  );
}
```

## API Reference

### `useAuth()` Hook

Returns the auth context with state and methods.

#### State Properties

| Property | Type | Description |
|----------|------|-------------|
| `user` | `User \| null` | Current authenticated user or null |
| `isAuthenticated` | `boolean` | Whether user is authenticated |
| `isLoading` | `boolean` | Whether auth state is being loaded/checked |
| `requiresEmailVerification` | `boolean` | User needs to verify email |
| `requiresProfileCompletion` | `boolean` | User needs to complete profile |
| `registrationEnabled` | `boolean` | Whether self-service registration is open |
| `isAuthTemporarilyUnavailable` | `boolean` | Bootstrap validation hit a transient failure; credentials preserved and protected data must not render |

#### Methods

##### `login(credentials: LoginCredentials): Promise<void>`

Authenticates user with email and password.

```tsx
const { login } = useAuth();

try {
  await login({ email: "user@example.com", password: "password123" });
  // Success - user is now authenticated
} catch (error) {
  // Handle error (invalid credentials, email not verified, etc.)
  console.error(error.message);
}
```

**Throws:**
- `ERR_1111` - Invalid credentials
- `ERR_1104` - Email not verified
- `ERR_1110` - Account suspended
- `ERR_1202` - Account inactive pending Super Admin approval
- `ERR_1130` - Auth dependency temporarily unavailable

---

##### `register(credentials: RegisterCredentials): Promise<void>`

Registers a new user account.

```tsx
const { register } = useAuth();

try {
  await register({ email: "user@example.com", password: "Password123" });
  // Success - verification email sent
  // User should check their email
} catch (error) {
  // Handle error (email exists, validation failed, etc.)
  console.error(error.message);
}
```

**Throws:**
- `ERR_1132` - Invitation token invalid or already used
- `ERR_1133` - Invitation token expired
- `ERR_1134` - Invitation was issued for a different email
- `ERR_1007` - Rate limited
- Validation errors for invalid email or weak password (`ERR_1001`)

**Note:** After registration, user must verify their email before logging in. When an optional `inviteToken` is present, registration is bound to the invited address; an invited account is created active and pre-approved with the roles and plan chosen by the inviter, so it skips the pending-approval page — it still verifies its email first, exactly like a classic signup. Registration is anti-enumeration: an email that already has an account returns the same success response, so `ERR_1201` is never surfaced here.

---

##### `logout(): Promise<void>`

Logs out the current user and clears session.

```tsx
const { logout } = useAuth();

await logout();
// User is now logged out, tokens cleared
```

**Behavior:**
- Calls backend to invalidate session
- Clears access token from localStorage
- Clears user data from localStorage
- Resets auth state

---

##### `verifyEmail(token: string): Promise<void>`

Verifies user's email with token from magic link.

```tsx
const { verifyEmail } = useAuth();

try {
  await verifyEmail("abc123..."); // Token from URL query param
  // Email verified successfully
} catch (error) {
  // Invalid or expired token
}
```

**Note:** Usually called automatically by `EmailVerificationPage` from the magic link URL.

---

##### `resendVerificationEmail(): Promise<void>`

Resends the verification email to the current user.

```tsx
const { resendVerificationEmail } = useAuth();

try {
  await resendVerificationEmail();
  // Email sent
} catch (error) {
  // Rate limited or other error
}
```

**Note:** Requires user to be authenticated. Rate limited to 3 requests per 5 minutes.

---

### Forgot Password / Reset Password

These are standalone API functions (not part of `useAuth` context) imported directly from `api.ts`.

##### `forgotPassword(email: string): Promise<{ message: string }>`

Requests a password reset email. Always succeeds from the caller's perspective (prevents email enumeration).

```tsx
import { forgotPassword } from '@/modules/auth/api';

try {
  await forgotPassword('user@example.com');
  // Show success message regardless of whether account exists
} catch (error) {
  // Only fails on rate limiting (ERR_1007) or network errors
}
```

**Rate limited:** 3 requests per 5 minutes.

---

##### `resetPassword(token: string, password: string): Promise<{ message: string }>`

Resets the user's password using the token from the email link. Invalidates all user sessions.

```tsx
import { resetPassword } from '@/modules/auth/api';

try {
  await resetPassword(token, newPassword);
  // Password reset successful, all sessions invalidated
} catch (error) {
  // ERR_1116 - Invalid or already used token
  // ERR_1117 - Token has expired
  // ERR_1007 - Rate limited
}
```

**Rate limited:** 5 requests per minute.

---

##### `getInviteDetails(token: string): Promise<InviteDetails>`

Resolves a super-admin invitation token from an invite link (`/#/?invite=<token>`). A standalone API function imported from `api.ts`; called by `LandingPage`, not part of `useAuth`.

```tsx
import { getInviteDetails } from '@/modules/auth/api';

try {
  const { email, expiresAt } = await getInviteDetails(token);
  // Open the register modal with `email` pre-filled and locked
} catch (error) {
  // ERR_1132 - Invalid or already used token
  // ERR_1133 - Token has expired
  // ERR_1007 - Rate limited
}
```

**Rate limited:** 10 requests per minute. Only the invited email and expiry are returned — never the token.

---

##### `completeProfile(data: CompleteProfileData): Promise<void>`

Completes the user's profile (required after registration).

```tsx
const { completeProfile } = useAuth();

try {
  await completeProfile({
    firstName: "John",
    lastName: "Doe",
    company: "Acme Inc",
    privacyPolicy: true,
    dataSharing: false,
  });
  // Profile completed, user can now access the app
} catch (error) {
  // Validation error
}
```

---

##### `refreshUser(): Promise<void>`

Fetches the latest user data from the server.

```tsx
const { refreshUser } = useAuth();

await refreshUser();
// user state is now updated with latest data
```

---

##### `retryRecovery(): Promise<void>`

Re-runs bootstrap validation after a transient unavailability episode (`isAuthTemporarilyUnavailable`). This is not a logout: credentials are preserved.

```tsx
const { retryRecovery } = useAuth();

await retryRecovery();
```

## Types

### `User`

```typescript
interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  profileComplete: boolean;
  profile: {
    firstName?: string;
    lastName?: string;
    company?: string;
    role?: string;
    description?: string;
  };
  appearance?: {
    colorTheme: "default" | "yellow" | "orange" | "blue";
    language: string;
    logo?: "yellowmind" | "kpmg";
  };
  status: "active" | "inactive" | "suspended";
  registrationApproval?: "pending" | "approved" | "rejected";
  plan: { id: string; slug: string; startedAt: string };
  permissions?: string[];
  roleNames?: string[];
}
```

### `LoginCredentials`

```typescript
interface LoginCredentials {
  email: string;
  password: string;
}
```

### `RegisterCredentials`

```typescript
interface RegisterCredentials {
  email: string;
  password: string;
  inviteToken?: string;  // Super-admin invitation token from the invite link
}
```

### `CompleteProfileData`

```typescript
interface CompleteProfileData {
  firstName: string;
  lastName: string;
  company: string;
  privacyPolicy: boolean;  // Must be true
  dataSharing: boolean;    // Optional
  role?: string;
  description?: string;
}
```

### `InviteDetails`

```typescript
interface InviteDetails {
  email: string;
  expiresAt: string;
}
```

### `AuthState`

```typescript
interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  requiresEmailVerification: boolean;
  requiresProfileCompletion: boolean;
  registrationEnabled: boolean;
  isAuthTemporarilyUnavailable: boolean;
}
```

## Authentication Flow

```
┌─────────────┐     ┌──────────────┐     ┌───────────────────┐     ┌─────────┐
│  Register   │ ──▶ │ Verify Email │ ──▶ │ Complete Profile  │ ──▶ │   App   │
└─────────────┘     └──────────────┘     └───────────────────┘     └─────────┘
                          │
                    (magic link)
```

1. **Register** - User creates account with email/password
2. **Verify Email** - User clicks magic link in email
3. **Login** - User logs in with credentials
4. **Complete Profile** - User fills required profile info
5. **Access App** - User can now use the application

### Forgot Password Flow

```
Login Modal ──▶ "Forgot password?" ──▶ ForgotPasswordModal (email input)
  ──▶ Backend sends reset email ──▶ Modal shows "Check your email" success

Email link ──▶ /#/reset-password?token=xxx ──▶ ResetPasswordPage
  ──▶ User enters new password + confirmation
  ──▶ Backend validates token, resets password, invalidates all sessions
  ──▶ Page shows success + countdown redirect to login
```

### Invitation Flow

```text
Admin (#/admin/users) ──▶ invite modal (plan + roles selects)
  ──▶ POST /admin/users/invite ──▶ invitation email (unique link, 24h)

Email link ──▶ /#/?invite=<token> ──▶ LandingPage effect
  ──▶ strips ?invite from the URL immediately (history/referrer safety)
  ──▶ getInviteDetails(token)
        ├── ERR_1132 / ERR_1133 ──▶ toast with localized message (no modal)
        └── valid ──▶ useAuthModalStore.setInvite(token, email)
                      └── opens RegisterModal, email pre-filled + disabled
  ──▶ user sets a password ──▶ register({ email, password, inviteToken })
        └── ERR_1132 / ERR_1133 / ERR_1134 shown inline via error-code i18n
```

The invite state (`inviteToken`, `inviteEmail`) lives in `useAuthModalStore` and is cleared on modal close, switch-to-login, and successful registration. The token is never used for authorization on its own: the backend re-validates it and applies the grants. An invited account is created **active + approved** with the roles and plan chosen by the inviter, so it skips the pending-approval page (falling back to the default plan if the invited plan is no longer available). The invitee still verifies their email before the first login, exactly like a classic signup.

## Token Management

### Access Token
- Held in memory only (`lib/api/access-token-store.ts`); never written to web storage
- 15 minute expiry
- Sent in `Authorization: Bearer <token>` header
- Automatically refreshed on 401 response

### Refresh Token
- Stored in HTTP-only cookie (not accessible via JavaScript)
- 7 day expiry
- Rotated on each use (old token invalidated)
- Sent automatically with requests to `/api/v1/auth/*`

### Auto-Refresh Flow

```
Request fails with 401
        │
        ▼
  Is refresh in progress?
    │           │
   Yes          No
    │           │
    ▼           ▼
  Queue      Call /refresh
  request       │
    │           ▼
    │      New access token
    │           │
    │           ▼
    │      Retry original request
    │           │
    └───────────┘
```

## Error Handling

All methods throw errors in a consistent format:

```typescript
interface ApiError {
  code: string;      // Error code (e.g., "ERR_1102")
  message: string;   // Human-readable message
  statusCode: number;
  details?: Array<{ field: string; message: string }>;
}
```

### Common Error Codes

| Code | Description |
|------|-------------|
| `ERR_1001` | Validation error (invalid field values) |
| `ERR_1007` | Too many requests (rate limited) |
| `ERR_1104` | Email not verified |
| `ERR_1107` | Invalid refresh token |
| `ERR_1108` | Refresh token expired |
| `ERR_1110` | Account suspended |
| `ERR_1111` | Invalid credentials |
| `ERR_1112` | Invalid token |
| `ERR_1114` | Verification token expired |
| `ERR_1115` | Email already verified |
| `ERR_1116` | Password reset token invalid or already used |
| `ERR_1117` | Password reset token expired |
| `ERR_1130` | Auth dependency temporarily unavailable |
| `ERR_1131` | Concurrent refresh; retry |
| `ERR_1132` | Invitation token invalid or already used |
| `ERR_1133` | Invitation token expired |
| `ERR_1134` | Invitation was issued for a different email |
| `ERR_1201` | Email already registered (admin invite; not returned by `/auth/register`) |
| `ERR_1202` | Account inactive pending Super Admin approval |
| `ERR_1203` | Invitation email could not be sent |

### Example Error Handling

```tsx
const { login } = useAuth();

try {
  await login(credentials);
} catch (error) {
  const apiError = error as ApiError;

  switch (apiError.code) {
    case "ERR_1104":
      setMessage("Please verify your email first");
      break;
    case "ERR_1111":
      setMessage("Invalid email or password");
      break;
    default:
      setMessage(apiError.message || "Login failed");
  }
}
```

## Exports

```typescript
// Main exports from "@/modules/auth"
export { AuthProvider, AuthContext } from "./AuthContext";
export { useAuth } from "./useAuth";
export type {
  User,
  AuthState,
  LoginCredentials,
  RegisterCredentials,
  CompleteProfileData,
  AuthContextType,
  AuthModalType,
} from "./types";
export {
  LoginModal,
  RegisterModal,
  ForgotPasswordModal,
  AuthModals,
  LandingPage,
  RootGuard,
  EmailVerificationPage,
  ResetPasswordPage,
  ProfileCompletionPage,
} from "./components";
```

`api.ts` functions (`forgotPassword`, `resetPassword`, `getInviteDetails`, `getAuthProviders`, `exchangeOAuthLogin`, `getRegistrationStatus`, …) are imported directly and are not re-exported from the module index. `OAuthCallbackPage` is likewise imported directly by the router.

### AuthModalType

```typescript
type AuthModalType = 'login' | 'register' | 'forgotPassword' | null;
```

### Routes

| Path | Component | Description |
|------|-----------|-------------|
| `/` | `RootGuard` | Landing or app based on auth state; `?invite=<token>` opens the register modal via `LandingPage` |
| `/verify-email` | `EmailVerificationPage` | Email verification from magic link |
| `/oauth-callback` | `OAuthCallbackPage` | OAuth provider redirect handler (exchanges the login) |
| `/reset-password` | `ResetPasswordPage` | Password reset from email link |
| `/complete-profile` | `ProfileCompletionPage` | Profile completion form |
