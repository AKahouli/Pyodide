/**
 * Plain identity types (remediation 4.1) — moved out of the Mongoose
 * user.schema.ts so the schema file could be deleted at the cutover.
 */
export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

export enum RegistrationApproval {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}
