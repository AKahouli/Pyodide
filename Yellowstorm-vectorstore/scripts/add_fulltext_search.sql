-- ============================================================================
-- Full-Text Search Migration for Logical Indexing
-- ============================================================================
-- Adds tsvector columns and GIN indexes for fast full-text search
-- on block content and section titles.
--
-- Usage:
--   psql -U <username> -d smartadk -f add_fulltext_search.sql
--
-- Or using environment variables:
--   PGPASSWORD=<password> psql -U <username> -h <host> -p <port> -d smartadk -f add_fulltext_search.sql
-- ============================================================================

-- ============================================================================
-- Add tsvector columns
-- ============================================================================
ALTER TABLE logical_blocks ADD COLUMN IF NOT EXISTS content_tsv tsvector;
ALTER TABLE logical_sections ADD COLUMN IF NOT EXISTS title_tsv tsvector;

-- ============================================================================
-- Create GIN indexes for fast full-text search
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_blocks_content_tsv ON logical_blocks USING GIN(content_tsv);
CREATE INDEX IF NOT EXISTS idx_sections_title_tsv ON logical_sections USING GIN(title_tsv);

-- ============================================================================
-- Create trigger functions to auto-update tsvector columns
-- ============================================================================
CREATE OR REPLACE FUNCTION update_block_content_tsv() RETURNS trigger AS $$
BEGIN
  NEW.content_tsv := to_tsvector('english', COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_section_title_tsv() RETURNS trigger AS $$
BEGIN
  NEW.title_tsv := to_tsvector('english', COALESCE(NEW.title, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Create triggers (drop first if they exist)
-- ============================================================================
DROP TRIGGER IF EXISTS trg_blocks_content_tsv ON logical_blocks;
DROP TRIGGER IF EXISTS trg_sections_title_tsv ON logical_sections;

CREATE TRIGGER trg_blocks_content_tsv
  BEFORE INSERT OR UPDATE ON logical_blocks
  FOR EACH ROW EXECUTE FUNCTION update_block_content_tsv();

CREATE TRIGGER trg_sections_title_tsv
  BEFORE INSERT OR UPDATE ON logical_sections
  FOR EACH ROW EXECUTE FUNCTION update_section_title_tsv();

-- ============================================================================
-- Update existing rows to populate tsvector columns
-- ============================================================================
UPDATE logical_blocks SET content_tsv = to_tsvector('english', COALESCE(content, ''))
WHERE content_tsv IS NULL;

UPDATE logical_sections SET title_tsv = to_tsvector('english', COALESCE(title, ''))
WHERE title_tsv IS NULL;

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON COLUMN logical_blocks.content_tsv IS 'Full-text search vector for block content';
COMMENT ON COLUMN logical_sections.title_tsv IS 'Full-text search vector for section title';
