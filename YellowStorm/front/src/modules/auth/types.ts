/**
 * Auth Types - Matching backend API responses
 */

// User profile information
export interface UserProfile {
  firstName?: string;
  lastName?: string;
  company?: string;
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
    logo?: 'yellowmind' | 'kpmg';
  };
  profile: UserProfile;
  consents: UserConsents;
  status: 'active' | 'inactive' | 'suspended';
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
}

// Login credentials
export interface LoginCredentials {
  email: string;
  password: string;
}

// Register credentials (backend only needs email + password)
export interface RegisterCredentials {
  email: string;
  password: string;
}

// Profile completion data
export interface CompleteProfileData {
  firstName: string;
  lastName: string;
  company: string;
  privacyPolicy: boolean;
  dataSharing: boolean;
}

// Auth context interface
export interface AuthContextType extends AuthState {
  colorTheme: 'default' | 'yellow' | 'orange' | 'blue';
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (credentials: RegisterCredentials) => Promise<void>;
  logout: () => Promise<void>;
  verifyEmail: (token: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  completeProfile: (data: CompleteProfileData) => Promise<void>;
  refreshUser: () => Promise<void>;
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
  userId: string;
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}
