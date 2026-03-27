import { SetMetadata } from '@nestjs/common';

export const CHECK_USAGE_KEY = 'checkUsage';

export interface CheckUsageOptions {
  /**
   * Whether to check token limits
   * @default true
   */
  checkTokens?: boolean;

  /**
   * Estimated tokens for this request (optional)
   * If provided, will check if user can afford this many tokens
   */
  estimatedTokens?: number;

  /**
   * Required feature for this endpoint
   * If provided, will check if user's plan has this feature
   */
  requiredFeature?: string;

  /**
   * Whether to skip the check entirely
   * Useful for conditional checking
   * @default false
   */
  skip?: boolean;
}

/**
 * Decorator to enforce usage limits on endpoints
 *
 * @example
 * // Basic usage - just check if user has tokens remaining
 * @CheckUsage()
 * async chat() { ... }
 *
 * @example
 * // Check with estimated token usage
 * @CheckUsage({ estimatedTokens: 1000 })
 * async generateLongText() { ... }
 *
 * @example
 * // Require a specific feature
 * @CheckUsage({ requiredFeature: 'api_access' })
 * async apiEndpoint() { ... }
 */
export const CheckUsage = (options: CheckUsageOptions = {}) =>
  SetMetadata(CHECK_USAGE_KEY, {
    checkTokens: true,
    skip: false,
    ...options,
  });
