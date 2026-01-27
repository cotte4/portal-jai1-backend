-- Enable pgvector extension (Supabase has this pre-installed)
CREATE EXTENSION IF NOT EXISTS vector;

-- Knowledge base chunks for RAG
CREATE TABLE knowledge_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536), -- OpenAI text-embedding-3-small outputs 1536 dimensions
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create an index for fast similarity search using cosine distance
CREATE INDEX knowledge_chunks_embedding_idx ON knowledge_chunks
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Index for section filtering
CREATE INDEX knowledge_chunks_section_idx ON knowledge_chunks(section);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_knowledge_chunks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER knowledge_chunks_updated_at_trigger
    BEFORE UPDATE ON knowledge_chunks
    FOR EACH ROW
    EXECUTE FUNCTION update_knowledge_chunks_updated_at();
