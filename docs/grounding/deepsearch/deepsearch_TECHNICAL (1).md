# Deep Search - Technical Documentation

## 1. Overview

Deep Search is a cross-repo feature that enriches documents with semantic graph data (concepts, communities, citations, metadata) and exposes a graph-aware search tool to conversational agents. It spans five repositories:

| Repo | Role |
|------|------|
| **YellowStorm-poc** (frontend + NestJS + ADK) | User toggle, upload pipeline, gRPC bridge, MCP client |
| **Yellowstorm-vectorstore** | Document indexing, deep-research Celery worker, metadata extraction |
| **community-graph-poc** | Graph storage, ingestion pipeline, semantic search API |
| **mcp-server-logical-search** | MCP tool server, conditional tool visibility via header |
| **mcp-indexation** | Agent-runtime MCP search server (community graph query) |

---

## 2. System Architecture

```
+------------------+     +------------------+     +-------------------+
|  FRONTEND (React) |     |  NESTJS BACKEND  |     |   ADK (Python)    |
|                  |     |                  |     |                   |
| Workspace toggle |---->| queueDocument()  |---->| gRPC servicer     |
| Playbook toggle  |     | deepSearch flag  |     | deep_search_enabled|
| Graph viewer     |     | persisted in     |     | sets X-Deep-Search|
| (d3 force graph) |<----| document.metadata|     | header on MCP     |
+------------------+     +--------+---------+     +--------+----------+
                                  |                        |
                                  v                        v
                         +--------+---------+     +--------+----------+
                         | VECTORSTORE API  |     | MCP SERVER        |
                         | (FastAPI :8005)  |     | (FastMCP :8001)   |
                         |                  |     |                   |
                         | indexDocument    |     | Hides/Shows       |
                         | FromCephStore    |     | search_relevant_  |
                         | deep_research=   |     | documents based   |
                         |   true/false     |     | on X-Deep-Search  |
                         +--------+---------+     +--------+----------+
                                  |                        |
                     +------------+-- sinusuna           |
                     |               |                    |
                     v               v                    v
              +------+------+  +-----+------+    +-------+-------+
              | CELERY WORKER|  | REDIS      |    | COMMUNITY     |
              | deep-research|  | (broker)   |    | GRAPH-POC     |
              | queue        |  +------------+    | (FastAPI :8020)|
              |              |                    |               |
              | ingest_with  |   deep_research   | /api/ingest   |
              | _config()    | .ingest-with-toc  | /api/query    |
              |              | task              | /api/graph-data|
              | metadata     |                    |               |
              | extraction   |------------------->| pgvector +    |
              | (LLM map-    |                    | HNSW indexes  |
              |  reduce)     |                    | (PostgreSQL)  |
              +--------------+                    +---------------+
```

---

## 3. Ingestion Pipeline

### 3.1 Document Upload Flow

```
User uploads file (deep search toggle ON)
  |
  v
FRONTEND: uploadSmallFile() / completeBulkUpload()
  |  sends deepSearch=true via FormData or query param
  v
NESTJS: WorkspaceDocumentService
  |  confirmUpload(workspaceId, userId, documentId, deepSearch)
  |  uploadSmallFile(..., deepSearch)
  |  completeBulkUpload(..., deepSearch)
  v
NESTJS: IndexingService.queueDocument(documentId, deepSearch)
  |  persists deepSearchRequested='true' in document.metadata
  |  (survives cron retries)
  v
NESTJS: IndexingService.processDocument(documentId, deepSearch)
  |  resolves effectiveDeepSearch from param OR persisted metadata
  |  calls IndexingClient.indexDocument({ deepSearch })
  v
VECTORSTORE API: POST /vectorstores/indexDocumentFromCephStore
  |  body includes deep_research: true
  |  Pydantic IndexDocument.deep_research: bool
  v
VECTORSTORE: async_index_documents_from_ceph_store(deep_research=True)
  |  builds Celery chain based on document type + settings
  |  appends deep_research_signature() to chain if enabled
  v
CELERY: deep-research.ingest-with-toc task
  |  queue: "deep-research"
  |  receives context dict (file_path, workspace_id, compiled_doc_path...)
  v
CELERY: ingest_with_config()
  |  Step 1: extract_document_metadata() (LLM map-reduce)
  |  Step 2: ingest_to_community_graph() (POST to community-graph)
  v
COMMUNITY GRAPH: POST /api/ingest/file
  |  parses document, extracts concepts, generates embeddings
  |  stores DocumentNode + Concepts + Edges + Community
```

