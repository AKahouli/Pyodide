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
| Answer | `describe_model` | The data's shape before querying: concepts, fields with types and options, key fields, relationships, record counts |
| | `find_records` | Records matching a question, by key, words and meaning (published data by default) |
| | `get_related_records` | Records linked to found records, one or two relationship steps away, with the path |
| | `query_records` | Filter, count, group and list one concept's records: exact totals, stats per month or value, date and amount comparisons, the records a summary is written from |
| | `publish_semantic_model` | Make the model usable in chat |

Concepts and fields are always named by their business names. Every design change is applied at once and is
recorded as one change set: the model editor shows it ("Yellowmind: added concept Invoice…") with an Undo
button, and `undo_model_change` reverses it. A model can be named by its exact name in any `model_id`.

Sources and data stay the user's decision: with `suggest_sources` the assistant lists the concepts that need
data, with suggestions only when a name plainly matches. The user picks files from a searchable list of all
their workspaces and files, in the conversation or in the designer. Connecting sources,
updating data and publishing happen only when the user asks. Results carry a `uiTarget` that the
conversation shows as a button opening the model, or as the suggested-sources card.

## Answering from the data

The calling assistant plans every query; nothing in this stack interprets language or calls a model to
answer. `describe_model` gives the names it may use; `find_records` answers "which record is this"
(also from words deep in a long text field such as an e-mail body: see below);
`query_records` answers everything that filters, counts or compares, and fetches the records a summary is
written from (the assistant writes the summary and cites the records).

Record provenance identifies the source workspace and, when available, the source document as
`{workspaceId, documentId, assetId, filename}` (`assetId` remains compatible with existing clients).
`find_records`, `get_related_records` and the record rows from `query_records` preserve this metadata.
If the answer needs the original document, use the existing document connector: the deep-search flow
uses `search_relevant_documents` with the workspace identifier, then `search_sections` or `read_section`
with the matched `file_name`. Map provenance `workspaceId` to the connector's workspace scope and
`filename` to `file_name`; pass `documentId` (or `assetId`) when a declared document tool accepts
`document_id`. Always follow the connected tool's input schema.

`find_records` matches each record's own search text (type, name, keys, and the start of each field)
and, for a text field longer than 300 characters, overlapping passages of about 1000 characters that
cover the whole field (up to 20 per field and 50 per record; a field longer than that is searched only
up to there and the notes say so). A record found that way carries `passages`: up to two
`{field, fieldKey, text}` excerpts (about 400 characters around the words of the question) and
`matchedIn: "passage"`; its `snippet` is then the best passage. The assistant quotes passages as
evidence; to read the whole field it calls `query_records` on the record (filter on `name` or a key
field, `fields=[fieldKey]`; values longer than 1500 characters are cut).

```text
query_records(model_id, concept, filters=None, match="all", group_by=None, aggregates=None,
              order_by=None, fields=None, limit=50, offset=0, data="published")
```

- `filters`: `[{"field", "op", "value", "as"?}]`; ops `eq ne contains starts_with ends_with in gt gte lt lte
  between is_empty not_empty`. A field is a key, label or alias; `name` is the record name;
  `<relation>.<field>` keeps the records linked through that relation to a record whose field matches;
  `<relation>` with `is_empty` / `not_empty` keeps the records with no / some linked record.
- Text compares ignore case and accents. Date and number fields compare typed: stored text is read at
  query time (ISO dates and datetimes, `dd/mm/yyyy`, written French or English dates, e-mail header dates;
  numbers with spaces, currencies and `,` or `.` decimals). A value that cannot be read is left out and
  counted in `unparsable`.
- Dates take `2026-07-14`, `2026-07`, `2026` (whole period) or periods resolved on the server in UTC:
  `today`, `yesterday`, `last_N_days|weeks|months|years`, `this_/last_week|month|quarter|year`.
- `group_by`: up to 2 fields, date buckets `day week month quarter year`; `aggregates`: `count
  count_distinct sum avg min max`. At most 500 groups (`truncated`).
- Without `group_by`: the exact `total` and a page of records (`limit` 0 to 200, `offset`, `nextOffset`);
  values longer than 1500 characters are cut (`truncated`).
- Every answer echoes `appliedQuery` (resolved field keys, absolute date ranges). A wrong part comes back
  as `status: invalid_query` with `errors` naming it and the names available; an unknown concept as
  `not_represented`. `notes` say what to tell the user (unreadable values, hidden records, truncation).
- Same access as `find_records`: published data for anyone who can read the model, draft data for its
  editors; records read from a workspace the user cannot open are excluded before counting.

## Run locally

```bash
cp .env.example .env   # set the two tokens
pip install -r requirements.txt
python server.py
```

- `YELLOWSTORM_INTERNAL_SERVICE_TOKEN` must equal the backend's `INTERNAL_SERVICE_SECRET`.
- `SEMANTIC_MODEL_MCP_INGRESS_TOKEN` is the bearer token agents must present; it goes in the connector.

