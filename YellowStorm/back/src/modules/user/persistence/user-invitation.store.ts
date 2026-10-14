/**
 * Flat row shape of identity.user_invitations. `tokenHash` is the SHA-256 of
 * the raw invite token — the raw token exists only in the email link and is
 * never persisted (same at-rest rule as password-reset / app-share tokens).
 */
export interface UserInvitationRecord {
  id: string;
  email: string;
  tokenHash: string;
  invitedBy: string | null;
  /** Roles granted to the invitee at registration; order preserved. */
  roleIds: string[];
  /** Plan granted to the invitee at registration (snapshot), or null for default. */
  planId: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewUserInvitation {
  email: string;
  tokenHash: string;
  invitedBy: string | null;
  roleIds: string[];
  planId: string | null;
  expiresAt: Date;
}

export const USER_INVITATION_STORE = Symbol('USER_INVITATION_STORE');

/** Persistence port for super-admin user invitations (identity.user_invitations). */
export interface UserInvitationStore {
  create(init: NewUserInvitation): Promise<UserInvitationRecord>;
  findByTokenHash(tokenHash: string): Promise<UserInvitationRecord | null>;
  /**
   * Supersede every still-pending invitation for `email` (marks them consumed)
   * so issuing a fresh invitation invalidates the previous links — only the
   * latest one keeps working. Returns the number of invitations superseded.
   */
  consumePendingForEmail(email: string, now: Date): Promise<number>;
  /** Drop a row whose invitation email never went out (orphan cleanup). */
  deleteById(id: string): Promise<void>;
  /**
   * Atomic single-use claim: marks the invitation consumed only when it is
   * still unconsumed and not expired. Returns true exactly when THIS call
   * consumed it (false for unknown, expired, or already-consumed tokens), so
   * two concurrent registrations can never both win.
   */
  consumeIfValid(tokenHash: string, now: Date): Promise<boolean>;
}
