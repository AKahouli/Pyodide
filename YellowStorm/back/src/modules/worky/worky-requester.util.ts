import type { AuthUser } from '@common/auth/auth-user';

/**
 * The requester's identity for an orchestrator turn (RunRequest.user_*), so the
 * planner/executor address the user directly and never delegate or email work
 * back to the person who asked for it.
 */
export function requesterOpts(user: AuthUser): {
  userName?: string;
  userEmail?: string;
  userRole?: string;
} {
  const p = user.profile;
  const name = [p?.firstName, p?.lastName].filter(Boolean).join(' ').trim();
  return {
    userName: name || user.email,
    userEmail: user.email,
    userRole: p?.role || undefined,
  };
}
