import { describe, it, expect } from 'vitest';
import { mockApiClient } from '@/test/setup';
import { getAuthProviders, getOAuthProviders, exchangeOAuthLogin } from './api';

describe('Auth OAuth API', () => {
  describe('getAuthProviders', () => {
    it('should fetch unified providers list', async () => {
      const mockProviders = [
        { type: 'oauth', providerKey: 'microsoft', displayName: 'Microsoft', iconKey: 'microsoft', sortOrder: 0 },
        { type: 'oauth', providerKey: 'google', displayName: 'Google', iconKey: 'google', sortOrder: 1 },
        { type: 'classic', providerKey: 'classic', displayName: 'Email & Password', iconKey: 'email', sortOrder: 999, registrationEnabled: true },
      ];

      mockApiClient.get.mockResolvedValue({
        data: { data: mockProviders },
      });

      const result = await getAuthProviders();

      expect(result).toEqual(mockProviders);
      expect(mockApiClient.get).toHaveBeenCalledWith('/auth/providers');
    });

    it('should return empty array when no providers configured', async () => {
      mockApiClient.get.mockResolvedValue({
        data: { data: [] },
      });

      const result = await getAuthProviders();

      expect(result).toEqual([]);
    });
  });

  describe('getOAuthProviders (backward compat)', () => {
    it('should be an alias for getAuthProviders', () => {
      expect(getOAuthProviders).toBe(getAuthProviders);
    });
  });

  describe('exchangeOAuthLogin', () => {
    it('should exchange the cookie-borne code for a login response without sending a token', async () => {
      const mockResponse = {
        accessToken: 'jwt-token',
        expiresIn: 900,
        user: {
          id: '123',
          email: 'user@example.com',
          emailVerified: true,
          profileComplete: true,
        },
      };

      mockApiClient.post.mockResolvedValue({
        data: { data: mockResponse },
      });

      const result = await exchangeOAuthLogin();

      expect(result).toEqual(mockResponse);
      expect(mockApiClient.post).toHaveBeenCalledWith('/auth/providers/exchange');
    });

    it('should propagate error on invalid exchange code', async () => {
      mockApiClient.post.mockRejectedValue({
        code: 'ERR_1125',
        message: 'Invalid or expired temp token',
        statusCode: 401,
      });

      await expect(exchangeOAuthLogin()).rejects.toMatchObject({
        code: 'ERR_1125',
      });
    });
  });
});
