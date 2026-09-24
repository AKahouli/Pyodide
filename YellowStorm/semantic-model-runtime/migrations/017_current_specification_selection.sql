-- Keep immutable draft snapshots while allowing a later build to select an
-- earlier hash again. The serving fence follows the latest admission, not the
-- first time a particular hash was stored.
ALTER TABLE semantic_runtime.specifications
  ADD COLUMN selected_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE semantic_runtime.specifications SET selected_at = created_at;
