# Semantic Model Graph Search and MCP: implementation plan (adjusted)

**Date:** 1 October 2026
**Branch / commit checked:** `semantic-ux/phase-1` @ `cb82c41a6`. That commit retired the old chat search path.
**Supersedes:** `yellowmind_age_graph_search_proof_plan.md`. This version replaces its assumptions with what the code and the development databases show.
**What was checked:**
- source inspection of runtime, back, front, adk and `mcp/mcp-semantic-model`;
- read-only queries against the development runtime database and the AGE database (extension versions, and an AGE parameter-map query).

No benchmark has been run.

**Implementation status (1 October 2026):** G1–G4 are implemented. G5 has not started: the gold-query benchmark, similarity-floor calibration and the HNSW decision remain. The Graph Viewer UI is optional and has not been built.

Decisions taken with the recommended defaults:
- **D1:** the runtime calls LiteLLM directly (`SEMANTIC_EMBEDDING_*`).
- **D2:** workspace filtering is always on, for chat and the editor.
- **D3:** `search_records` is kept.

Live check on the dev data:
- 8 bound revisions indexed;
- the published revision reused all 61 vectors from its draft;
- each query embedding takes about 1 s through LiteLLM;
- the similarity floor was set to 0.4 from the first probes.

> Goal: an agent working on a semantic model calls an MCP tool and gets two things:
> - **the populated records that best match its question**, found by exact keys, lexical search and embeddings over the accepted data revision;
> - **the records really connected to them**, read from that same revision's AGE graph.
>
> The search never rereads source documents. It returns graph facts and their stored provenance, not generated answers.

---

## 1. What changed from the original plan

| Topic | Original plan | Adjusted, based on the code |
|---|---|---|
| MCP / agent | Out of scope | **In scope.** It is the main consumer: new tools in `mcp/mcp-semantic-model`. The Graph Viewer UI becomes optional. |
| pgvector | Not verified | **Verified.** The runtime DB (`agentstore`, PG 17.6) already has `vector 0.8.0` and `pg_trgm 1.6`. `unaccent` is available but not installed. AGE runs on a **separate instance** (PG 16.14, AGE 1.6.0). |
| Embedding model | "Reuse a provider" | The only one is the **LiteLLM proxy**, `qwen3-embedding`, **2560 dims** (back `EMBEDDING_MODEL` / `EMBEDDING_DIMENSION`). The runtime has no embedding client today. |
| Vector type | `vector(D)` | `vector` HNSW is capped at 2000 dims, so use **`halfvec(2560)`**. This follows the `agents.role_embedding` precedent and keeps HNSW possible later. |
| AGE parameters | "Use prepared statements, test the driver" | **Tested.** asyncpg plus an `agtype` text codec runs `cypher(graph, $$ … $ids … $$, $1)` with a bound parameter map. The current projection code interpolates literals instead. |
| Corrections | "Build from the effective snapshot" | Corrections are **already applied when the revision is written**. `semantic_population.entities` **is** the effective snapshot, and every correction produces a new `dr_…` revision. |
| Typed predicates | Date/amount/status filters | **Out of scope.** Values are stored as TEXT, and the compiled spec carries **no field types, field descriptions or concept description**. |
| Field descriptors | "Extend the snapshot if missing" | The available fields are concept `label`, `aliases`, `fieldAliases`, `allowedFields` and `keyComponents`. Adding descriptions **changes `specHash`**, which triggers a rebuild, so it is deferred. |
| Per-source access | "Score only fully-readable records" | **Graph and records reads have no per-source filter today.** Only model role is checked; source grants exist only on the PostgREST data plane. A decision is needed (§11). |
| Durable trigger | Same transaction as the binding | The binding CAS and job admission are separate transactions today. Plan: an **idempotent admit after the CAS**, reconciliation at publish and on read, and an explicit backfill. |
| Pinning | Draft only | Two bindings: `draft` (editor) and `production` (published, used by chat). **Publish moves the same `data_revision_id` to production**, so no reindex is needed. |

---

## 2. Verified baseline

### Data and identifiers
- **Revision:** `data_revision_id = dr_<24hex>`, immutable. It includes `correction_sequence` (`population_store.revision_id_for`).
- **Entities:** `semantic_population.entities` holds:
  - `id = "{namespace}:{sha256[:32]}"`;
  - `concept_id`;
  - `label`;
  - `identity_key`, the JSON of the normalized identity values, trimmed and lowercased;
  - `attributes` JSONB;
  - `provenance` JSONB `{sources:[{assetRef, mappingVersion, rowNumbers}]}`.
  - PK `(data_revision_id, id)`.
- **Assertions:** `semantic_population.assertions` has one row per attribute: `value` TEXT, `origin` source|human|system, and `evidence` `{assetRef,rowNumber,column,pageNumber,correction,…}`. It stores no quote text.
- **Relationships:** `semantic_population.relationships` has `relation_id`, `source_entity_id → target_entity_id` and `state`.
- **Not populated:** `entity_identities`. Its writer `store_entity_aliases` exists but is never called.

