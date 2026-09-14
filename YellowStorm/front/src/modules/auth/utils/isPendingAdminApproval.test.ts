import { describe, expect, it } from 'vitest';
import { isPendingAdminApproval } from './isPendingAdminApproval';

describe('isPendingAdminApproval', () => {
  it('returns false for null or undefined users', () => {
    expect(isPendingAdminApproval(null)).toBe(false);
    expect(isPendingAdminApproval(undefined)).toBe(false);
  });

  it('returns true only for inactive status', () => {
    expect(isPendingAdminApproval({ status: 'inactive' })).toBe(true);
    expect(isPendingAdminApproval({ status: 'active' })).toBe(false);
    expect(isPendingAdminApproval({ status: 'suspended' })).toBe(false);
  });
});