### 3.2 Chain Composition

The Celery chain varies by document type and settings. For a standard PDF with deep search:

```
download_from_ceph_store
  -> delete_before_indexing
  -> [group:
       qdrant_branch (convert -> split -> redis -> language -> qdrant -> verify),
       logical_branch -> deep_research.ingest-with-toc
     ]
  -> delete_temp_folder
```

The deep-research task is appended AFTER the logical indexing branch so it receives the compiled document context (including TOC text).

### 3.3 Cron Retry Survival

If `processDocument` fails, the cron job (`processPendingDocuments`, every 30s) retries. The cron does NOT pass `deepSearch` as a parameter. Instead:

```typescript
// processDocument resolves deep search from persisted metadata:
const effectiveDeepSearch = deepSearch ?? document.metadata?.deepSearchRequested === 'true';
```

This ensures the user's deep-search intent survives any retry path.

---

## 4. Metadata Extraction Pipeline

Location: `Yellowstorm-vectorstore/src/modules/deep_research/metadata_extractor.py`

### 4.1 Process

```
extract_document_metadata(file_path, workspace_id, community_graph_url)
  |
  v
1. EXTRACT TEXT from first 10 pages (PyMuPDF)
  |
  v
2. CHUNK text by token size (chunking_by_token_size, ~6000 tokens/chunk)
  |
  v
3. MAP: for each chunk, LLM extracts key-value pairs
   |  Prompt: "Extract structured metadata from this document page.
   |           Return JSON with keys like title, author, date, etc."
   |  Model: LLM_CLASSIFICATION_MODEL via LiteLLM
   v
4. MERGE: combine all chunk results into one dict
   |  _merge_kv(): union of keys, latest value wins for duplicates
   v
5. DEDUP: normalize duplicate keys
   |  _dedup_keys(): fuzzy-match similar keys (e.g. "doc_type" ~ "document_type")
   v
6. NORMALIZE: fetch existing workspace keys from community-graph
   |  GET /api/workspaces/{id}/metadata-keys
   |  Align new keys with existing workspace convention
   v
7. RETURN: dict of metadata key-value pairs
```

### 4.2 Graceful Degradation

If extraction fails for any reason (LLM error, timeout, connection issue), ingestion proceeds WITHOUT metadata. The `ingest_with_config()` function wraps extraction in try/except:

```python
try:
    metadata = extract_document_metadata(file_path, workspace_id, community_graph_url)
except Exception as e:
    logger.warning("metadata extraction failed, continuing without metadata: %s", e)
    metadata = None
```

---

## 5. Community Graph Building

Location: `community-graph-poc/community_graph/`

### 5.1 Ingestion Pipeline

```
POST /api/ingest/file (file + description + toc_text + metadata)
  |
  v
engine.ingest_file()
  |  1. Parse file (PyMuPDF) -> full_text
  |  2. Generate description (if empty) via LLM
  v
ingestion.ingest(description, toc_text, full_text, metadata)
  |  3. Extract concepts via LLM:
  |     - High-Level (HL): broad topics (5-8 per document)
  |     - Low-Level (LL): specific terms (5-8 per document)
  |  4. Generate embedding for description (1536-dim, text-embedding-3-large)
  |  5. Generate embeddings for each concept
  v
STORE in PostgreSQL:
  |  - DocumentNode (description, embedding, hl_concepts, ll_concepts, meta)
  |  - Concept records (one per HL/LL concept, with embedding)
  |  - ConceptDocument links (M2M)
  |  - Community assignment (single-member PROVISIONAL initially)
  v
RETURN: document_id
```