### AGE
- One graph per revision, `pop_<data_revision_id>`.
- The ref `age:v1:pop_…` is stored in `data_revisions.projection_ref` and `semantic_runtime.active_bindings.projection_ref`.
- Vertices are `Entity`, with flat properties plus `record_id` (= entity id), `concept_id` and `label`. Edges are `RELATED_TO {relation_id}`, always source → target.
- **The only read is `read_projection_graph`**, which loads the whole graph with no LIMIT. That is what the Graph Viewer uses. No neighbour or traversal query exists.

### Bindings
- `semantic_runtime.active_bindings`, PK `(model_id, environment)`, with environment `draft|production|shadow|test` and a CAS `version`.
- Whole-model build → `finalize_draft_revision` → `cas_active_binding(environment="draft")`.
- `POST /models/{id}/publish` → `cas_active_binding(environment="production")` on the **same revision**.

### Jobs
- `JobService.admit` → `semantic_jobs.jobs/tasks/outbox` in one transaction → `OutboxDispatcher` → `celery send_task`.
- `job_type` is a free string. Today there are `population.run` and `datasource.discovery`.
- Queues: `semantic-model-population.{corrections,batch}` and `semantic-model-datasource.{preview,batch}`. Workers run `--pool=solo`.

### Models / LLM
- The runtime never calls a model directly. Attribute extraction goes runtime → back → ADK → LiteLLM.
- LiteLLM serves `qwen3-embedding` (2560) to back (`EmbeddingService`) and to the ADK.

### Back → runtime
- `SemanticRuntimeClientService` sends `X-Semantic-Service-Key` and `X-Actor-User-Id`.
- Authorization is `requireRole` (owner/editor/viewer).

### MCP
- `mcp/mcp-semantic-model/server.py` is FastMCP on port 8027. Each tool calls `back /api/v1/internal/semantic-model-assistant/...`, which is guarded by:
  - `InternalServiceGuard`;
  - `SemanticAssistantActorGuard`, which takes the acting user from `x-yellowstorm-user-id`;
  - `SemanticAssistantModelGuard`.
- The existing tool `search_records` uses ILIKE paging per concept (`search_revision_entities`).

### Chat today
- `stream.service.ts` resolves `resolveSearchSchema` (the published graph name) and sends `semantic_model_schema_name`. **Nothing in the adk reads it any more.**
- When a semantic model is selected, workspace contexts are skipped. **So a chat bound to a semantic model currently has no retrieval at all.** This plan fills that gap.

### Do not restore
- Migration 021, the `/v1/graphs/search/fused` contract, the `semantic_search` schema, and the adk `semantic_search` tool and preflight all stay retired.

---

## 3. Architecture (no new service)

```text
Agent (ADK) ──MCP──> mcp-semantic-model (8027)
                        │  X-Internal-Token + acting user
                        ▼
                     back: semantic-model-assistant internal controller
                        │  requireRole (+ allowed sources, §8)
                        │  X-Semantic-Service-Key + X-Actor-User-Id
                        ▼
                     runtime: /v1/semantic-model-search/*
                        ├─ agentstore (PG17): semantic_graph_search.*  ← seeds: exact / lexical / halfvec
                        ├─ AGE (PG16):        pop_<dr>                  ← traversal by record_id
                        └─ LiteLLM /v1/embeddings                       ← query embedding (and indexing, in the worker)
```

The bridge between the two databases is `(data_revision_id, entity_id)`. In AGE, `entity_id` is `Entity.record_id`. There is no cross-database join: retrieval and traversal are separate steps, and SQL hydrates the labels.

### New runtime modules

```text
app/graph_search/
    documents.py    # deterministic serializer + field policy + content hash
    embeddings.py   # LiteLLM /v1/embeddings client (batch, timeout, dimension check)
    indexer.py      # generation lifecycle, batching, cache reuse, readiness
    retrieval.py    # exact / lexical / vector seeds + rank fusion
    traversal.py    # allowlisted one-step Cypher templates, frontier filtering
app/persistence/graph_search_store.py
app/api/graph_search_routes.py          # prefix /v1/semantic-model-search
app/workers/graph_search_tasks.py       # task "semantic-model-search.index"
migrations/022_graph_search.sql
```

---

## 4. What gets embedded

### Documents
There is one document per entity per index generation. It is built from the `semantic_population.entities` row (which already includes corrections) and the revision's compiled spec (`semantic_runtime.specifications`).

### Serializer v1
The serializer is deterministic, versioned, and makes no LLM call.

```text
Type: {concept.label} ({concept.aliases joined})
Name: {entity.label}
{humanized key component}: {identity value}            # each keyComponent
{humanized field}{ (fieldAliases) }: {attribute value} # allowedFields order, non-empty only
```

