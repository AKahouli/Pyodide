-- A reading too large for a document_extractions row (a sheet of tens of thousands of records) is kept
-- as a gzip stream cut into chunks here; the row holds only a pointer (chunk count, size, digest).
-- Deleting or replacing the row (a purge, a clear, a newer reading) deletes its chunks with it.
CREATE TABLE IF NOT EXISTS semantic_population.document_extraction_chunks (
  cache_key  TEXT    NOT NULL REFERENCES semantic_population.document_extractions (cache_key) ON DELETE CASCADE,
  ordinal    INTEGER NOT NULL CHECK (ordinal >= 0),
  data       BYTEA   NOT NULL,
  PRIMARY KEY (cache_key, ordinal)
);
-- Already compressed: stored as it is, not compressed a second time.
ALTER TABLE semantic_population.document_extraction_chunks ALTER COLUMN data SET STORAGE EXTERNAL;

REVOKE ALL ON semantic_population.document_extraction_chunks FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'semantic_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON semantic_population.document_extraction_chunks TO semantic_app;
  END IF;
END $$;
