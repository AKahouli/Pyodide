# Auth Module

Authentication module for YellowMind frontend. Handles user authentication, session management, and provides a public API for other components.

## Overview

The auth module implements a secure authentication flow with:
- JWT access tokens (stored in localStorage, 15 min expiry)
- HTTP-only refresh token cookies (7 day expiry, auto-rotation)
- Email verification flow
- Forgot password / reset password flow
- Profile completion flow
- Pending Super Admin approval page (inactive users can sign in, then a full-screen wait page blocks the app until approval; a rejected request shows declined access instead of “upcoming”)
- Automatic token refresh on 401 responses

## Architecture

```
src/modules/auth/
├── AuthContext.tsx      # Auth state provider and context
├── AuthContext.test.tsx # AuthProvider unit tests
├── useAuth.ts           # Public hook for accessing auth
├── useAuth.test.tsx     # useAuth hook unit tests
├── api.ts               # API functions for auth endpoints
├── types.ts             # TypeScript interfaces
├── store.test.ts        # auth modal store unit tests
├── test-utils/
│   └── makeAuthState.ts # shared auth state factory for tests
├── components/
│   ├── PendingApprovalPage.tsx
│   ├── PendingApprovalPage.test.tsx
│   ├── RootGuard.tsx           # Route guard for "/"
│   ├── RootGuard.test.tsx      # Root guard routing tests
│   ├── LandingPage.tsx         # Landing page for guests
│   ├── LandingPage.test.tsx    # Landing page modal entry tests
│   ├── EmailVerificationPage.tsx   # Email verification handler
│   ├── EmailVerificationPage.test.tsx # Verification flow tests
│   ├── ResetPasswordPage.tsx       # Password reset page (from email link)
│   ├── ResetPasswordPage.test.tsx  # Reset flow validation and submit tests
│   ├── ProfileCompletionPage.tsx   # Profile completion form
│   ├── ProfileCompletionPage.test.tsx # Profile completion and logout tests
│   ├── modals/
│   │   ├── LoginModal.tsx          # Login form modal
│   │   ├── LoginModal.test.tsx     # Login modal tests
│   │   ├── RegisterModal.tsx       # Registration form modal
│   │   ├── RegisterModal.test.tsx  # Register modal tests
│   │   ├── ForgotPasswordModal.tsx # Forgot password modal
│   │   ├── ForgotPasswordModal.test.tsx # Forgot password modal tests
│   │   ├── AuthModals.tsx          # Modal controller
│   │   └── AuthModals.test.tsx     # Modal coordinator tests
│   ├── StatusSection.test.tsx      # shared status section tests
│   └── index.ts                    # Component exports
├── utils/
│   ├── isPendingAdminApproval.ts
│   ├── isPendingAdminApproval.test.ts
│   └── errorHelpers.test.ts # auth error helper tests
├── locales/
│   ├── en.json          # English translations
│   └── fr.json          # French translations
├── AuthContext.test.tsx     # AuthProvider login/logout behavior
├── store.test.ts            # Auth modal Zustand store
├── useAuth.test.tsx         # useAuth hook contract
├── components/
│   ├── RootGuard.test.tsx
│   ├── LandingPage.test.tsx
│   ├── EmailVerificationPage.test.tsx
│   ├── ResetPasswordPage.test.tsx
│   └── ProfileCompletionPage.test.tsx
└── index.ts             # Public exports
```

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
- `ERR_1102` - Invalid credentials
- `ERR_1104` - Email not verified
- `ERR_1110` - Account suspended

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
- `ERR_1101` - Email already exists
- Validation errors for weak password

**Note:** After registration, user must verify their email before logging in.

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
  };
  status: "active" | "inactive" | "suspended";
  registrationApproval?: "pending" | "approved" | "rejected";
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

## Token Management

### Access Token
- Stored in `localStorage` as `yellostorm_access_token`
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
| `ERR_1007` | Too many requests (rate limited) |
| `ERR_1101` | Email already exists |
| `ERR_1102` | Invalid credentials |
| `ERR_1104` | Email not verified |
| `ERR_1107` | Invalid refresh token |
| `ERR_1108` | Refresh token expired |
| `ERR_1110` | Account suspended |
| `ERR_1112` | Invalid token |
| `ERR_1114` | Verification token expired |
| `ERR_1115` | Email already verified |
| `ERR_1116` | Password reset token invalid or already used |
| `ERR_1117` | Password reset token expired |

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
    case "ERR_1102":
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

### AuthModalType

```typescript
type AuthModalType = 'login' | 'register' | 'forgotPassword' | null;
```

### Routes

| Path | Component | Description |
|------|-----------|-------------|
| `/` | `RootGuard` | Landing or app based on auth state |
| `/verify-email` | `EmailVerificationPage` | Email verification from magic link |
| `/reset-password` | `ResetPasswordPage` | Password reset from email link |
| `/complete-profile` | `ProfileCompletionPage` | Profile completion form |

## Testing

- Auth tests are colocated with the module using `*.test.ts` and `*.test.tsx`.
- Shared auth test helpers live in `src/modules/auth/test-utils`.
- Run auth module tests from `front/`:

```bash
npm test -- src/modules/auth
```
