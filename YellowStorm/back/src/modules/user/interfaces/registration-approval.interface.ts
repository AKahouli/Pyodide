import { RegistrationApproval, UserStatus } from '../user.types';

/** Input for notifying super admins that a classic registration awaits review. */
export interface PendingRegistrationNotice {
  userId: string;
  email: string;
  requestedAt?: Date;
}

/** Outcome of a Super Admin registration decision (approve / reject). */
export interface RegistrationDecisionResult {
  changed: boolean;
  userId: string;
  email: string;
  status: UserStatus;
  registrationApproval?: RegistrationApproval;
}
