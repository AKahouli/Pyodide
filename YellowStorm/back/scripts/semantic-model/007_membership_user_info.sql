-- Add denormalized user info to memberships so listing shares does not
-- require a cross-DB lookup into MongoDB.
ALTER TABLE semantic_model.memberships
  ADD COLUMN IF NOT EXISTS email      TEXT,
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name  TEXT;
