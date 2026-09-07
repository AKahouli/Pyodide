import type { RegistrationApproval, UserStatus } from '../types';

export type RegistrationReviewDecision = 'approve' | 'reject';

export interface UserAccountMenuActions {
  showApprove: boolean;
  showReject: boolean;
  showActivate: boolean;
  showSuspend: boolean;
}

export interface RegistrationReviewSearch {
  statusFilter?: Extract<UserStatus, 'inactive'>;
  reviewUserId?: string;
  decision?: RegistrationReviewDecision;
}

export function isSuperAdmin(hasPermission: (permission: string) => boolean): boolean {
  return hasPermission('*');
}

export function getUserAccountMenuActions(
  user: { status: UserStatus; registrationApproval?: RegistrationApproval },
  superAdmin: boolean,
): UserAccountMenuActions {
  const inactive = user.status === 'inactive';
  return {
    showApprove: superAdmin && inactive,
    showReject: superAdmin && inactive && user.registrationApproval !== 'rejected',
    showActivate: user.status === 'suspended',
    showSuspend: user.status === 'active',
  };
}

export function parseRegistrationReviewSearch(search: URLSearchParams): RegistrationReviewSearch {
  const status = search.get('status');
  const review = search.get('review')?.trim();
  const decision = search.get('decision');

  return {
    statusFilter: status === 'inactive' ? 'inactive' : undefined,
    reviewUserId: review || undefined,
    decision: decision === 'approve' || decision === 'reject' ? decision : undefined,
  };
}

export function stripRegistrationReviewParams(search: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(search);
  next.delete('review');
  next.delete('decision');
  return next;
}
