# Maintenance scripts

Run commands from the repository root with the project's Python environment.

| File | Purpose | When to run |
| --- | --- | --- |
| [setup_database.py](setup_database.py) | Verify the ingestion schema and install missing extensions/search indexes. | Once after ingestion prepares a database, before starting MCP or load testing; rerun after relevant schema changes. |
| [provision_language_model.py](provision_language_model.py) | Download or copy the fastText language model and verify its SHA-256 checksum. Used by the Docker build. | During deployment preparation. |
| [load_test_search.py](load_test_search.py) | Send real MCP search requests at controlled concurrency and report latency, throughput, errors, and response sizes. | During company capacity tests; requests can invoke paid model APIs. |
| [measure_search_review.py](measure_search_review.py) | Measure CPU work using synthetic evidence and summarize optional receiving-agent session usage. Also supplies the session summary used by tests. | When comparing implementation costs; CPU probes do not access the database or model APIs. |

## One-time database setup

Configure `DATABASE_URL` and `EMBEDDING_DIMENSION` in `.env`, then run:

```powershell
python -m scripts.setup_database
python -m scripts.setup_database --apply
```

The first command is read-only and reports a plan. `--apply` installs only missing
extensions and indexes, then checks the result. Run it manually once per database;
MCP startup never runs it. Repeating it reuses healthy equivalent indexes, including
indexes with different names created by ingestion. It does not rebuild existing
indexes or change search scoring code.

The check covers the five logical tables, columns used by MCP, primary keys,
vector dimensions, required child workspace constraints, disabled triggers,
extensions, and index keys, access methods, collations and BM25 field settings.
It reads PostgreSQL catalogs rather than scanning document contents or calling models.

Ingestion owns tables, columns, data, backfills and triggers. Missing or incompatible
schema must be fixed by that project first. This command can supply missing shared
search infrastructure: `vector`/`pg_search`, lookup indexes, section/block GIN,
cosine vector and bilingual BM25 indexes. The server must already provide the
extension packages and the setup account must have permission to install them.
It does not recreate removed legacy fields such as document `title_tsv` or
`workspace_name`, section `bbox`, or image `source`.

MCP additionally owns these five search indexes, which remain separate from the
ingestion contract in the report (`owner: mcp-search`):

- `idx_documents_filename_tokens`: normalized filename token lookup.
- `idx_documents_filename_issuer`: normalized issuer lookup.
- `idx_documents_workspace_filename_order`: workspace filename ordering.
- `idx_documents_workspace_fts`: scoped language discovery.
- `idx_blocks_doc_page_id`: ordered document/page reading.

Indexes are built concurrently to permit ongoing ingestion. Large builds still
consume disk, CPU and I/O; finish setup before load tests. Incompatible or invalid
existing indexes and missing indexes on partitioned parents require a reviewed
migration rather than automatic replacement. No data, columns or indexes are deleted.

The default report is `logs/database-setup.json`; use `--output PATH` or
`--schema NAME` to override the target. This explicit report is independent of
application log settings. Exit code is zero only when all checks pass; a read-only
plan with missing objects exits one until applied. Failed concurrent builds can
leave invalid indexes, which a later run reports for manual repair.

## Other commands

Use `python -m scripts.provision_language_model --help`,
`python -m scripts.load_test_search --help`, and
`python -m scripts.measure_search_review --help` for their options. See
[operations](../docs/operations.md#verification-and-company-load-test) for a load-test example.
The measurement utility's optional `--database` mode uses only an isolated
`TEST_DATABASE_URL`: it creates synthetic fixtures in a temporary schema and
removes that schema afterward. It is not another application database setup command.

## Retired investigations

Database audit/check/index scripts were replaced by `setup_database.py`.
The query-translation, receiving-agent, hybrid-search, CAPEX, agent-search,
runtime and scalable-search investigation scripts were one-off diagnostics and
have been removed. Their historical findings remain in
[maintenance history](../docs/maintenance-history.md); old commands there describe
past investigations and are not current maintenance instructions.
