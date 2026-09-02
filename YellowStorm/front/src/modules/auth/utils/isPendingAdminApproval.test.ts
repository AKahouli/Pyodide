import { describe, expect, it } from 'vitest';
import { isPendingAdminApproval } from './isPendingAdminApproval';

describe('isPendingAdminApproval', () => {
  it('is true only for inactive accounts', () => {
    expect(isPendingAdminApproval({ status: 'inactive' })).toBe(true);
    expect(isPendingAdminApproval({ status: 'active' })).toBe(false);
    expect(isPendingAdminApproval({ status: 'suspended' })).toBe(false);
    expect(isPendingAdminApproval(null)).toBe(false);
  });
});