Rules:
- **Field order** follows `allowedFields` order. Field names are humanized (`service_category` → "Service category"). `fieldAliases` are added in parentheses for vocabulary alignment.
- **Budgets:** each value is capped (proposed 300 chars) and the total is capped (proposed 2,000 chars). Omitted or shortened fields are recorded in `diagnostics`.
- **Excluded content:**
  - empty or placeholder values;
  - raw JSON;
  - internal ids;
  - provenance;
  - neighbour attributes, because relationships come from AGE, not from the text.
- **Exact-only entities:** an entity with only a label and no descriptive field is `exact_only`. This is not a failure.
- **Field policy v1:** all `allowedFields`. A per-concept `searchFields` override can come later as Advanced metadata **outside `specHash`**, so it doesn't force a population rebuild.

### Passages of long fields (serializer v2, `gs-doc-v2`)
The card above keeps only the first 300 characters of a value, so a long text (an e-mail `corps` of
5,000 characters, a contract body) was almost invisible. v2 keeps the card unchanged and also splits
every field the card **cut or left out** into passages, searched on their own (`documents.py`):

- **Size:** target 1,000 characters (~170 words), between 700 and 1,200. A passage ends at the
  boundary closest to the target, preferring a paragraph break, then a line break, then a sentence end
  (`. ! ? ; : …`), then a space; a text without any is cut hard at 1,200.
- **Overlap:** the next passage starts at the first sentence (else word) start in the last 150
  characters (~15%), so a sentence on a cut is whole in one passage.
- **Caps:** 20 passages per field, 50 per record (~20,000 characters of a field). A field not covered
  to its end is listed in the document's `diagnostics.truncatedPassageFields` and counted in the
  generation's `passage_truncated_count`; `diagnostics.passageFields` gives the count per field.
- **Text:** offsets (`start`, `end`) are in the stored value; the passage text is that slice with
  whitespace collapsed. What is embedded is a header plus the text:
  `Type: {concept label}
Name: {record name}
Field: {field (aliases)}
{text}` (no part number, so
  a passage that does not change keeps its hash and its cached vector). The lexical vector holds the
  passage words only (the header words are on the card).
- **Cost:** one vector per passage, through the same `embedding_cache` (by content hash). Roughly one
  embedding call input per 850 new characters of long text; rebuilds of unchanged texts are free.
  Bumping the serializer to v2 changed the fingerprint: every model's next index is a new generation
  and its cards are embedded once more. Reads look up the generation of the current fingerprint, so
  until it is ready a search answers `index_not_ready` with exact matches only (the first read
  requests it); run `scripts/backfill_graph_search.py` right after deploying.

### Settings (Admin > Semantic models, per-field overrides)
The sizes above and the query constants of §7.2 are settings (`app/graph_search/settings.py`; defaults
are the values above). An admin sets them in YellowStorm (back: `semantic_model.extraction_settings`
`index_settings` / `search_settings`, migration 029); NestJS sends only the values set, with each
search and index request (`settings: {index, search}`), and the runtime fills in its defaults
(`SEMANTIC_SEARCH_MIN_SIMILARITY` stays the fallback of the similarity floor).

- **Index settings** (card value/total caps, long-field threshold, passage target/min/max/overlap,
  passages per field/record, passage header) shape the indexed text. They are part of the generation
  fingerprint (`{profile}:ix:{hash}`; default settings keep the bare profile fingerprint, so existing
  generations stay valid) and recorded on the generation (`index_settings`, runtime migration 025):
  other settings build another generation on the next search. A request without settings (after a
  population run) reuses the settings of the model's latest generation. Vectors stay cached by text
  and profile only, so a rebuild re-embeds only texts that changed.
- **Field overrides** live on the concept field definition (`attribute.searchIndex`: passages on/off,
  threshold, target/min/max/overlap, passages per field) and travel with the request by concept key and
  field key, taken from the definitions of the version whose data is searched; they are part of the
  fingerprint too. An override that no longer fits the global sizes is left out by NestJS.
- **Search settings** (lexical/vector candidates, similarity floor, RRF k, default/maximum results,
  passages per record, excerpt and snippet sizes, stop words and extra stop words, query terms) apply
  per request and never rebuild anything. Stop words (French and English, accent-folded) are left out
  of word matching unless the query holds nothing else.

### Embedding profile
The profile is pinned, and its hash is the `embedding_fingerprint`:

```text
provider=litellm  model=qwen3-embedding  dimension=2560  distance=cosine  normalize=l2
document_prefix=""  query_prefix="Instruct: Given a search request, retrieve the business records that match it\nQuery: "
serializer=v1  field_policy=v1
```

Qwen3-Embedding expects an instruction on the query side only. G1 must measure whether the prefix helps through LiteLLM; keep whichever version wins, inside the fingerprint.

