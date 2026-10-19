# Operations

This guide covers installation, configuration, logging, database indexes and
large-corpus testing. See [architecture and functions](logical-search.md) for
retrieval behavior and API contracts, and [maintenance history](maintenance-history.md)
for dated audits and earlier measurements.

Before deploying, follow [security configuration and rollout](security-configuration.md)
for dynamic workspace headers, approved model origins, database
TLS, authenticated documentation, and non-root log-directory permissions.

## Requirements

- Python 3.12 (the Docker image uses 3.12)
- PostgreSQL with the pgvector extension
- A database already populated with the logical indexing tables and document data
- A LiteLLM gateway serving the `qwen3-vl-embedding` model

## Configuration

Create a `.env` file in the project root:

```dotenv
MCP_HOST=0.0.0.0
MCP_PORT=8045
MCP_API_KEY=replace-with-a-secret

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/logical_indexing
DB_POOL_SIZE=5
DB_MAX_OVERFLOW=10

LITELLM_BASE_URL=https://your-litellm.example/v1
LITELLM_API_KEY=replace-with-a-secret
OPENAI_MODEL=qwen3-vl-embedding
RESUME_MODEL=gpt-5.4-mini
EMBEDDING_DIMENSION=2048

PAGE_THRESHOLD=20

LOG_LEVEL=INFO
REQUEST_LOG_ENABLED=false
REQUEST_LOG_DIR=logs
```

The essential settings are:

| Variable | Description |
|---|---|
| `MCP_HOST` | Bind address. Required by the settings model. |
| `MCP_PORT` | Published/configured port; defaults to `8045`. The current entry point listens on container port `8045`. |
| `MCP_API_KEY` | Required service bearer token, including health probes; document access also requires the trusted backend's dynamic `Workspace-Id` header. Probes additionally require an allowed peer network. |
| `DATABASE_URL` | Required PostgreSQL URL. Plain `postgresql://`, asyncpg, and psycopg2 URL forms are accepted. |
| `LITELLM_BASE_URL` | Gateway URL for chat and embedding models. |
| `LITELLM_API_KEY` | Bearer token for the gateway. |
| `OPENAI_MODEL` | LiteLLM embedding model alias; defaults to `qwen3-vl-embedding`. |
| `RESUME_MODEL` | Chat-completion model used only by the standalone `POST /routing-profile` endpoint. |
| `EMBEDDING_DIMENSION` | Vector dimension used by SQLAlchemy models; must match the model output and stored index. LiteLLM uses the model's default output dimension. |
| `PAGE_THRESHOLD` | Largest document size that uses `read_all`; defaults to 20 pages. |

Restart after changing embedding settings. Stored document, section, block and
filename vectors must use the same model and dimension as query embeddings.
Switching models requires re-embedding existing indexed data through ingestion;
changing this configuration does not migrate the stored vectors.

## Run locally

### Optional search stages and deadlines

| Setting | Default | Effect |
| --- | --- | --- |
| `QUERY_TRANSLATION_ENABLED` | `true` | Translate the query for the scoped document languages; false uses the original query for each language |
| `SEARCH_FILENAME_SEMANTIC_ENABLED` | `true` | Embed filename clues; false skips this stage and assigns the full filename budget to keyword matching |
| `SEARCH_REQUEST_TIMEOUT_SECONDS` | `30` | Overall search deadline |
| `EMBEDDING_TIMEOUT_SECONDS` | `15` | Query embedding/model-admission budget |
| `QUERY_TRANSLATION_TIMEOUT_SECONDS` | `5` | Shared language-detection, model-admission and translation-retry budget |
| `SEARCH_FILENAME_SEMANTIC_TIMEOUT_SECONDS` | `5` | Optional filename semantic budget |
| `SEARCH_RETRIEVAL_RESERVE_SECONDS` | `5` | Time kept for database retrieval and response assembly after optional stages |

With default weights, filename relevance contributes 5%: 3% text and 2% semantics
when enabled, or 5% text when disabled. There is no separate semantic-share
setting. Removing translation or filename semantics can change search results.
Expired optional stages use their existing fallback rather than extending the
search deadline. Restart the server after changing `.env`.

### Start the service

Create and activate a virtual environment, then install dependencies:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Start the server:

```powershell
python run_mcp_server.py
```

The default base URL is `http://localhost:8045`.

## Run with Docker Compose

After creating `.env`, run:

```powershell
docker compose up --build
```

Compose builds the Python service, maps `${MCP_PORT:-8045}` on the host to port `8045` in the container, mounts `./logs`, and restarts the service unless stopped.

