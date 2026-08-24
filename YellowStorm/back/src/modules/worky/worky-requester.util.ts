import { UserDocument } from '../user/schemas/user.schema';

/**
 * The requester's identity for an orchestrator turn (RunRequest.user_*), so the
 * planner/executor address the user directly and never delegate or email work
 * back to the person who asked for it.
 */
export function requesterOpts(user: UserDocument): {
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