### New runtime environment variables
- `SEMANTIC_EMBEDDING_BASE_URL`
- `SEMANTIC_EMBEDDING_API_KEY`
- `SEMANTIC_EMBEDDING_MODEL`
- `SEMANTIC_EMBEDDING_DIMENSION`
- `SEMANTIC_EMBEDDING_TIMEOUT_SECONDS`
- `SEMANTIC_EMBEDDING_BATCH_SIZE` (default 32)

The client checks four things:
- the vector count matches the input count;
- every vector has the configured dimension;
- every value is finite;
- no vector is zero.

Unlike back's `EmbeddingService`, it fails explicitly and never returns `null`. It also refuses ADK-style fake embeddings: `FAKE_EMBEDDINGS` produces 1536 dimensions.

---

## 5. Storage (migration `022_graph_search.sql`, schema `semantic_graph_search` in agentstore)

```sql
-- vector 0.8.0 is already installed in agentstore; the migration asserts it rather than creating it.
CREATE SCHEMA semantic_graph_search;

CREATE TABLE semantic_graph_search.index_generations (
  index_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id              TEXT NOT NULL,
  data_revision_id      TEXT NOT NULL REFERENCES semantic_population.data_revisions(id) ON DELETE CASCADE,
  projection_ref        TEXT NOT NULL,          -- copied from data_revisions at creation
  spec_hash             TEXT NOT NULL,
  embedding_fingerprint TEXT NOT NULL,
  state                 TEXT NOT NULL CHECK (state IN ('queued','indexing','ready','failed','superseded')),
  expected_count INT, indexed_count INT DEFAULT 0, exact_only_count INT DEFAULT 0, failed_count INT DEFAULT 0,
  embedding_calls INT DEFAULT 0, reused_count INT DEFAULT 0,
  job_id UUID, last_error_code TEXT, created_at TIMESTAMPTZ DEFAULT now(), completed_at TIMESTAMPTZ,
  UNIQUE (data_revision_id, embedding_fingerprint)
);

CREATE TABLE semantic_graph_search.entity_documents (
  index_id      UUID REFERENCES semantic_graph_search.index_generations ON DELETE CASCADE,
  entity_id     TEXT NOT NULL,
  concept_id    TEXT NOT NULL,
  label         TEXT NOT NULL,
  exact_keys    TEXT[] NOT NULL,     -- normalized entity id, identity values, label
  source_refs   TEXT[] NOT NULL,     -- from provenance.sources[].assetRef (access filter, §8)
  search_text   TEXT NOT NULL,
  lexical       tsvector NOT NULL,   -- to_tsvector('simple', accent-folded search_text)
  content_hash  TEXT NOT NULL,
  embedding     halfvec(2560),       -- NULL when exact_only / pending
  status        TEXT NOT NULL CHECK (status IN ('pending','ready','exact_only','failed')),
  diagnostics   JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (index_id, entity_id)
);
-- B-tree (index_id, concept_id); GIN (exact_keys); GIN (lexical); GIN trigram on lower(label).

CREATE TABLE semantic_graph_search.embedding_cache (
  model_id TEXT, embedding_fingerprint TEXT, content_hash TEXT,
  embedding halfvec(2560) NOT NULL, created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (model_id, embedding_fingerprint, content_hash)
);
```

Passages (migration `024_graph_search_passages.sql`):

```sql
CREATE TABLE semantic_graph_search.entity_passages (
  index_id, entity_id  -- FK to entity_documents (index_id, entity_id) ON DELETE CASCADE
  ordinal INT,         -- per record, field order; PRIMARY KEY (index_id, entity_id, ordinal)
  concept_id, field_key, field_label, start_offset, end_offset,
  passage_text TEXT,   -- shown in answers
  search_text TEXT,    -- header + passage, embedded
  lexical tsvector, content_hash, embedding halfvec(2560), status ('pending'|'ready'),
  source_workspaces TEXT[]   -- the record's, for the same access filter
);
-- B-tree (index_id, concept_id); partial (index_id) WHERE pending; GIN (lexical). No ANN index.
ALTER TABLE index_generations ADD passage_count, passage_indexed_count, passage_truncated_count;
```

