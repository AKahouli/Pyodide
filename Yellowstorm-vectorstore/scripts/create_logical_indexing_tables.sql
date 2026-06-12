-- ============================================================================
-- Logical Indexing Tables
-- ============================================================================
-- This script creates the PostgreSQL tables for storing parsed document
-- structure from the logical indexing pipeline.
--
-- Usage:
--   psql -U <username> -d yellowstorm -f create_logical_indexing_tables.sql
--
-- Or using environment variables:
--   PGPASSWORD=<password> psql -U <username> -h <host> -p <port> -d yellowstorm -f create_logical_indexing_tables.sql
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- Documents table
-- ============================================================================
-- Stores overall document metadata and structure summary
CREATE TABLE IF NOT EXISTS logical_documents (
    id SERIAL PRIMARY KEY,
    doc_id VARCHAR(255) UNIQUE NOT NULL,
    external_id VARCHAR(255) NOT NULL,
    brain_id VARCHAR(255) NOT NULL,
    total_pages INTEGER NOT NULL,
    overview TEXT,
    toc TEXT,  -- Table of contents (JSON or markdown)
    processing_time_ms FLOAT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_logical_docs_external ON logical_documents(external_id);
CREATE INDEX IF NOT EXISTS idx_logical_docs_brain ON logical_documents(brain_id);
CREATE INDEX IF NOT EXISTS idx_logical_docs_doc_id ON logical_documents(doc_id);

-- ============================================================================
-- Blocks table
-- ============================================================================
-- Stores individual content blocks: headings, text, tables, images, etc.
CREATE TABLE IF NOT EXISTS logical_blocks (
    id SERIAL PRIMARY KEY,
    document_id INTEGER REFERENCES logical_documents(id) ON DELETE CASCADE,
    block_id VARCHAR(255) NOT NULL,
    block_type VARCHAR(50) NOT NULL,  -- heading, text, table, image, etc.
    content TEXT,
    embedding HALFVEC(__EMBEDDING_DIMENSION__),
    page_number INTEGER,
    bbox JSONB,  -- {"x1": 0, "y1": 0, "x2": 100, "y2": 100}
    level INTEGER,  -- For headings (1-6)
    parent_id VARCHAR(255),  -- Parent block ID for hierarchy
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_logical_blocks_doc ON logical_blocks(document_id);
CREATE INDEX IF NOT EXISTS idx_logical_blocks_type ON logical_blocks(block_type);
CREATE INDEX IF NOT EXISTS idx_logical_blocks_page ON logical_blocks(page_number);
CREATE INDEX IF NOT EXISTS idx_blocks_embedding
ON logical_blocks USING hnsw (embedding halfvec_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- Sections table
-- ============================================================================
-- Stores hierarchical document structure (chapters, sections, subsections)
CREATE TABLE IF NOT EXISTS logical_sections (
    id SERIAL PRIMARY KEY,
    document_id INTEGER REFERENCES logical_documents(id) ON DELETE CASCADE,
    section_id VARCHAR(255) NOT NULL,
    title TEXT,
    level INTEGER NOT NULL,  -- 1 = chapter, 2 = section, 3 = subsection, etc.
    parent_section_id VARCHAR(255),
    start_block_id VARCHAR(255),
    end_block_id VARCHAR(255),
    page_start INTEGER,
    page_end INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_logical_sections_doc ON logical_sections(document_id);
CREATE INDEX IF NOT EXISTS idx_logical_sections_level ON logical_sections(level);

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON TABLE logical_documents IS 'Document metadata and structure summary from logical indexing';
COMMENT ON TABLE logical_blocks IS 'Content blocks extracted from documents (headings, text, tables, images)';
COMMENT ON TABLE logical_sections IS 'Hierarchical document structure (chapters, sections, subsections)';

COMMENT ON COLUMN logical_documents.doc_id IS 'Unique document identifier (generated or custom)';
COMMENT ON COLUMN logical_documents.external_id IS 'External document identifier from the calling system';
COMMENT ON COLUMN logical_documents.brain_id IS 'Brain/workspace identifier';
COMMENT ON COLUMN logical_documents.toc IS 'Table of contents in markdown format';

COMMENT ON COLUMN logical_blocks.block_type IS 'Type of content: heading, text, table, image, figure, etc.';
COMMENT ON COLUMN logical_blocks.embedding IS 'Half-precision vector embedding for block content';
COMMENT ON COLUMN logical_blocks.bbox IS 'Bounding box coordinates as JSON: {"x1", "y1", "x2", "y2"}';
COMMENT ON COLUMN logical_blocks.level IS 'Heading level (1-6) for heading blocks';

COMMENT ON COLUMN logical_sections.level IS 'Section depth: 1=chapter, 2=section, 3=subsection';
COMMENT ON COLUMN logical_sections.parent_section_id IS 'Parent section ID for nested structure';
