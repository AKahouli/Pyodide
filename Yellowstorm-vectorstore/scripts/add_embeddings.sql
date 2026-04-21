-- ============================================================================
-- Embedding Columns for Hybrid Search
-- ============================================================================
-- Adds vector embedding columns to enable hybrid search (full-text + semantic)
-- on logical indexing data using pgvector extension.
--
-- Usage:
--   psql -U <username> -d smartadk -f add_embeddings.sql
--
-- Prerequisites:
--   PostgreSQL with pgvector extension installed
-- ============================================================================

-- ============================================================================
-- Enable pgvector extension
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- Add embedding column to logical_blocks using the configured embedding dimension
-- ============================================================================
ALTER TABLE logical_blocks ADD COLUMN IF NOT EXISTS embedding HALFVEC(__EMBEDDING_DIMENSION__);

-- ============================================================================
-- Create HNSW index for cosine similarity search
-- ============================================================================
-- HNSW is best for high query performance with embeddings
-- m = 16 (connections per node), ef_construction = 64 (build quality)
CREATE INDEX IF NOT EXISTS idx_blocks_embedding
ON logical_blocks USING hnsw (embedding halfvec_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON COLUMN logical_blocks.embedding IS 'Half-precision vector embedding for block content';