### 5.2 Edge Building

Edges are computed between document pairs based on:

| Edge Type | Source | Computation |
|-----------|--------|-------------|
| SIMILARITY | Pairwise | Jaccard overlap of HL/LL concepts + cosine similarity of description embeddings |
| CITES | Citation detection | Raw citation text matched to other document titles |
| SHARED_CONCEPT | Computed on-the-fly in `/api/graph-data` | Documents sharing >= 1 concept |

### 5.3 Community Detection

Communities are detected using the **Leiden algorithm** (`leidenalg` with `RBConfigurationVertexPartition`).

**Two-phase lifecycle:**

1. **Ingestion phase** (`ingestion.ingest()`):
   - If existing REAL communities with centroids exist, the document is scored against each (cosine similarity of description embedding vs community centroid + concept overlap)
   - If the best score >= `assignment_threshold`, the document joins that community
   - Otherwise, a single-member `PROVISIONAL` community is created

2. **Reoptimization phase** (`ingestion.reoptimize()` via `POST /api/reoptimize`):
   - Builds an igraph from all document edges (weighted by `edge_weight`)
   - Runs `leidenalg.find_partition()` with `resolution_parameter` (default 1.0)
   - Creates `REAL` communities with proper multi-document clustering
   - Computes centroid embeddings (mean of member description embeddings)
   - Computes dominant concepts (concepts appearing in >= 30% of members)
   - `handle_provisional()`: promotes provisionals meeting cohesion + size thresholds, or dissolves stale ones by reassigning members to nearest REAL community

**Note:** Reoptimization is not automatically triggered after each ingestion. It must be called via `POST /api/reoptimize?workspace_id=X` (e.g., after bulk uploads or on a schedule).

---

## 6. Runtime Deep Search (Agent Conversation)

### 6.1 Tool Visibility Gating

```
Playbook: deepSearch = true (whole playbook)
  |
  v
NestJS: gRPC RunStepRequest.deep_search_enabled = true
  |
  v
ADK: chatbot_servicer reads deep_search_enabled
  |  passes to UserRequest schema
  v
ADK: agent factory / step node
  |  calls MCPHelper.create_vectorstore_toolsets_with_deep_search(deep_search=True)
  |  sets header: X-Deep-Search: true
  v
MCP SERVER: MCPDeepSearchMiddleware reads header
  |  sets ContextVar + get_http_request().headers
  v
DeepSearchAwareMCP._mcp_list_tools()
  |  if X-Deep-Search is true: ALL tools listed (including search_relevant_documents)
  |  if absent/false: search_relevant_documents STRIPPED from tool list
  v
AGENT sees (or doesn't see) the tool
```

### 6.2 Semantic Search Query

When the agent calls `search_relevant_documents(query, workspace_id, top_k)`:

```
MCP SERVER: search_relevant_documents()
  |  Guard: checks X-Deep-Search header (defense in depth)
  v
community_graph_client.query_community_graph(workspace_name, query, top_k)
  |
  v
COMMUNITY GRAPH: POST /api/query
  |  1. Embed query (1536-dim)
  |  2. Cosine similarity vs document embeddings
  |  3. Concept matching (query concepts vs doc HL/LL concepts)
  |  4. Graph expansion via edges (1-hop traversal)
  |  5. Hybrid score = weighted combination of all signals
  v
RETURN: ranked documents with scores, matched concepts, graph depth
```

---

## 7. Database Schema

Database: PostgreSQL with pgvector extension. 6 tables:

### document_nodes

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | gen_random_uuid() |
| workspace_id | TEXT | Indexed |
| file_name | TEXT | |
| description | TEXT | LLM-generated summary |
| description_embedding | vector(1536) | HNSW index, cosine ops |
| hl_concepts | TEXT[] | High-level concepts |
| ll_concepts | TEXT[] | Low-level concepts |
| toc_text | TEXT | Table of contents |
| full_text | TEXT | Complete document text |
| meta | JSONB | Extracted metadata (dynamic keys) |
| community_id | UUID FK -> communities | |
| community_level | INTEGER | |
| created_at | TIMESTAMP | |

### communities

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| workspace_id | TEXT | Indexed |
| level | INTEGER | Hierarchy level (0 = root) |
| parent_community_id | UUID FK (self) | |
| child_community_ids | UUID[] | |
| centroid_embedding | vector(1536) | HNSW index |
| dominant_hl_concepts | TEXT[] | |
| dominant_ll_concepts | TEXT[] | |
| description | TEXT | |
| member_count | INTEGER | |
| status | VARCHAR(20) | PROVISIONAL or REAL |
| created_at / updated_at | TIMESTAMP | |

### document_edges

Composite PK: (source_id, target_id, relationship_type)

| Column | Type | Notes |
|--------|------|-------|
| source_id / target_id | UUID FK -> document_nodes | CASCADE |
| relationship_type | VARCHAR(30) | SIMILARITY, CITES |
| hl_jaccard / ll_jaccard | FLOAT | Concept overlap |
| semantic_cosine | FLOAT | Embedding similarity |
| edge_weight | FLOAT | Combined weight |
| shared_hl_concepts / shared_ll_concepts | TEXT[] | |
| citation_raw_text / citation_type / citation_confidence | | For CITES edges |

### concepts

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| workspace_id | TEXT | Indexed |
| label | TEXT | Concept text |
| level | VARCHAR(2) | HL or LL |
| embedding | vector(1536) | HNSW index |
| document_frequency | INTEGER | |
| created_at | TIMESTAMP | |

### concept_documents

Composite PK: (concept_id, document_id)

| Column | Type | Notes |
|--------|------|-------|
| concept_id | UUID FK -> concepts | CASCADE |
| document_id | UUID FK -> document_nodes | CASCADE |
| level | VARCHAR(2) | HL or LL |
| weight | FLOAT | Default 1.0 |

### citations

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| source_document_id | UUID FK -> document_nodes | CASCADE |
| raw_text | TEXT | Citation as found in source |
| normalized_title | TEXT | |
| citation_type | VARCHAR(30) | |
| confidence | FLOAT | |
| resolved_document_id | UUID FK -> document_nodes | SET NULL |
| resolution_score | FLOAT | |
| status | VARCHAR(20) | UNRESOLVED, RESOLVED |

---

## 8. API Contracts

### Vectorstore API (:8005)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/vectorstores/indexDocumentFromCephStore` | Index document. Body includes `deep_research: bool` |

### Community Graph API (:8020)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/ingest/file` | Ingest document with metadata. Multipart: file + description + toc_text + metadata (JSON) |
| POST | `/api/query` | Semantic search. Body: `{ workspace_id, query, top_k }`. Returns ranked documents |
| GET | `/api/graph-data?workspace_id=X` | Full graph visualization data (documents, edges, communities, concepts) |
| GET | `/api/workspaces/{id}/metadata-keys` | Distinct metadata keys for normalization |

### MCP Server (:8001)

| Transport | Path | Purpose |
|-----------|------|---------|
| SSE | `/sse` | MCP SSE transport |
| HTTP | `/http` | MCP streamable HTTP transport |
| GET | `/mcp/tools` | Info endpoint listing all tools |

Headers required on all MCP requests:
- `Authorization: Bearer <MCP_API_KEY>`
- `X-User-Id: <user_id>`
- `X-Deep-Search: true` (only when deep search is enabled)