### Authentication mode

Set `SEMANTIC_MODEL_MCP_AUTH_MODE=Bearer` (default) for the existing static ingress
token, or `SEMANTIC_MODEL_MCP_AUTH_MODE=JWT` for signed user tokens. Both use the
HTTP `Authorization: Bearer <token>` header; JWT mode never accepts the static secret.

For JWT mode, configure:

```dotenv
SEMANTIC_MODEL_MCP_AUTH_MODE=JWT
SEMANTIC_MODEL_MCP_JWT_PUBLIC_KEY_FILE=/run/secrets/mcp-jwt-public.pem
SEMANTIC_MODEL_MCP_JWT_ISSUER=yellowstorm
SEMANTIC_MODEL_MCP_JWT_AUDIENCE=mcp-semantic-model
```

The backend can use the same private key and issuer for semantic-model, Playbook,
and Agent MCP tokens. Set `PLAYBOOK_MCP_AUTH_MODE=JWT` and/or
`AGENT_MCP_AUTH_MODE=JWT` on the backend, and configure the matching public key,
issuer, and distinct audience (`mcp-playbook` or `mcp-agent`) in each MCP.
For a new deployment, mount the private PEM only in YellowStorm and set
`MCP_JWT_PRIVATE_KEY_FILE` and `MCP_JWT_ISSUER`; the existing
`SEMANTIC_MODEL_MCP_JWT_PRIVATE_KEY_FILE` and `_ISSUER` remain supported.
Mount the matching public PEM in each MCP container.

The PEM file must contain an RSA public key (absolute path recommended). The issuer
must sign tokens with RS256 and include `sub` (acting user ID), `iss`, `aud`, `iat`
and `exp`; future `nbf` values are rejected too. User identity always comes from
the verified `sub`, ignoring `X-YellowStorm-User-Id` in JWT mode. Agent,
conversation and correlation headers remain optional trace metadata.

YellowStorm now issues dedicated five-minute RS256 MCP tokens. Its existing HS256
login tokens authenticate to the backend; they cannot be sent directly to this MCP.
Backend calls still require `YELLOWSTORM_INTERNAL_SERVICE_TOKEN` in either mode.
Health probes remain public.

### YellowStorm issuance and automatic renewal

Generate a dedicated signing key pair outside the repository:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out mcp-private.pem
openssl pkey -in mcp-private.pem -pubout -out mcp-public.pem
```

Configure the backend's `.env`:

```dotenv
SEMANTIC_MODEL_MCP_AUTH_MODE=JWT
SEMANTIC_MODEL_MCP_SERVER_URL=http://localhost:8027/mcp
SEMANTIC_MODEL_MCP_JWT_PRIVATE_KEY_FILE=/run/secrets/mcp-private.pem
SEMANTIC_MODEL_MCP_JWT_ISSUER=yellowstorm
SEMANTIC_MODEL_MCP_JWT_AUDIENCE=mcp-semantic-model
```

Use the matching public key, issuer and audience in this MCP's `.env`, with JWT mode
enabled on both services. The backend needs an RSA private key of at least 2048 bits;
the MCP receives only its public key. Restart both after configuring the keys.
Keep both modes set to `Bearer` to retain static-token authentication.

For the connector pointing at `SEMANTIC_MODEL_MCP_SERVER_URL`, select no saved
authentication (`authSourceType=none`). YellowStorm injects JWTs automatically for
agent and playbook bindings, conversation bindings, inspection and backend tool
calls. Other connector URLs keep their existing authentication. JWTs override
any saved static Authorization value for this server.

The ADK must have `API_URL` (backend root URL, or URL ending in `/api` or `/api/v1`) and
`INTERNAL_SERVICE_SECRET` matching the backend's internal service guard. It obtains
a fresh token before each MCP tool call and renews before subsequent HTTP requests
when fewer than 30 seconds remain. Renewals fail closed; JWT calls do not follow
redirects. JWT runtime renewal supports Streamable HTTP.

Endpoints (relative to the backend API prefix):

- `POST /connectors/mcp-token/:connectorId`: issue or renew for the logged-in user.
  Uses the existing login JWT/session guard; clients cannot select a different user.
- `POST /connectors/internal/mcp-token`: trusted ADK renewal, protected by
  `X-Internal-Token`, with `{ "connectorId": "...", "userId": "..." }`.

Both return `{ token, expiresAt, serverUrl }` inside the normal API response envelope.
No refresh token is stored in the connector: renewal authenticates the caller again.
Issuance rejects inactive connectors, unsupported transports, other MCP URLs, and
missing, inactive or suspended users. Tokens already issued remain valid until
expiry; internal background-job renewal relies on the trusted runtime's authority
and account status, rather than a browser session. Backend model/workspace permission
checks remain authoritative.

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
