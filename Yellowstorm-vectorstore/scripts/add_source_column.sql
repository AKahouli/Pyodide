-- Add source column to logical_documents table
ALTER TABLE logical_documents ADD COLUMN IF NOT EXISTS source TEXT;
