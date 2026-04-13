import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { mockNavigate, mockApiClient } from '@/test/setup';
import { OAuthCallbackPage } from './OAuthCallbackPage';

// Mock useAuth
const mockRefreshUser = vi.fn();
vi.mock('../useAuth', () => ({
  useAuth: () => ({
    refreshUser: mockRefreshUser,
    isAuthenticated: false,
    isLoading: false,
    user: null,
    registrationEnabled: true,
    requiresEmailVerification: false,
    requiresProfileCompletion: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    verifyEmail: vi.fn(),
    resendVerificationEmail: vi.fn(),
    completeProfile: vi.fn(),
  }),
}));

// Mock useSearchParams
let mockSearchParams = new URLSearchParams();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [mockSearchParams],
  };
});

describe('OAuthCallbackPage', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    mockRefreshUser.mockReset();
    mockNavigate.mockReset();
  });

  describe('token exchange flow', () => {
    it('should show loading state while exchanging token', () => {
      mockSearchParams = new URLSearchParams({ token: 'temp-token-123' });
      // Don't resolve the API call yet
      mockApiClient.post.mockReturnValue(new Promise(() => {}));

      renderWithProviders(<OAuthCallbackPage />);

      expect(screen.getByText('oauthCallback.loading')).toBeInTheDocument();
    });

    it('should exchange token and redirect on success', async () => {
      mockSearchParams = new URLSearchParams({ token: 'temp-token-123' });
      mockApiClient.post.mockResolvedValue({
        data: {
          data: {
            accessToken: 'jwt-access-token',
            expiresIn: 900,
            user: { id: '1', email: 'user@test.com' },
          },
        },
      });
      mockRefreshUser.mockResolvedValue(undefined);

      renderWithProviders(<OAuthCallbackPage />);

      await waitFor(() => {
        expect(mockApiClient.post).toHaveBeenCalledWith(
          '/auth/providers/exchange',
          { token: 'temp-token-123' },
        );
      });

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
      });
    });

    it('should show error when exchange fails', async () => {
      mockSearchParams = new URLSearchParams({ token: 'bad-token' });
      mockApiClient.post.mockRejectedValue(new Error('Failed'));

      renderWithProviders(<OAuthCallbackPage />);

      await waitFor(() => {
        expect(screen.getByText('oauthCallback.error.title')).toBeInTheDocument();
      });
    });
  });

  describe('link required flow', () => {
    it('should show link required message with masked email', () => {
      mockSearchParams = new URLSearchParams({
        link_required: 'true',
        email: 'j***n@example.com',
      });

      renderWithProviders(<OAuthCallbackPage />);

      expect(screen.getByText('oauthCallback.linkRequired.title')).toBeInTheDocument();
    });
  });

  describe('linked flow', () => {
    it('should show success message when account is linked', () => {
      mockSearchParams = new URLSearchParams({ linked: 'true' });

      renderWithProviders(<OAuthCallbackPage />);

      expect(screen.getByText('oauthCallback.linked.title')).toBeInTheDocument();
    });
  });

  describe('error flow', () => {
    it('should show error for known error code', () => {
      mockSearchParams = new URLSearchParams({ error: 'access_denied' });

      renderWithProviders(<OAuthCallbackPage />);

      expect(screen.getByText('oauthCallback.error.title')).toBeInTheDocument();
    });

    it('should show error for OAuth failure', () => {
      mockSearchParams = new URLSearchParams({ error: 'oauth_failed' });

      renderWithProviders(<OAuthCallbackPage />);

      expect(screen.getByText('oauthCallback.error.title')).toBeInTheDocument();
    });

    it('should show error when no params provided', () => {
      mockSearchParams = new URLSearchParams();

      renderWithProviders(<OAuthCallbackPage />);

      expect(screen.getByText('oauthCallback.error.title')).toBeInTheDocument();
    });
  });

  describe('StrictMode protection', () => {
    it('should not call exchange twice for the same token', async () => {
      mockSearchParams = new URLSearchParams({ token: 'single-use-token' });
      mockApiClient.post.mockResolvedValue({
        data: {
          data: {
            accessToken: 'jwt',
            expiresIn: 900,
            user: { id: '1', email: 'user@test.com' },
          },
        },
      });
      mockRefreshUser.mockResolvedValue(undefined);

      const { unmount } = renderWithProviders(<OAuthCallbackPage />);

      await waitFor(() => {
        expect(mockApiClient.post).toHaveBeenCalledTimes(1);
      });

      unmount();
    });
  });
});
