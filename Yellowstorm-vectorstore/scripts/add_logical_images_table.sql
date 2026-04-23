-- ============================================================================
-- Logical Images Table
-- ============================================================================
-- Stores extracted image/figure/chart regions from the logical indexing
-- pipeline with VLM-generated descriptions and embeddings.
--
-- Usage:
--   psql -U <username> -d yellowstorm -f add_logical_images_table.sql
--
-- Or using environment variables:
--   PGPASSWORD=<password> psql -U <username> -h <host> -p <port> -d yellowstorm -f add_logical_images_table.sql
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- Images table
-- ============================================================================
CREATE TABLE IF NOT EXISTS logical_images (
    id SERIAL PRIMARY KEY,
    document_id INTEGER REFERENCES logical_documents(id) ON DELETE CASCADE,
    image_id VARCHAR(255) NOT NULL,
    section_id VARCHAR(255),
    label VARCHAR(50) NOT NULL,
    description TEXT,
    description_tsv TSVECTOR,
    embedding HALFVEC(__EMBEDDING_DIMENSION__),
    image_path TEXT,
    image_compressed_path TEXT,
    bbox JSONB,
    page_number INTEGER,
    dimensions JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_logical_images_doc ON logical_images(document_id);
CREATE INDEX IF NOT EXISTS idx_logical_images_section ON logical_images(section_id);
CREATE INDEX IF NOT EXISTS idx_logical_images_embedding
ON logical_images USING hnsw (embedding halfvec_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- Full-text search trigger for description
-- ============================================================================
CREATE OR REPLACE FUNCTION update_image_description_tsv() RETURNS trigger AS $$
BEGIN
  NEW.description_tsv := to_tsvector('english', COALESCE(NEW.description, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_images_description_tsv ON logical_images;

CREATE TRIGGER trg_images_description_tsv
  BEFORE INSERT OR UPDATE ON logical_images
  FOR EACH ROW EXECUTE FUNCTION update_image_description_tsv();

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON TABLE logical_images IS 'Extracted image/figure/chart regions with VLM descriptions and embeddings';
COMMENT ON COLUMN logical_images.image_id IS 'Unique image identifier (e.g. img_p2_i1)';
COMMENT ON COLUMN logical_images.section_id IS 'ID of the section the image belongs to';
COMMENT ON COLUMN logical_images.label IS 'Original label from layout model: image, figure, or chart';
COMMENT ON COLUMN logical_images.description IS 'VLM-generated description of the image content';
COMMENT ON COLUMN logical_images.description_tsv IS 'Full-text search vector for image description';
COMMENT ON COLUMN logical_images.embedding IS 'Half-precision vector embedding of image description';
COMMENT ON COLUMN logical_images.image_path IS 'Azure Data Lake path to original image';
COMMENT ON COLUMN logical_images.image_compressed_path IS 'Azure Data Lake path to compressed image';
COMMENT ON COLUMN logical_images.bbox IS 'Bounding box coordinates as JSON: {"x1", "y1", "x2", "y2"}';
COMMENT ON COLUMN logical_images.dimensions IS 'Image dimensions as JSON: {"width": N, "height": N}';
