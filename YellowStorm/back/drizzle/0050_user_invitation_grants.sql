-- 0050_user_invitation_grants — invitation-borne role and plan grants.
-- A super admin now chooses which roles and which plan an invited user receives.
-- The values are snapshotted on the invitation row and applied when the invitee
-- registers; invited users are created pre-approved (no manual Super Admin
-- review, no "pending" status page). plan_id is a snapshot, not a FK: the plan
-- may later be retired and the registration path falls back to the default plan.
SET LOCAL lock_timeout = '5s';

ALTER TABLE identity.user_invitations
  ADD COLUMN IF NOT EXISTS role_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS plan_id  char(24);