The Compose file does **not** start PostgreSQL or LiteLLM. Their URLs must point to services reachable from the container; `localhost` inside the container refers to the container itself.

## HTTP endpoints

| Path | Description |
|---|---|
| `/` | Server information and the tools/resources visible for the request headers. |
| `/tools` | Tool names, descriptions, and input schemas. |
| `/resources` | Static resources and resource templates. |
| `/sse` | Mounted MCP transport endpoint. |
| `/http` | Mounted streamable HTTP MCP transport endpoint. |

Example inspection request:

```powershell
$headers = @{ Authorization = "Bearer replace-with-a-secret" }
Invoke-RestMethod -Uri http://localhost:8045/tools -Headers $headers
```

An MCP client must send both the bearer token and the allowed workspace header when calling document tools.

## Language model artifact

The application uses only `models/lid.176.bin`. The unused compressed
`lid.176.ftz` has been removed. Keep the `.bin` file: startup checks its checksum
and fails if it is missing or mismatched. `LANGUAGE_MODEL_PATH` defaults to
`models/lid.176.bin`. Changing the path does not bypass checksum verification.
The Docker build provisions the verified model. To provision it locally:

```powershell
python -m scripts.provision_language_model --url https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.bin --destination models/lid.176.bin
```

For offline provisioning, use `--source` with a verified local artifact instead
of `--url`. Source documents and embedding models are not stored in this folder.

## Logs

Normal application logs go to the console. Optional tool and PostgreSQL request
logs are controlled through `.env`:

```dotenv
REQUEST_LOG_ENABLED=false
REQUEST_LOG_DIR=logs
REQUEST_LOG_SAMPLE_RATE=0.05
REQUEST_LOG_MAX_CHARS=20000
REQUEST_LOG_QUEUE_SIZE=1000
REQUEST_LOG_MAX_BYTES=10000000
REQUEST_LOG_BACKUP_COUNT=3
```

When enabled, `tool_calls.jsonl` and `postgresql_requests.jsonl` are written under
`REQUEST_LOG_DIR`. A relative path is relative to the process working directory.
Sampling `0.05` records approximately 5% of requests; `1.0` selects all requests.
Logs rotate at the configured byte size, retaining the configured backups.
Docker Compose overrides the container path to `/app/logs` and mounts `./logs`
on the host. Diagnostic scripts can write their own reports under `logs`
independently of request logging. Restart the service after changing settings.

## Reading budgets and shutdown

`read_content`, `read_sections`, and `read_blocks` share a per-call
`READ_REQUEST_TIMEOUT_SECONDS` deadline (default 30 seconds), including database
admission. Before each reader SQL statement, the remaining time limits PostgreSQL
`statement_timeout`; no new statement starts after expiry.

`read_content` loads the complete indexed document without row limits, pagination,
or a response byte budget. It returns section-grouped text chunks and all stored
images; a document ID list returns one content result per requested document.
Successful reads contain no delivery, truncation, or continuation metadata.

Section reads load at most `READ_BLOCK_PAGE_SIZE` blocks (default
1000) and `READ_IMAGE_PAGE_SIZE` images (default 20), plus one lookahead row per
stream. Follow `required_next_tool_call` with `block_offset` and `image_offset`
until it is absent for a section. Continuation requires a single section and assumes the
stored document remains unchanged between calls. Blocks and images retain their
stable order within each stream.

The shared `READ_CONTENT_BATCH_MAX_BYTES` budget applies to section evidence items,
including image payloads, and image attachments from targeted retrieval tools.
It does not apply to `read_content`. `omitted_evidence` retains IDs excluded
by this budget; resolve those separately with targeted reads. A last continuation
page does not claim the entire section was delivered: `retrieval_complete=true`
is reserved for complete content delivered in one call. Exhausted batches mark
later inputs `not_evaluated` and provide follow-up calls. Row limits bound fetched
item counts, not the size of an individual stored block or image; the byte budget
is an evidence delivery budget, not an exact wire-size or peak-memory limit.

Section batches now resolve their selected IDs and owning documents in one SQL
query, then fetch bounded block and image pages with per-section window limits.
Repeated section inputs retain their positions using `shared_section_index`.
Overlapping `expand_context` evidence uses `shared_evidence` with the first
`context_index`, `relation`, and `section_index`; IDs and citations are preserved.
These references are valid only within that response.

