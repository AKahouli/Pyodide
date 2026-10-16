/**
 * Auth Types - Matching backend API responses
 */

// User profile information
export interface UserProfile {
  firstName?: string;
  lastName?: string;
  company?: string;
  role?: string;
  description?: string;
}
export interface UserConsents {
  privacyPolicy: boolean;
  privacyPolicyAcceptedAt?: string;
  dataSharing: boolean;
  dataSharingAcceptedAt?: string;
}
export interface Plan {
  id: string;
  slug: string;
  startedAt: string;
}
// User type matching backend UserResponse
export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  profileComplete: boolean;
  appearance?: {
    colorTheme: 'default' | 'yellow' | 'orange' | 'blue';
    language: string;
    logo?: 'yellowmind' | 'kpmg';
  };
  profile: UserProfile;
  consents: UserConsents;
  status: 'active' | 'inactive' | 'suspended';
  registrationApproval?: 'pending' | 'approved' | 'rejected';
  plan: Plan;
  permissions?: string[];
  roleNames?: string[];
}

// Auth state for context
export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  requiresEmailVerification: boolean;
  requiresProfileCompletion: boolean;
  registrationEnabled: boolean;
  /**
   * Bootstrap/validation could not complete because of a transient
   * transport/dependency failure. Credentials are preserved and protected
   * data must not render until validation succeeds. This is not a logout.
   */
  isAuthTemporarilyUnavailable: boolean;
}

// Login credentials
export interface LoginCredentials {
  email: string;
  password: string;
}

// Register credentials (backend needs email + password, plus an optional
// super-admin invitation token that binds the registration to the invited
// address).
export interface RegisterCredentials {
  email: string;
  password: string;
  inviteToken?: string;
}

// Profile completion data
export interface CompleteProfileData {
  firstName: string;
  lastName: string;
  company: string;
  privacyPolicy: boolean;
  dataSharing: boolean;
  role?: string;
  description?: string;
}

// Auth context interface
export interface AuthContextType extends AuthState {
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (credentials: RegisterCredentials) => Promise<void>;
  logout: () => Promise<void>;
  verifyEmail: (token: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  completeProfile: (data: CompleteProfileData) => Promise<void>;
  refreshUser: () => Promise<void>;
  /** Re-run bootstrap validation after a transient unavailability episode. */
  retryRecovery: () => Promise<void>;
}

// Auth provider (public, no secrets)
export interface AuthProviderPublic {
  type: 'classic' | 'oauth';
  providerKey: string;
  displayName: string;
  iconKey: string;
  sortOrder: number;
  registrationEnabled?: boolean;
}

// Modal types
export type AuthModalType = 'login' | 'register' | 'forgotPassword' | null;

// API Response types
export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: User;
}

export interface RegisterResponse {
  message: string;
}

/** Resolved super-admin invitation, used to pre-fill the register modal. */
export interface InviteDetails {
  email: string;
  expiresAt: string;
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}
