# Semantic Model MCP

FastMCP server (Streamable HTTP, `/mcp`, port 8027) that lets a Yellowmind agent design semantic models in
natural language: "I need a model to handle billing and contract management".

It is a thin client of the YellowStorm backend. Every tool calls
`/api/v1/internal/semantic-model-assistant/*` with `X-Internal-Token` and the identity of the person the agent
acts for; the backend applies that person's permissions and model roles, through the same services as the
model editor. Nothing here touches a database.

## Tools

| Group | Tool | What it does |
|---|---|---|
| Understand | `list_semantic_models` | Models the user can open |
| | `get_semantic_model` | Concepts, fields, key fields, relationships, sources, data freshness |
| | `check_semantic_model` | Model check findings and data freshness |
| Design | `create_semantic_model` | New empty model |
| | `apply_model_changes` | Add, change and remove concepts, fields, key fields and relationships in one call (`dry_run` previews) |
| | `list_model_changes` / `undo_model_change` | Changes made by assistants, and undoing them |
| Sources | `list_workspaces` / `list_workspace_files` | Where the data is |
| | `suggest_sources` | Ask the user to choose each concept's source, with optional suggestions; nothing is connected until the user picks |
| | `profile_spreadsheet` | Sheets, columns and sample rows of a spreadsheet the user chose |
| | `map_spreadsheet` | Feed a concept from a sheet, column by column |
| | `map_documents` | Feed a concept from picked documents, folders or a whole workspace |
| | `remove_source` | Stop a source feeding its concept |
| Data | `run_data_update` / `get_run_status` | Rebuild the records and graph, and follow it |
| | `stop_data_update` | Stop a running update; the data in use does not change |
| | `search_records` | Look at a concept's records |
| | `find_records` | Records matching a question, by key, words and meaning (published data by default) |
| | `get_related_records` | Records linked to found records, one or two relationship steps away, with the path |
| | `publish_semantic_model` | Make the model usable in chat |

Concepts and fields are always named by their business names. Every design change is applied at once and is
recorded as one change set: the model editor shows it ("Yellowmind: added concept Invoice…") with an Undo
button, and `undo_model_change` reverses it. A model can be named by its exact name in any `model_id`.

Sources and data stay the user's decision: with `suggest_sources` the assistant lists the concepts that need
data, with suggestions only when a name plainly matches. The user picks files from a searchable list of all
their workspaces and files, in the conversation or in the designer. Connecting sources,
updating data and publishing happen only when the user asks. Results carry a `uiTarget` that the
conversation shows as a button opening the model, or as the suggested-sources card.

## Run locally

```bash
cp .env.example .env   # set the two tokens
pip install -r requirements.txt
python server.py
```

- `YELLOWSTORM_INTERNAL_SERVICE_TOKEN` must equal the backend's `INTERNAL_SERVICE_SECRET`.
- `SEMANTIC_MODEL_MCP_INGRESS_TOKEN` is the bearer token agents must present; it goes in the connector.

## Connect it to an agent

1. **Admin → Connectors → New connector**: MCP, transport *Streamable HTTP*, URL `http://<host>:8027/mcp`,
   authentication *Bearer token* with the ingress token. Discover the tools.
2. Make sure the backend's `SEMANTIC_MODEL_MCP_SERVER_URL` is exactly that URL (default
   `http://localhost:8027/mcp`). Only connectors pointing at a trusted internal MCP URL receive the acting
   user's identity; add other internal servers to `TRUSTED_MCP_SERVER_URLS` (comma separated).
3. **Agent edit → Connectors**: add the connector to Yellowmind (or any agent) and choose its tools.
   Suggested approvals: `remove_source` and `publish_semantic_model` ask the user first.

## Tests

```bash
pytest tests -q
```