All synchronous database operations submitted through the shared adapter now
check their deadline/caller cancellation before new SQL. HTTP document coverage
also checks before each document. Permits remain held until the worker finishes.
During shutdown, new database/model admission stops and readiness returns 503.
The server waits `SHUTDOWN_GRACE_SECONDS` (default 30); if a blocking thread still
runs, resource closure is deferred until it finishes instead of closing its pool
or HTTP client underneath it. Threads are not forcibly killed. Process-level
termination may end the deferred cleanup task; the operating system then reclaims
resources. Give the service termination grace enough time for provider timeouts.

## Verification

CI runs unit and PostgreSQL integration tests on opened, updated, and reopened
PRs. Its isolated [ParadeDB image](https://hub.docker.com/r/paradedb/paradedb/tags)
is pinned to `0.18.9-pg17`, matching the configured database's inspected `pg_search`
patch version. Build/deploy remains restricted to merged PRs or manual dispatch.
Repository administrators still need to require the `test` check in branch protection.

Run the same integration tests locally by setting `TEST_DATABASE_URL` to an
isolated database with pgvector and pg_search, then running
`python -m unittest discover -s tests`. Tests create and remove a unique schema;
they never use the application's `DATABASE_URL` for fixtures. Run
`python -m scripts.setup_database` for a read-only catalog check of the configured
database. See [maintenance scripts](../scripts/README.md) for database setup and
retained diagnostic utilities.

## Large database search

The scalable path removes whole-workspace document metadata and document-ID
arrays from Python discovery. This is a capacity improvement; it is not evidence
that the service has passed a million-document test or that every query is faster.

### Implemented

- `SEARCH_SCALABLE_SCOPE_ENABLED=true` keeps authorized document filters in SQL.
  Metadata is loaded only for bounded retrieval candidates. Single-document
  diversity decisions need at most two identity rows; language discovery returns
  distinct configurations.
- Workspace-only vector queries filter the child table directly. Workspace-only
  BM25 queries can also skip the document join when the scope has one language
  configuration. Narrower scopes retain their document filters before the
  candidate limit.
- Filename text scores and issuer detection use indexed SQL expressions. Filename
  semantics still uses the existing scorer and at most
  `SEARCH_FILENAME_SEMANTIC_MAX_FILES` filenames. A one-keyword query does not scan
  all matching filenames to compute an already-known rank level.
- MCP search aggregates selected sections' block counts and page ranges in SQL,
  rather than returning every block ID to Python. Its public evidence response is
  unchanged. The native full-section reader still loads full selected content.
- Block readers and citation lookup compare numeric primary keys directly while
  preserving external aliases and collision handling. Readers avoid fetching
  embedding columns they do not use. Broad reader scopes remain SQL subqueries.
- DB and model admission now have bounded waiting queues: `DB_QUEUE_LIMIT=100`
  and `MODEL_QUEUE_LIMIT=100`, in addition to existing running-worker limits and
  deadlines. Search HTTP overload returns 503, `Retry-After: 1`, and
  `retryable: true`. MCP overload surfaces as a tool error with a retry message.
  Optional semantic preparation can fall back to lexical retrieval when model
  capacity is occupied. Clients should retry with backoff and jitter.

### Index rollout

Run from the repository root with the environment of the target database:

```powershell
python -m scripts.setup_database
python -m scripts.setup_database --apply
```

The first command checks the catalog and writes a report with SQL for missing
indexes. The second installs missing extensions and indexes, then verifies them.
Run setup manually once after ingestion prepares each database; MCP startup does
not run it. Healthy equivalent indexes are reused even when named differently.
Missing tables/columns or incompatible existing indexes require an ingestion
migration or manual review. Builds consume CPU, I/O and disk space, so complete
them before load testing. PostgreSQL maintains these indexes during ingestion.

| Index | Purpose |
| --- | --- |
| `idx_documents_filename_tokens` | GIN lookup of normalized filename tokens |
| `idx_documents_filename_issuer` | Exact normalized issuer lookup |
| `idx_documents_workspace_filename_order` | Workspace filename preselection ordering |
| `idx_documents_workspace_fts` | Scoped language discovery |
| `idx_blocks_doc_page_id` | Ordered document/page reading |

These five indexes remain MCP-specific. The same setup command also checks and
supplies missing shared ingestion indexes: lookup indexes, section/block GIN,
cosine vector indexes and bilingual ParadeDB BM25 indexes. It never creates
tables, changes document data or replaces ingestion triggers. A failed concurrent
build can leave an invalid index; the script reports it for manual repair. See
[database setup](../scripts/README.md#one-time-database-setup) for ownership and limits.

Restart the service to load the new code/settings. To roll discovery back, set
`SEARCH_SCALABLE_SCOPE_ENABLED=false` and restart. The extra indexes can remain.
Queue limits and bounded block metadata are independent of that switch.

### Search behavior and compatibility

Fusion weights, minimum vector score, candidate budgets, filename dense ranks,
issuer narrowing, exclusions, document diversity and evidence limits retain
their existing definitions. Fixed-candidate replay checks that fusion and
selected-section metadata remain equivalent.

Actual results can change. SQL scopes can change vector plans and approximate
candidates. BM25 scoring/order can also differ when PostgreSQL/ParadeDB applies
filters in a different plan; the live comparison observed both changed scores
and tied candidate selection. This is not a claim that relevance improved.
Evaluate acceptable evidence, not just identical section IDs.

The configured database was running `pg_search` 0.18.9 during implementation.
Unprotected document subqueries produced missing BM25 scores in some live plans.
The scalable compatibility path materializes lexical scores before joining a
narrow or mixed-language document scope, and applies its top-N limit afterward.
This avoids admitting out-of-scope candidates or losing matches by limiting too
early. It can materialize many keyword matches inside PostgreSQL, so broad terms
in a huge mixed-language workspace remain a performance ceiling. Workspace-only,
single-language discovery avoids that materialization. Validate a supported
ParadeDB upgrade separately before changing this query shape. An alternative
scalar-array probe closed a database connection unexpectedly; that query shape
is not used in the implementation.

SQL filename normalization matches the tested English/French names, fiscal-year
and form aliases, sharp-s, Greek and full-width samples. PostgreSQL `lower()` and
its Unicode character classes are not universally identical to Python
`casefold()`/regular expressions. Unusual Unicode filenames can therefore alter
filename matches. Test those names in the company's corpus.

### Verification and company load test

```powershell
python -m unittest discover -s tests
python -m scripts.setup_database
```

The second command checks the configured database catalogs without model API
calls or document scans. Historical implementation checks used hundreds of
documents, not millions, and did not show a consistent latency win. Catalog
readiness does not establish search latency, recall or large-corpus capacity.

For real transport/model latency, create a local JSON array of MCP `search`
arguments, for example:

```json
[
  {"query": "capital expenditures in 2024", "workspace_id": "large-workspace", "top_k": 5},
  {"query": "contract renewal conditions", "workspace_id": ["workspace-a", "workspace-b"], "top_k": 5},
  {"query": "revenue", "workspace_id": "large-workspace", "document_id": "indexed-document-id", "top_k": 3}
]
```

Set the service API key in the `MCP_API_KEY` environment variable, then run:

```powershell
python -m scripts.load_test_search --url http://localhost:8045/http/ --cases search-cases.json --requests 100 --concurrency 4 --output logs/load-c4.json
```

This runner sends real MCP calls and can incur model costs. It uses a fixed
number of client workers, includes warmup, and reports p50/p95/p99 latency,
response sizes, throughput including startup/warmup, and errors. It saves no
queries or result contents. It is a closed-loop probe, so throughput depends on
response time; it does not model a fixed external arrival rate. A successful
protocol call does not prove correct or complete evidence.

Query and filename embeddings are recomputed on every request; cold/warm runs
refer to database buffers and connection/model-provider behavior.

Run equivalent workloads with the scalable flag false and true, using the same
data and hardware. Start with concurrency 1, 4, 8 and 16. Include broad/common
terms, filename clues, known-file searches, empty matches, exclusions and both
languages. Repeat cold and warm runs. Test one workspace containing millions of
files separately from many smaller workspaces. Label evidence for a fixed query
set and measure recall alongside latency and errors.

Measure application RSS/event-loop delay, queue waits, DB connections/CPU/I/O,
temporary spill, index sizes, and query plans. Separate model latency from DB
latency with stage logs. After ingestion, update planner statistics and inspect
vector/BM25 plans on the actual large corpus. Load testing and index building
should use a staging copy of the company corpus.

### Remaining capacity limits

- Queue/worker limits are per process, not tenant-fair admission or a global
  connection budget. Account for every replica's DB/model permits.
- Existing global HNSW/BM25 indexes still determine large-corpus retrieval cost
  and recall. Partitioning, ANN scan tuning, replica sizing and disk/RAM sizing
  need company-scale measurements before a database migration.
- Explicit hierarchy expansion loads the selected document's hierarchy; the
  native reader loads selected sections' full content. Very large individual
  documents/sections need separate reader/context benchmarks.
- This change does not move image bytes, remove citation positions, change the
  embedding dimension, or remove traceability fields.

Acceptance should require bounded application memory under sustained traffic,
stable throughput, controlled retryable overload, agreed error/timeout rates,
acceptable p95/p99 latency, and evidence recall at the company's target size.