### NestJS Backend (:3000)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/workspaces/:workspaceId/documents` | Upload small file. FormData includes `deepSearch` |
| POST | `/workspaces/:workspaceId/documents/confirm` | Confirm upload. Body includes `deepSearch` |
| POST | `/workspaces/:workspaceId/documents/bulk/:sessionId/complete?deepSearch=true` | Complete bulk upload |
| POST | `/workspaces/:workspaceId/documents/:docId/reindex?deepSearch=true` | Manual reindex |
| GET | `/workspaces/:workspaceId/graph` | Proxy to community-graph `/api/graph-data` |

---

## 9. Cross-Boundary Contracts

### Wire field names

| Layer | Field name | Type |
|-------|-----------|------|
| Frontend / NestJS internals | `deepSearch` | boolean (camelCase) |
| NestJS to Vectorstore API | `deep_research` | boolean (snake_case JSON body) |
| NestJS to ADK via gRPC | `deep_search_enabled` | bool (protobuf field 10) |
| ADK to MCP Server | `X-Deep-Search` | HTTP header, value "true" |
| Vectorstore to Community Graph | `metadata` | JSON string in multipart form data |

### Context propagation through Celery chain

The deep-research task receives a context dict from the preceding logical indexing task. Keys are preserved via `**context` spreading through the chain:

```
compile_logical_document_task -> process_logical_images -> store_logical_document
  -> deep_research_ingest_with_toc_task(context)
```

Required keys in context: `file_path`, `pdf_path`, `file_name`, `workspace_id`, `workspace_name`, `compiled_doc_path`.

---

## 10. Configuration & Environment Variables

### YellowStorm-poc (NestJS backend)

| Variable | Default | Purpose |
|----------|---------|---------|
| `INDEXING_API_URL` | `http://localhost:4000` | Vectorstore API URL |
| `DATABASE_URL` | | PostgreSQL for logical indexing |

### YellowStorm-poc (ADK)

| Variable | Default | Purpose |
|----------|---------|---------|
| `VECTORSTORE_MCP_URL` | | MCP server URL for logical search |
| `COMMUNITY_GRAPH_MCP_URL` | None | Community graph MCP URL (fallback for direct tool calls) |
| `LITELLM_BASE_URL` | | LiteLLM proxy for LLM calls |
| `LITELLM_API_KEY` | | LiteLLM API key |

### Yellowstorm-vectorstore

| Variable | Default | Purpose |
|----------|---------|---------|
| `COMMUNITY_GRAPH_URL` | `http://localhost:8000` | Community graph service URL |
| `DEEP_RESEARCH_QUEUE` | `deep-research` | Celery queue name |
| `LITELLM_API_KEY` | | For metadata extraction LLM calls |
| `LLM_CLASSIFICATION_MODEL` | | Model name for metadata extraction |
| `CELERY_BROKER_URL` | | Redis broker URL |
| `CELERY_RESULT_BACKEND` | | Redis result backend |

### community-graph-poc

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | | PostgreSQL connection string |
| `LITELLM_BASE_URL` | | LiteLLM proxy URL |
| `LITELLM_API_KEY` | | LiteLLM API key |
| `EMBEDDING_MODEL` | `text-embedding-3-large` | Embedding model |
| `EMBEDDING_DIMENSION` | `1536` | Embedding vector dimension |
| `LLM_MODEL` | | LLM model for concept extraction |

### mcp-server-logical-search

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | | PostgreSQL connection string |
| `MCP_API_KEY` | | Bearer token for MCP auth |
| `MCP_HOST` | `localhost` | Server bind host |
| `MCP_PORT` | `8001` | Server bind port |
| `COMMUNITY_GRAPH_URL` | `http://localhost:8020` | Community graph URL for queries |

---

## 11. Migration Scripts

| Repo | Script | Purpose |
|------|--------|---------|
| community-graph-poc | `scripts/migrate_add_metadata_column.sql` | Add `meta` JSONB to document_nodes (for existing DBs) |
| Yellowstorm-vectorstore | `scripts/init_community_graph_tables.sql` | Full schema: 6 tables + HNSW indexes + pgvector |

Both scripts are idempotent (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).
