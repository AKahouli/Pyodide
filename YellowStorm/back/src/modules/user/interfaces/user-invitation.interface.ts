/**
 * Public invitation shapes (user module). The raw token never appears here —
 * it exists only in the invitation email link.
 */

/** Details returned for a valid invitation token (never the token itself). */
export interface UserInvitationDetails {
  email: string;
  expiresAt: Date;
}

/** Roles and plan an invitation grants to the invitee when they register. */
export interface UserInvitationGrant {
  roleIds: string[];
  planId: string | null;
}