Passages live and die with their generation (and their record's document): pruning, a revision
delete and the model purge remove them by cascade; a model clone copies no index.

Notes:
- **Cache scope:** the cache is scoped per model, so it can't reveal anything across models. A correction or rebuild creates a new revision and a new generation, and unchanged entities reuse their vectors at **zero embedding calls**.
- **Accents:** `unaccent` is not installed, so accent folding (NFKD + strip) happens in Python for both stored text and queries. That avoids a new extension.
- **Search method:** start with exact cosine search over one `index_id` (plus concept filter). Leave out HNSW until measured; when needed, use `halfvec_cosine_ops` and compare recall against the exact baseline.
- **Grants:** `semantic_app` needs the same schema grants as the other runtime schemas. Update `deploy/data-plane/scripts/bootstrap_dataplane.py` (`SCHEMAS`) and `compatibility-manifest.json`. The manifest is currently stale: it lists only `pgcrypto` for agentstore.
- **Retention:** keep generations bound to `draft`/`production` plus the last 2 per model, and mark the rest `superseded`. A cleanup sweep drops superseded generations after N days.

---

## 6. Indexing

### Task
- `job_type="graph_search.index"`, Celery task `semantic-model-search.index`.
- New queue `semantic-model-search.index`, consumed by a **third worker** added to `scripts/start-workers.ps1` (`-Only search`). Workers are `--pool=solo`, so indexing on the population queue would hold up population runs.

### Steps
1. Resolve the revision and spec. Check that `projection_ref` is set and that `projection_exists`.
2. Create or reuse the generation, keyed by `UNIQUE(data_revision_id, fingerprint)`. Return early if it is `ready`.
3. Insert `entity_documents` (text, hash, keys, `source_refs`) in one pass, with status `pending`. Fill vectors from `embedding_cache` and mark those rows `ready`.
   Insert the passages of every document the same way, and fill theirs from the same cache.
4. Embed the remaining `pending` rows in batches (records first, then passages; progress reports
   `embedded` and `passagesEmbedded` beside `reused` / `passagesReused`).
   - Commit each batch, then write it into the cache. No transaction is held during HTTP calls.
   - Progress is just a count over `entity_documents`, so a crash or duplicate delivery resumes on the remaining `pending` rows.
5. **Readiness check:**
   - the number of documents equals the number of entities in the revision;
   - no row is `pending` or `failed`;
   - every passage has its vector.

   If both hold, CAS `state indexing → ready` fenced by the task lease epoch. Otherwise the state becomes `failed` with `last_error_code`, keeping its counts.

### Triggers (all idempotent; idempotency key `gsi:{data_revision_id}:{fingerprint}`)
- **After the draft binding CAS** in `finalize_whole_model_build`.
  - The search index is admitted right after.
  - If admission fails, it is logged and does not fail population; reconciliation recovers it.
  - An embedding outage never touches the AGE projection or the binding.
- **In `POST /models/{id}/publish`:** an ensure-admit. It is normally a no-op, because the same revision was already indexed as draft.
- **Reconciliation:** any search or status read whose bound revision has no `ready` generation returns `index_not_ready` and admits the job. Search reads alone never build anything inline.
- **Backfill:** `POST /v1/semantic-model-search/indexes {modelId, environment}`, plus `scripts/backfill_graph_search.py --model … | --all`. Existing models become searchable **without repopulating**.

Graph readiness and index readiness are separate states. `graph ready + index preparing` is legitimate; exact lookup and traversal keep working in that state.

---

## 7. Query logic

### 7.1 Pinning
- The caller names `modelId` and `environment`:
  - `production` is the default for chat; it requires the model to be published, or the response is `semantic_model_unavailable`.
  - `draft` is for the editor or the building assistant, and requires an editor role.
- The runtime reads `active_bindings` and gets `data_revision_id` and `projection_ref`, then finds the `ready` generation for `(data_revision_id, current fingerprint)`.
- An optional `expectedDataRevisionId` returns `active_binding_changed` on mismatch, matching the Records/Graph contract.
- The whole request uses that one triple.

### 7.2 Seeds (`POST /v1/semantic-model-search/query`)
1. **Exact.** The accent-folded, lowercased query is matched against `exact_keys`: entity id, identity values, label. A unique exact match is returned as match class `exact`, ahead of everything else. Several matches are returned as an explicit ambiguity. This step works without the embedding provider.
2. **Concept scope.** `conceptIds` can be given, or resolved from concept keys, labels or aliases. That resolution is deterministic matching in the spec, not embeddings.
3. **Lexical.** `ts_rank` over `lexical` plus trigram similarity on `label`, top 50.
4. **Vector.** One query embedding, then exact `embedding <=> $q` over `index_id` with the concept and access filters applied **before** the top-k, top 50.
5. **Fusion.** Reciprocal-rank fusion (k = 60) of lexical and vector **ranks**. Exact results stay in a separate, stronger class.
   Passages take part in both methods (top 50 records by their best passage, each with its 2 best
   passages). Within a method a passage stands for its record: the record's score there is the
   **best of its card's and its passages' scores** (cosine, or `ts_rank_cd`), then records are ranked
   and the two ranks fused as before. A long text is one more way to be found, not extra votes: an
   e-mail is not ranked above a short record whose card matches as well. (Fusing passage *ranks* as
   separate lists was tried first and failed: with few long records, the only one with passages is
   trivially first in the passage lists.) The similarity floor applies to the best similarity.
   Each seed gets `matchedIn` (`record` or `passage`: which gave its larger contribution) and
   `passages` (up to 2: `fieldKey`, `field`, `start`, `end` of the passage in the field value, and
   `text`, ~400 characters of the passage around the longest query words). `diagnostics` gains
   `lexicalFrom` / `vectorFrom`.
6. **Cutoff.** A calibrated minimum cosine (set during G5) produces an explicit `no_match` instead of a plausible-looking node. Default `limit` is 10, maximum 25.
7. **Provider down.** Mode `lexical_only` is returned, explicitly flagged. Vectors from another revision are never mixed in.

### 7.3 Expansion (`POST /v1/semantic-model-search/expand`)
- **Input:** `seedEntityIds` (≤ 25) and `steps` (≤ 2), each `{relationIds?, direction: outgoing|incoming|both}`, plus `maxNodes` (≤ 100).
- **Step 1** may omit `relationIds`. It then means "every relation touching the seed, both directions", which is a direct neighbourhood. **Step 2 must name its relations**, so Contract → Customer → *other contracts* never happens implicitly.
- **One Cypher query per step,** with a bound parameter map (verified with asyncpg plus the `agtype` codec):

  ```sql
  SELECT * FROM ag_catalog.cypher('pop_dr_…', $$
    MATCH (s:Entity)-[r:RELATED_TO]->(t:Entity)
    WHERE s.record_id IN $frontier AND r.relation_id IN $relations
    RETURN s.record_id, r.relation_id, t.record_id LIMIT $cap
  $$, $1) AS (s agtype, r agtype, t agtype)
  ```

  - The incoming variant swaps the pattern.
  - Graph name: taken from the pinned `projection_ref`, validated with `^pop_[a-z0-9_]{1,64}$`. It is never taken from caller input.
  - Relation ids: allowlisted against the revision spec.
  - Each query runs under `SET LOCAL statement_timeout`.
  - Add the codec in the AGE pool `init`.
- **Between steps,** the new frontier is filtered in SQL against `entity_documents` (same `index_id`): concept scope plus access (§8). A hidden node can't be used as a bridge.
- **Hydration:** labels, key fields and short descriptions come from `entity_documents`, and provenance comes from `entities`. AGE returns ids only.
- **Result rules:**
  - nodes and edges are deduplicated;
  - no node is revisited;
  - seed groups are preserved;
  - each node carries `inclusionReason`: `seed` or the actual path `[(entity, relation, direction)…]`;
  - when a cap or the deadline is hit, the response says `truncated: true`.
- **Neighbour scoring:** neighbours are never scored as semantic matches. Their reason for inclusion is the edge.

### 7.4 Structured record queries (`POST /v1/semantic-model-search/records-query`)

**Now supported** (`app/graph_search/record_query.py`, MCP `query_records` and `describe_model`):
- Filters on one concept: `eq ne contains starts_with ends_with in gt gte lt lte between is_empty
  not_empty`, combined with `all` or `any`. Text compares are case- and accent-insensitive.
- Date, number and yes/no comparisons with the field's declared type. Values stay TEXT; they are read at
  query time by one function (`typed_value_sql` in `typed_values.py`): ISO dates and datetimes, a month or
  a year alone (first day), `dd/mm/yyyy`, written French/English dates with weekday, time and zone
  (e-mail header dates), numbers with spaces, currencies and `,`/`.` decimals. A value that cannot be read
  is left out of the comparison and counted in `unparsable`. `as` reads a field with another type.
- Relative dates resolved in the runtime, UTC: `today`, `yesterday`, `last_N_days|weeks|months|years`
  (N units up to today), `this_/last_week|month|quarter|year`; a day, month or year value covers the whole
  period. The resolved range is echoed in `appliedQuery`.
- Counts and "all X": exact `total`, pages of records (≤ 200, `offset`/`nextOffset`, values cut at 1500
  characters), `group_by` up to two fields with date buckets, `count count_distinct sum avg min max`, at
  most 500 groups.
- One-hop relation filters: `<relation>.<field>` (relation key, label or inverse label) matches records
  linked through `semantic_population.relationships` (accepted links) to a readable record whose field
  matches; `<relation>` with `is_empty`/`not_empty` tests for a linked record.
- Same pinning as §7.1 and access as §8: the visibility filter runs in SQL before counting and paging; a
  linked record must be readable too. Every value and field key is a bound parameter; field keys come from
  the revision's allowed fields only; `statement_timeout` 10 s (`query_too_slow` past it).
- Field labels, aliases and types come from the back with each query (the version bound to the
  environment), since the specification holds keys only. Wrong names come back as `invalid_query` /
  `not_represented` with the part that is wrong and the names available.
- `POST /v1/semantic-model-search/records-overview`: concepts with key fields, queryable fields and the
  records the actor may see; relations with their two concepts (behind `describe_model`).

**Still not supported** (explicit errors, never an approximate answer):
- Grouping, sorting or totals on a linked record's field, and relation filters beyond one hop.
- Unparsable-value counts for linked records' fields.
- Time zones other than UTC for relative dates and buckets; periods written as ranges in one value
  ("June 2022 - July 2022") are unreadable dates.
- A typed projection table (values are cast at query time; to add when volumes need it, reusing
  `typed_value_sql`).
- Natural language → Cypher, and any language model inside the query path: the calling assistant plans.
- Document text retrieval (long text *fields* of records are searched through passages, §4).

### 7.5 Response contract

```text
modelId, environment, modelVersionId, dataRevisionId, projectionRef, indexId, embeddingFingerprint, modeUsed
status: found | no_match | not_represented | index_not_ready | partial
seeds[]:  entityId, conceptId, label, keyFields, snippet, matchClass (exact|lexical|vector|hybrid), rank, diagnostics,
          matchedIn? (record|passage), passages? [{fieldKey, field, start, end, text}]
nodes[] / edges[] (expand): entityId, conceptId, label, inclusionReason, path
provenance[]: assetRef, rowNumbers | pageNumber (as stored; not re-verified)
coverage: indexedCount, exactOnlyCount, passageCount, passageIndexedCount, passageTruncatedCount, materialization note, truncated
timings: embedMs, seedMs, expandMs
```

`not_represented` means the request names a concept or field that the spec doesn't have. It tells the agent "this information is not in the model", which differs from "no record matches".

---

## 8. Access control

**Today:**
- The Graph Viewer and the records reads check **only the model role**.
- Per-source filtering exists only for PostgREST:
  - `SemanticDataGrantService.issue` intersects the model's `source_mappings` with `workspaceShares.filterAccessible(actor)`;
  - the result is enforced by RLS `semantic_access.is_source_allowed`.

**Proposal:**
- Back computes the actor's allowed source refs with the same intersection as `SemanticDataGrantService.issue` and sends them as `allowedSourceRefs`.
- The runtime then:
  - drops every entity with any `source_refs` outside that set, at seeding **and at every expansion step**;
  - rechecks on every request, so revoking access needs no reindex.
- G1 must confirm how `provenance.sources[].assetRef` maps to a workspace/document source. Manual sources need their own rule.

Whether this runs from day one for MCP, and later for the editor, is decision D2 (§11).

---

## 9. API, back facade and MCP

### Runtime (service key + `X-Actor-User-Id`)

```text
POST /v1/semantic-model-search/indexes                 {modelId, environment}         -> {jobId, index}
GET  /v1/semantic-model-search/models/{modelId}/index  ?environment=                   -> generation state/counts
POST /v1/semantic-model-search/query                   {modelId, environment, query, conceptIds?, limit?, allowedSourceRefs?, expectedDataRevisionId?}
POST /v1/semantic-model-search/expand                  {modelId, environment, seedEntityIds, steps, maxNodes?, allowedSourceRefs?, expectedDataRevisionId?}
```

### Back (`semantic-model` module)
- `SemanticRuntimeClientService`: `graphSearch`, `graphExpand`, `searchIndexStatus`, `ensureSearchIndex`.
- `SemanticGraphSearchService`:
  - `requireRole`, where production needs viewer and draft needs editor;
  - the published check, the same as today's `resolveSearchSchema`;
  - allowed sources.
- Internal assistant controller: `POST …/semantic-model-assistant/models/:modelId/graph-search` and `…/graph-expand`, behind the existing guard chain.
- Public controller, for the editor and backfill: `POST /semantic-models/:id/search`, `POST /semantic-models/:id/search/expand`, `GET|POST /semantic-models/:id/search-index`.

### MCP (`mcp/mcp-semantic-model/server.py`, `READ_ONLY` annotations)
- `find_records(model_id, query, concepts=None, data="published", limit=10)` returns:
  - the seeds, with match class;
  - index state;
  - `not_represented` / `no_match`.
- `get_related_records(model_id, record_ids, relations=None, direction="both", then_relations=None, data="published", max_records=50)` returns the bounded subgraph with paths.
- Tool docstrings tell the agent four things:
  - results are records from the model, not documents;
  - a related record was included because of an edge, not because it matched;
  - when a result is truncated or the status is `index_not_ready`, say so;
  - never infer facts that no field holds.
- `search_records` (ILIKE paging per concept) stays until G5. After that, retire it or keep it as "list records" (D3).

### Chat wiring (back + adk)
- Replace the dead `semantic_model_schema_name` param with `semantic_model_id`.
- Bind the `mcp-semantic-model` connector (a trusted identity binding through `SEMANTIC_MODEL_MCP_SERVER_URL`) to the chat agent when a semantic model is selected.
- Keep the "publish this model to use it in chat" check.
- Remove `resolveSearchSchema` once nothing calls it.

---

## 10. Phases and gates

### G1 — Contract and storage
- Migration 022, grants, bootstrap and manifest update.
- `documents.py` serializer with field policy.
- `embeddings.py` client with fingerprint.
- AGE pool `agtype` codec.
- Confirm the `assetRef` → source mapping.
- A spike on 20 real queries: with and without the qwen3 query instruction.

**Gate:**
- the same entity yields the same text and hash;
- an edited value changes the hash;
- dimension and finiteness checks reject bad vectors;
- the provider-down path is explicit.

### G2 — Indexer, triggers and backfill
- Task, queue, third worker in `start-workers.ps1`.
- Admit after the draft CAS and at publish.
- Reconciliation on read.
- Backfill route and script.
- Cache reuse.

**Gate:**
- an existing populated model becomes `ready` without repopulating;
- a rebuild after a correction makes embedding calls only for changed entities;
- killing the worker mid-run resumes without duplicates;
- an embedding outage leaves graph and binding intact.

### G3 — Retrieval and traversal
- `retrieval.py`, `traversal.py`, and the runtime routes.
- `allowedSourceRefs` filtering at seeding and at each step.

**Gate:**
- an exact key wins over any vector result;
- an unseen paraphrase finds the right record in the measured top-k;
- a low-similarity linked record arrives only through a real edge, with its path;
- a step-2 expansion without relations is rejected;
- a hidden node never bridges;
- a revision swap mid-request still answers from the single pinned revision.

### G4 — Back facade and MCP tools
- Client and service; internal and public routes.
- `find_records` and `get_related_records`.
- Chat wiring (`semantic_model_id` + connector).

**Gate:** in a chat on a published model, the agent answers a question:
- with records and paths from the tools only;
- with `index_not_ready` and `not_represented` surfaced honestly;
- with draft data not reachable through `published`.

### G5 — Measurement, then optional UI
- Gold fixtures on at least two models: the contracts fixture plus one other domain.
- Report Recall@k and MRR for exact, lexical, vector and hybrid.
- Report path correctness, unauthorized results (must be 0), latency per stage, indexing time, and embedding calls with cache reuse.
- Calibrate the cutoff.
- Decide on HNSW, which is only justified if exact search latency is measured as too high.
- Then, optionally, add a Graph Viewer search box that uses the public route. It returns a bounded subgraph and does not load the whole graph to filter in React.

---

## 11. Decisions needed

| # | Question | Recommendation |
|---|---|---|
| D1 | Embedding path: runtime → LiteLLM directly, or through back? | **Directly.** The worker sends thousands of inputs and the query path is latency-sensitive. Back's `EmbeddingService` swallows errors, so routing through it adds a hop with no added policy. The cost is one more service holding a LiteLLM key, so give it its own key. |
| D2 | Per-source filtering (§8) from day one? | **Yes for MCP/chat**, because chat exposes content to people who may have lost workspace access. The editor graph has the same gap today; fix it separately. |
| D3 | `search_records` after G5 | Keep it as a plain "list a concept's records" tool, and make `find_records` the search tool. |
| D4 | Concept and field descriptions in the serializer | Defer. Adding them inside the compiled spec changes `specHash` and forces rebuilds. If they are needed, add them as search metadata outside the hash. |
| D5 | Graph Viewer search UI | After G5 and only if wanted. The MCP path is the deliverable. |

---

## 12. Acceptance tests

| Test | Expected |
|---|---|
| Exact identity (e.g. `CT001`) | `exact` match class, works with the embedding provider down |
| Unseen paraphrase | Relevant record in the measured top-k; query terms not copied into aliases |
| French/English paraphrase | Measured only; qwen3 is multilingual, but nothing is promised before G5 |
| Low-similarity linked record | Returned only via `expand`, with its path |
| Wrong direction / step 2 without relations | Rejected; no unrelated records reached through a shared node |
| Same label, different concept | Explicit ambiguity, never merged |
| Field absent from the spec | `not_represented`, no invented content |
| Correction applied | New revision → new generation; only changed entities re-embedded |
| Relationship-only change | Paths change; zero embedding calls |
| New embedding model | New fingerprint and generation; vectors never mixed |
| Worker crash / duplicate delivery | Resumes on `pending` rows, no duplicates, population untouched |
| Provider down | `lexical_only` flagged; exact lookup and expansion still work |
| Revision swap mid-request | One pinned revision/index throughout; `active_binding_changed` when expected |
| Access revoked | Next request excludes those records at seeding and expansion, with no reindex |
| Expansion capped | `truncated: true` with counts |
| Draft vs published | `published` never returns draft-only records |

---

## 13. Issues found during the audit (outside this plan)
- **Correction values (unverified):** `corrections.py:72-83` does not stringify non-string correction values before `store_assertions` inserts them into a TEXT column.
- **Property collisions:** `age_projection._safe_key` flattens free-form attribute keys into vertex properties, and two keys can collide after sanitizing.
- **Stale manifest:** `compatibility-manifest.json` lists only `pgcrypto` for agentstore, but `vector 0.8.0` and `pg_trgm 1.6` are installed.
- **Dimension mismatch:** the ADK's `FAKE_EMBEDDINGS` produces 1536 dimensions, but the real model has 2560.
- **Unused table:** `entity_identities` is never written. Alias-based exact lookup must use `exact_keys` instead.
- **Dead config:** back `SEMANTIC_MODEL_LLM_FALLBACK_ENABLED` and `SEMANTIC_MODEL_CONTEXT_SEARCH_ENABLED` are declared but read by no code.
