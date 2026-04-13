/**
 * Auth API Functions
 */

import { apiClient, API_ENDPOINTS, ApiResponse } from '@/lib/api';
import type { LoginCredentials, RegisterCredentials, LoginResponse, RegisterResponse, User, CompleteProfileData, RefreshResponse, AuthProviderPublic } from './types';

/**
 * Register a new user
 */
export async function register(credentials: RegisterCredentials): Promise<RegisterResponse> {
  const response = await apiClient.post<ApiResponse<RegisterResponse>>(API_ENDPOINTS.auth.register, credentials);
  return response.data.data;
}

/**
 * Login with email and password
 */
export async function login(credentials: LoginCredentials): Promise<LoginResponse> {
  const response = await apiClient.post<ApiResponse<LoginResponse>>(API_ENDPOINTS.auth.login, credentials);
  return response.data.data;
}

/**
 * Logout and invalidate session
 */
export async function logout(): Promise<void> {
  await apiClient.post(API_ENDPOINTS.auth.logout);
}

/**
 * Refresh access token (refresh token is sent via HTTP-only cookie)
 */
export async function refreshToken(): Promise<RefreshResponse> {
  const response = await apiClient.post<ApiResponse<RefreshResponse>>(API_ENDPOINTS.auth.refresh);
  return response.data.data;
}

/**
 * Verify email with token
 */
export async function verifyEmail(token: string): Promise<{ message: string }> {
  const response = await apiClient.get<ApiResponse<{ message: string }>>(`${API_ENDPOINTS.auth.verifyEmail}?token=${encodeURIComponent(token)}`);
  return response.data.data;
}

/**
 * Resend verification email (authenticated)
 */
export async function resendVerificationEmail(): Promise<{ message: string }> {
  const response = await apiClient.post<ApiResponse<{ message: string }>>(API_ENDPOINTS.auth.resendVerification);
  return response.data.data;
}

/**
 * Resend verification email using previous token (public, no auth required)
 */
export async function resendVerificationByToken(token: string): Promise<{ message: string }> {
  const response = await apiClient.post<ApiResponse<{ message: string }>>(API_ENDPOINTS.auth.resendVerificationPublic, { token });
  return response.data.data;
}

/**
 * Request a password reset email
 */
export async function forgotPassword(email: string): Promise<{ message: string }> {
  const response = await apiClient.post<ApiResponse<{ message: string }>>(API_ENDPOINTS.auth.forgotPassword, { email });
  return response.data.data;
}

/**
 * Reset password with token
 */
export async function resetPassword(token: string, password: string): Promise<{ message: string }> {
  const response = await apiClient.post<ApiResponse<{ message: string }>>(API_ENDPOINTS.auth.resetPassword, { token, password });
  return response.data.data;
}

/**
 * Get all enabled auth providers (public) — unified list including classic + OAuth
 */
export async function getAuthProviders(): Promise<AuthProviderPublic[]> {
  const response = await apiClient.get<ApiResponse<AuthProviderPublic[]>>(API_ENDPOINTS.auth.oauthProviders);
  return response.data.data;
}

/**
 * @deprecated Use getAuthProviders() instead
 */
export const getOAuthProviders = getAuthProviders;

/**
 * Exchange OAuth temp token for JWT + refresh cookie
 */
export async function exchangeOAuthToken(token: string): Promise<LoginResponse> {
  const response = await apiClient.post<ApiResponse<LoginResponse>>(API_ENDPOINTS.auth.oauthExchange, { token });
  return response.data.data;
}

/**
 * Get registration status (public, no auth needed)
 */
export async function getRegistrationStatus(): Promise<{ enabled: boolean }> {
  const response = await apiClient.get<ApiResponse<{ enabled: boolean }>>(API_ENDPOINTS.system.registration);
  return response.data.data;
}

/**
 * Get current user profile
 */
export async function getCurrentUser(): Promise<User> {
  const response = await apiClient.get<ApiResponse<User>>(API_ENDPOINTS.users.me);
  return response.data.data;
}

/**
 * Complete user profile
 */
export async function completeProfile(data: CompleteProfileData): Promise<User> {
  const response = await apiClient.post<ApiResponse<User>>(API_ENDPOINTS.users.completeProfile, data);
  return response.data.data;
}

/**
 * Update user profile
 */
export async function updateProfile(data: Partial<CompleteProfileData>): Promise<User> {
  const response = await apiClient.put<ApiResponse<User>>(API_ENDPOINTS.users.me, data);
  return response.data.data;
}
