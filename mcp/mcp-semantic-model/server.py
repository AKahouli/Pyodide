import json
import os
from typing import Any
from urllib.parse import quote, urlencode

from fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from auth import TrustedIdentityMiddleware, require_acting_user_id, require_actor_context
from clients.yellowstorm_semantic_model_client import SemanticModelBackendError, YellowStormSemanticModelClient
from config import Settings
from contracts import SemanticModelMcpResultV1, failure_result, success_result


INSTRUCTIONS = """Design Yellowmind semantic models in plain business terms.
A model has concepts (business objects such as Customer, Contract, Invoice) with fields, key fields that
identify one record, and relationships between concepts. Sources (spreadsheets, documents, workspaces)
feed concepts with data; a data update reads the sources, and publishing makes the model usable in chat.

Talk about models, concepts, fields, workspaces and files by their names only: never show ids to the user.
Any model_id parameter also accepts the model's exact name.

Design: get_semantic_model, then apply_model_changes (one call for the whole design). Design changes are
applied at once and can be undone with undo_model_change. The conversation shows a button that opens the
model; tell the user they can continue in the designer at any time.

Sources and data are the user's decision. Never connect a source, start a data update or publish on your
own initiative: a wrong workspace can hold thousands of documents. Instead:
- right after the design, call suggest_sources for the concepts that need data. Do not search through
  workspaces and folders to find sources: add an option only for a workspace or file whose name plainly
  matches in a single list_workspaces result, and otherwise leave the options empty. The user picks the
  files from a searchable list of all their workspaces and files, takes a suggestion, or skips the concept;
- read a spreadsheet with profile_spreadsheet only once the user chose or confirmed that spreadsheet;
- use map_spreadsheet, map_documents, run_data_update or publish_semantic_model only when the user asks
  for it in this conversation, or confirms after you named the exact workspace, folders or files;
- stop_data_update stops a running data update when the user asks; the data in use does not change.
If the user wants to skip these steps, stop proposing them: they continue in the designer.

Answering from a model's data (records stored in the model, not documents):
- describe_model first when you do not know the model's concepts and fields: it gives each field's key,
  label and type, the relationships, and how many records each concept holds. Never invent a concept or
  a field: use only the names it returns.
- find_records for "which record is this": a name, a key or a fuzzy description, or words that may be
  deep in a long text (an e-mail body); then get_related_records follows the real links of the records
  found (with their entityId). Its passages quote the matching part of long fields: cite them as evidence.
- query_records for everything that filters, counts or compares: "all X where...", how many, totals,
  stats per month or per value, dates and amounts compared, records linked to a record matching a field.
  The total and the groups are exact counts over the whole data, not samples.
- for a summary of a set of records, fetch them with query_records (only the text fields you need),
  write the summary from the returned values, and cite the records you rely on; page with offset when
  nextOffset is set, or say that the summary covers only part of the records.
State the exact filter you used (appliedQuery shows how it was read, with absolute date ranges). Read
the notes and say plainly when values could not be read, records are hidden, or a list is truncated or
incomplete. Say when the model does not hold the information, and never state a fact that no returned
field or link holds."""

settings = Settings.from_env()
mcp = FastMCP("Semantic Model MCP", instructions=INSTRUCTIONS)
_client: YellowStormSemanticModelClient | None = None

BASE = "/api/v1/internal/semantic-model-assistant"
# MCP hints for clients that ask before acting (YellowStorm imports them as each tool's safety): reads change
# nothing, changes create or edit, destructive tools remove or publish.
READ_ONLY = {"readOnlyHint": True}
CHANGES = {"readOnlyHint": False, "destructiveHint": False}
DESTRUCTIVE = {"readOnlyHint": False, "destructiveHint": True}


def backend() -> YellowStormSemanticModelClient:
    global _client
    if _client is None:
        _client = YellowStormSemanticModelClient(
            settings.backend_url,
            settings.internal_token,
            settings.timeout_seconds,
            settings.max_response_bytes,
        )
    return _client


async def call(operation) -> SemanticModelMcpResultV1:
    correlation_id = require_actor_context().correlation_id
    try:
        result = await operation
        data = result if isinstance(result, dict) else {"result": result}
        return success_result(data, correlation_id)
    except SemanticModelBackendError as exc:
        return failure_result(exc.code, str(exc), exc.status_code, correlation_id, exc.details)


def fail(message: str) -> SemanticModelMcpResultV1:
    return failure_result("SEMANTIC_MODEL_MCP_INVALID_INPUT", message, 400, require_actor_context().correlation_id)


def path_id(value: str) -> str:
    return quote(value, safe="")


def with_query(path: str, **params: Any) -> str:
    present = {key: value for key, value in params.items() if value not in (None, "")}
    return f"{path}?{urlencode(present)}" if present else path


def compact(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None}


def parse_json(value: Any, name: str, expected: type) -> Any:
    """Models often send list and object arguments as JSON strings; accept both at the tool boundary."""
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{name} must be a {expected.__name__} or its JSON encoding") from exc
    if not isinstance(value, expected):
        raise ValueError(f"{name} must be a {expected.__name__}")
    return value


def string_list(value: Any, name: str) -> list[str] | None:
    items = parse_json(value, name, list)
    if items is None:
        return None
    if not all(isinstance(item, str) for item in items):
        raise ValueError(f"{name} must be a list of strings")
    return items


def field_spec(item: Any) -> dict[str, Any]:
    if isinstance(item, str):
        return {"label": item}
    if not isinstance(item, dict):
        raise ValueError("each field must be an object or a name")
    return compact({
        "key": item.get("key"),
        "label": item.get("label") or item.get("name"),
        "type": item.get("type"),
        "required": item.get("required"),
        "description": item.get("description"),
        "options": item.get("options"),
        "aliases": item.get("aliases"),
    })


def concept_spec(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise ValueError("each concept must be an object")
    return compact({
        "concept": item.get("concept") or item.get("existing"),
        "label": item.get("label") or item.get("name"),
        "newLabel": item.get("new_label") or item.get("newLabel") or item.get("rename_to"),
        "description": item.get("description"),
        "category": item.get("category"),
        "recordPolicy": item.get("record_policy") or item.get("recordPolicy"),
        "aliases": item.get("aliases"),
        "fields": [field_spec(field) for field in item["fields"]] if item.get("fields") else None,
        "removeFields": item.get("remove_fields") or item.get("removeFields"),
        "keyFields": item.get("key_fields") if "key_fields" in item else item.get("keyFields"),
    })


def relation_spec(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise ValueError("each relationship must be an object")
    return compact({
        "from": item.get("from") or item.get("source"),
        "to": item.get("to") or item.get("target"),
        "label": item.get("label") or item.get("name"),
        "key": item.get("key"),
        "inverseLabel": item.get("inverse_label") or item.get("inverseLabel"),
        "description": item.get("description"),
        "cardinality": item.get("cardinality"),
    })


def suggestion_spec(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise ValueError("each suggestion must be an object with a concept and options")
    options = parse_json(item.get("options"), "options", list) or []
    return compact({
        "concept": item.get("concept") or item.get("label") or item.get("name"),
        "note": item.get("note"),
        "options": [option_spec(option) for option in options],
    })


def option_spec(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise ValueError("each option must be an object with a source_workspace_id")
    workspace = item.get("source_workspace_id") or item.get("workspace_id") or item.get("workspaceId")
    if not isinstance(workspace, str) or not workspace:
        raise ValueError("each option needs a source_workspace_id")
    return compact({
        "workspaceId": workspace,
        "folderIds": string_list(item.get("folder_ids") or item.get("folderIds"), "folder_ids"),
        "documentIds": string_list(item.get("document_ids") or item.get("documentIds"), "document_ids"),
        "sheetName": item.get("sheet_name") or item.get("sheetName"),
        "reason": item.get("reason"),
    })


def relation_ref(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise ValueError("each relationship to remove must be an object with from and to")
    return compact({"from": item.get("from") or item.get("source"), "to": item.get("to") or item.get("target"), "label": item.get("label") or item.get("name")})


@mcp.custom_route("/health/live", methods=["GET"])
async def health_live(_request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


@mcp.custom_route("/health/ready", methods=["GET"])
async def health_ready(_request: Request) -> JSONResponse:
    try:
        settings.validate()
    except ValueError:
        return JSONResponse({"status": "not_ready"}, status_code=503)
    return JSONResponse({"status": "ready"})


# ── Models ──────────────────────────────────────────────────────────────────


@mcp.tool(annotations=READ_ONLY)
async def list_semantic_models(search: str | None = None) -> SemanticModelMcpResultV1:
    """List the semantic models the user can open (name, status, the user's role; the id is for your calls only). No change is made."""
    return await call(backend().get(with_query(f"{BASE}/models", search=search), require_acting_user_id()))


@mcp.tool(annotations=CHANGES)
async def create_semantic_model(name: str, description: str | None = None) -> SemanticModelMcpResultV1:
    """Create a new, empty semantic model owned by the user. Design it next with apply_model_changes. The conversation shows a button that opens it."""
    return await call(backend().post(f"{BASE}/models", require_acting_user_id(), compact({"name": name, "description": description})))


@mcp.tool(annotations=CHANGES)
async def clone_semantic_model(model_id: str, name: str | None = None, include_sources: bool = True,
                               include_data: bool = False, include_shares: bool = False) -> SemanticModelMcpResultV1:
    """Copy a model into a new one the user owns (default name "<name> (copy)"). The structure (concepts, fields, relationships, key fields, layout) is always copied.
    include_sources: source links and extraction rules (default yes). include_data: the data already built, so the copy is usable without a new build (forces the sources). include_shares: the same people keep their access (owner only). Source files are never duplicated. The conversation shows a button that opens the copy."""
    return await call(backend().post(f"{BASE}/models/{path_id(model_id)}/clone", require_acting_user_id(), compact({
        "name": name, "includeSources": include_sources, "includeData": include_data, "includeShares": include_shares})))


@mcp.tool(annotations=DESTRUCTIVE)
async def delete_semantic_model(model_id: str, confirm_name: str) -> SemanticModelMcpResultV1:
    """PERMANENTLY delete a model and all its data (concepts, fields, source links, records, review items, search index, history). Cannot be undone; workspace documents stay. Only the owner can. First ask the user to confirm explicitly, then pass the model's exact name as confirm_name."""
    return await call(backend().delete(with_query(f"{BASE}/models/{path_id(model_id)}", confirmName=confirm_name), require_acting_user_id()))


@mcp.tool(annotations=READ_ONLY)
async def get_semantic_model(model_id: str) -> SemanticModelMcpResultV1:
    """Describe a model: its concepts with fields and key fields, relationships, sources feeding each concept, and whether its data is up to date. No change is made."""
    return await call(backend().get(f"{BASE}/models/{path_id(model_id)}", require_acting_user_id()))


@mcp.tool(annotations=READ_ONLY)
async def check_semantic_model(model_id: str) -> SemanticModelMcpResultV1:
    """Run the model check: problems to fix (missing descriptions, unconnected concepts, invalid fields) and whether the data is current. No change is made."""
    return await call(backend().get(f"{BASE}/models/{path_id(model_id)}/check", require_acting_user_id()))


@mcp.tool(annotations=CHANGES)
async def apply_model_changes(
    model_id: str,
    concepts: list[dict[str, Any]] | str | None = None,
    relations: list[dict[str, Any]] | str | None = None,
    remove_concepts: list[str] | str | None = None,
    remove_relations: list[dict[str, Any]] | str | None = None,
    dry_run: bool = False,
) -> SemanticModelMcpResultV1:
    """Add, change and remove concepts, fields, key fields and relationships in ONE call; applied at once and undoable with undo_model_change.
    concepts: [{"label": "Invoice", "description": "...", "fields": [{"label": "Invoice number"}, {"label": "Amount", "type": "number"}, {"label": "Status", "type": "enum", "options": ["draft", "paid"]}], "key_fields": ["Invoice number"]}].
    A concept whose label matches an existing one is updated (its fields are added or updated, never dropped). To change one explicitly use {"concept": "invoice", "new_label": "Bill", "remove_fields": ["Old field"], "fields": [...]}.
    Field types: text, number, boolean, date, enum. category: business_object (default) or classification. record_policy: optional (default), expected, none.
    relations: [{"from": "Customer", "to": "Contract", "label": "signs", "cardinality": "one_to_many"}]; cardinality one_to_one, one_to_many (default), many_to_one, many_to_many.
    remove_concepts: ["Old concept"] (its relationships go too). remove_relations: [{"from": "Customer", "to": "Contract", "label": "signs"}].
    dry_run=true returns what would change and the model check without saving."""
    try:
        payload = compact({
            "concepts": [concept_spec(item) for item in parse_json(concepts, "concepts", list) or []] or None,
            "relations": [relation_spec(item) for item in parse_json(relations, "relations", list) or []] or None,
            "removeConcepts": string_list(remove_concepts, "remove_concepts"),
            "removeRelations": [relation_ref(item) for item in parse_json(remove_relations, "remove_relations", list) or []] or None,
            "dryRun": dry_run,
        })
    except ValueError as exc:
        return fail(str(exc))
    if len(payload) == 1:
        return fail("Nothing to change: give concepts, relations, remove_concepts or remove_relations")
    return await call(backend().post(f"{BASE}/models/{path_id(model_id)}/changes", require_acting_user_id(), payload))


@mcp.tool(annotations=READ_ONLY)
async def list_model_changes(model_id: str) -> SemanticModelMcpResultV1:
    """List the recent changes assistants made to a model, newest first, with whether each was undone. No change is made."""
    return await call(backend().get(f"{BASE}/models/{path_id(model_id)}/changes", require_acting_user_id()))


@mcp.tool(annotations=CHANGES)
async def undo_model_change(model_id: str, change_id: str | None = None) -> SemanticModelMcpResultV1:
    """Undo an assistant change (the latest one when change_id is omitted): concepts, fields, key fields, relationships and sources go back to how they were."""
    path = f"{BASE}/models/{path_id(model_id)}/changes/{path_id(change_id)}/undo" if change_id else f"{BASE}/models/{path_id(model_id)}/changes/undo"
    return await call(backend().post(path, require_acting_user_id()))


# ── Sources ─────────────────────────────────────────────────────────────────


@mcp.tool(annotations=READ_ONLY)
async def list_workspaces(search: str | None = None) -> SemanticModelMcpResultV1:
    """List the workspaces the user can use as data sources (own and shared). No change is made."""
    return await call(backend().get(with_query(f"{BASE}/workspaces", search=search), require_acting_user_id()))


@mcp.tool(annotations=READ_ONLY)
async def list_workspace_files(source_workspace_id: str, folder_id: str | None = None, search: str | None = None, page: int | None = None) -> SemanticModelMcpResultV1:
    """List files and folders of a workspace (source_workspace_id from list_workspaces) (or of one folder). kind is spreadsheet, document (PDF/Word), folder or other. No change is made."""
    path = with_query(f"{BASE}/workspaces/{path_id(source_workspace_id)}/files", folderId=folder_id, search=search, page=page)
    return await call(backend().get(path, require_acting_user_id()))


@mcp.tool(annotations=CHANGES)
async def suggest_sources(model_id: str, suggestions: list[dict[str, Any]] | str) -> SemanticModelMcpResultV1:
    """Ask the user to choose the source of each concept, WITHOUT connecting anything. The user picks files from a searchable list of all their workspaces and files, takes one of your options (shown with the workspace name and file count), or skips. Options are optional: leave them empty rather than search for sources.
    suggestions: [{"concept": "Contract", "note": "optional", "options": [] or [{"source_workspace_id": "...", "folder_ids": ["..."], "document_ids": ["..."], "sheet_name": "optional", "reason": "why it fits, in a few words"}]}].
    An option with no folder_ids and no document_ids means the whole workspace. At most 5 options per concept. Suggesting again for a concept replaces its previous suggestion.
    The result gives each option's fileCount: if an option covers no readable file, suggest again without it rather than leave it for the user."""
    try:
        items = parse_json(suggestions, "suggestions", list)
        payload = {"suggestions": [suggestion_spec(item) for item in items]}
    except ValueError as exc:
        return fail(str(exc))
    if not payload["suggestions"]:
        return fail("Suggest sources for at least one concept")
    return await call(backend().post(f"{BASE}/models/{path_id(model_id)}/source-suggestions", require_acting_user_id(), payload))


@mcp.tool(annotations=CHANGES)
async def profile_spreadsheet(model_id: str, source_workspace_id: str, document_id: str, sheet_name: str | None = None) -> SemanticModelMcpResultV1:
    """Read a spreadsheet's sheets, columns (type, how filled, how unique) and a few sample rows, to design concepts or map columns. Only for a spreadsheet the user chose or confirmed. Links the workspace to the model if needed."""
    payload = compact({"workspaceId": source_workspace_id, "documentId": document_id, "sheetName": sheet_name})
    return await call(backend().post(f"{BASE}/models/{path_id(model_id)}/sources/profile", require_acting_user_id(), payload))


@mcp.tool(annotations=CHANGES)
async def map_spreadsheet(
    model_id: str,
    concept: str,
    source_workspace_id: str,
    document_id: str,
    columns: dict[str, str] | str,
    sheet_name: str | None = None,
    key_fields: list[str] | str | None = None,
) -> SemanticModelMcpResultV1:
    """Feed a concept from a spreadsheet sheet. Only when the user asked for it or confirmed this exact spreadsheet; otherwise use suggest_sources. columns maps each concept field (name or key) to a column name, e.g. {"Customer number": "Cust No", "Country": "Country"}. key_fields: the fields that identify one record. Undoable with undo_model_change."""
    try:
        payload = compact({
            "concept": concept, "workspaceId": source_workspace_id, "documentId": document_id, "sheetName": sheet_name,
            "columns": parse_json(columns, "columns", dict), "keyFields": string_list(key_fields, "key_fields"),
        })
    except ValueError as exc:
        return fail(str(exc))
    return await call(backend().post(f"{BASE}/models/{path_id(model_id)}/sources/spreadsheet", require_acting_user_id(), payload))


@mcp.tool(annotations=CHANGES)
async def map_documents(
    model_id: str,
    concept: str,
    source_workspace_id: str,
    document_ids: list[str] | str | None = None,
    folder_ids: list[str] | str | None = None,
    whole_workspace: bool = False,
    fields: dict[str, Any] | str | None = None,
    key_fields: list[str] | str | None = None,
) -> SemanticModelMcpResultV1:
    """Feed a concept from PDF/Word documents: picked files (document_ids), picked folders (folder_ids, everything inside, including files added later), or whole_workspace=true. One source covers them all.
    Only when the user asked for it or confirmed these exact files, folders or workspace; otherwise use suggest_sources.
    fields maps concept fields to how they are read: "ai" (default, AI reads the document; one AI call per file on the first run), "extract" (rule-based), "document_name", "ignore", or {"constant": "value"}. Undoable with undo_model_change."""
    try:
        payload = compact({
            "concept": concept, "workspaceId": source_workspace_id,
            "documentIds": string_list(document_ids, "document_ids"), "folderIds": string_list(folder_ids, "folder_ids"),
            "wholeWorkspace": whole_workspace or None, "fields": parse_json(fields, "fields", dict), "keyFields": string_list(key_fields, "key_fields"),
        })
    except ValueError as exc:
        return fail(str(exc))
    return await call(backend().post(f"{BASE}/models/{path_id(model_id)}/sources/documents", require_acting_user_id(), payload))


@mcp.tool(annotations=DESTRUCTIVE)
async def remove_source(model_id: str, source_id: str) -> SemanticModelMcpResultV1:
    """Stop a source from feeding its concept (source_id from get_semantic_model). Its records disappear at the next data update. Undoable with undo_model_change."""
    return await call(backend().delete(f"{BASE}/models/{path_id(model_id)}/sources/{path_id(source_id)}", require_acting_user_id()))


# ── Data ────────────────────────────────────────────────────────────────────


@mcp.tool(annotations=CHANGES)
async def run_data_update(model_id: str) -> SemanticModelMcpResultV1:
    """Read every source again and rebuild the model's records and graph, in the background. Only when the user asked for it. Follow it with get_run_status; stop it with stop_data_update."""
    return await call(backend().post(f"{BASE}/models/{path_id(model_id)}/runs", require_acting_user_id()))


@mcp.tool(annotations=READ_ONLY)
async def get_run_status(model_id: str, job_id: str | None = None) -> SemanticModelMcpResultV1:
    """Follow a data update (the one running now when job_id is omitted): state (queued, running, cancel_requested, completed, completed_with_gaps, failed, cancelled) and progress (files read, records found, issues). No change is made."""
    path = f"{BASE}/models/{path_id(model_id)}/runs/{path_id(job_id)}" if job_id else f"{BASE}/models/{path_id(model_id)}/runs/active"
    return await call(backend().get(path, require_acting_user_id()))


@mcp.tool(annotations=CHANGES)
async def stop_data_update(model_id: str, job_id: str | None = None) -> SemanticModelMcpResultV1:
    """Stop a data update (the one running now when job_id is omitted) when the user asks. Nothing it read is kept: the data in use stays as it was before the run."""
    path = f"{BASE}/models/{path_id(model_id)}/runs/{path_id(job_id)}/stop" if job_id else f"{BASE}/models/{path_id(model_id)}/runs/stop"
    return await call(backend().post(path, require_acting_user_id()))


@mcp.tool(annotations=READ_ONLY)
async def search_records(model_id: str, concept: str, query: str | None = None, limit: int = 20) -> SemanticModelMcpResultV1:
    """Look at the records a concept holds after the last data update, optionally searched by any value. No change is made."""
    path = with_query(f"{BASE}/models/{path_id(model_id)}/concepts/{path_id(concept)}/records", q=query, limit=limit)
    return await call(backend().get(path, require_acting_user_id()))


DATA_CHOICES = ("published", "draft")
DIRECTIONS = ("outgoing", "incoming", "both")


def bounded(value: Any, name: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValueError(f"{name} must be a whole number from {low} to {high}")
    return value


def choice(value: Any, name: str, allowed: tuple[str, ...]) -> str:
    if value not in allowed:
        raise ValueError(f"{name} must be one of: {', '.join(allowed)}")
    return value


@mcp.tool(annotations=READ_ONLY)
async def find_records(
    model_id: str,
    query: str,
    concepts: list[str] | str | None = None,
    data: str = "published",
    limit: int | None = None,
) -> SemanticModelMcpResultV1:
    """Find the records of a semantic model that match a question: by exact key or name first, then by words and meaning. Use it first to answer a question from a model's data, then get_related_records with the entityId of the records found. No change is made.
    The results are records stored in the model (a customer, a contract, an invoice, an e-mail...) with their key fields and a snippet of their fields, NOT documents. match says how a record was found (exact, lexical, vector, hybrid); a vector or hybrid match is a likely candidate, not proof: check its fields.
    Long text fields (an e-mail body, a contract text) are searched to their end: a record may come with passages [{field, fieldKey, text}], the excerpts of those fields that match the question (matchedIn "passage" when the match came from them; the snippet is then the best passage). Quote a passage as evidence, naming its record and field; it is an excerpt, so to read the whole field call query_records on the record's concept with a filter on its name (or a key field) and fields=[the fieldKey] (values longer than 1500 characters come back cut).
    concepts: concept names (or keys) to search in, e.g. ["Contract"]. data: "published" (default, what chat uses) or "draft" (the data being built; only for the model's editors). limit: how many records (default and maximum are set by the administrator: 10 and 25 unless changed); leave it out unless you need more or fewer.
    Report the result honestly, using notes: status index_not_ready means the search index is still being built and records may be missing; not_represented means the model has no such concept, so the information is not in the model; no_match means no record matches. hasMore=true means more records match than were returned: the list is incomplete. notes say when the index is incomplete or records are hidden from the user: say so in the answer. A concept name that is nearly right (a plural, a typo) is read as the closest concept. Never infer a fact that is not in a field of a returned record."""
    try:
        payload = compact({
            "query": query.strip() if isinstance(query, str) else query,
            "concepts": string_list(concepts, "concepts") or None,
            "data": choice(data, "data", DATA_CHOICES),
            # The back end applies the administrator's default and caps at their maximum.
            "limit": bounded(limit, "limit", 1, 100) if limit is not None else None,
        })
    except ValueError as exc:
        return fail(str(exc))
    if not payload.get("query"):
        return fail("query must not be empty")
    return await call(backend().post(f"{BASE}/models/{path_id(model_id)}/graph-search", require_acting_user_id(), payload))


@mcp.tool(annotations=READ_ONLY)
async def get_related_records(
    model_id: str,
    record_ids: list[str] | str,
    relations: list[str] | str | None = None,
    direction: str = "both",
    then_relations: list[str] | str | None = None,
    concepts: list[str] | str | None = None,
    data: str = "published",
    max_records: int = 50,
) -> SemanticModelMcpResultV1:
    """Follow the real links (relationships of the model) from some records to the records linked to them. record_ids: the entityId of records returned by find_records (1 to 25). No change is made.
    A related record is included because it is linked to a record you asked for, NOT because it matched anything: its path says through which relationship. Records come from the model, not from documents.
    relations: the relationships to follow (names or keys from get_semantic_model); omitted means every relationship of these records, one step away. direction: outgoing, incoming or both (default).
    then_relations: the relationships of an optional second step, followed from the records reached by the first (e.g. relations=["signs"], then_relations=["is billed by"] goes Customer -> Contract -> Invoice). A second step must name its relationships.
    concepts: keep only related records of these concepts (applied to the last step). data: "published" (default) or "draft". max_records: 1 to 100.
    Report the result honestly, using notes: truncated=true means more linked records exist than were returned; say the list is incomplete. Never infer a fact that is not in a field or a link of a returned record."""
    try:
        ids = string_list(record_ids, "record_ids") or []
        payload = compact({
            "recordIds": ids,
            "relations": string_list(relations, "relations") or None,
            "direction": choice(direction, "direction", DIRECTIONS),
            "thenRelations": string_list(then_relations, "then_relations") or None,
            "concepts": string_list(concepts, "concepts") or None,
            "data": choice(data, "data", DATA_CHOICES),
            "maxRecords": bounded(max_records, "max_records", 1, 100),
        })
    except ValueError as exc:
        return fail(str(exc))
    if not 1 <= len(ids) <= 25:
        return fail("record_ids must hold 1 to 25 entityId values from find_records")
    return await call(backend().post(f"{BASE}/models/{path_id(model_id)}/graph-expand", require_acting_user_id(), payload))


MATCH_CHOICES = ("all", "any")


def filter_spec(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict) or not isinstance(item.get("field"), str) or not isinstance(item.get("op"), str):
        raise ValueError('each filter must be an object {"field": ..., "op": ..., "value": ...}')
    spec: dict[str, Any] = {"field": item["field"], "op": item["op"]}
    if "value" in item and item["value"] is not None:
        spec["value"] = item["value"]
    if item.get("as") is not None:
        spec["as"] = item["as"]
    return spec


def group_spec(item: Any) -> dict[str, Any]:
    if isinstance(item, str):
        return {"field": item}
    if not isinstance(item, dict) or not isinstance(item.get("field"), str):
        raise ValueError('each group_by item must be a field name or {"field": ..., "bucket": ...}')
    return compact({"field": item["field"], "bucket": item.get("bucket"), "as": item.get("as")})


def aggregate_spec(item: Any) -> dict[str, Any]:
    if isinstance(item, str):
        return {"op": item}
    if not isinstance(item, dict) or not isinstance(item.get("op"), str):
        raise ValueError('each aggregate must be an op name or {"op": ..., "field": ...}')
    return compact({"op": item["op"], "field": item.get("field"), "as": item.get("as")})


def order_spec(item: Any) -> dict[str, Any]:
    if isinstance(item, str):
        return {"field": item}
    if not isinstance(item, dict) or not isinstance(item.get("field"), str):
        raise ValueError('each order_by item must be a field name or {"field": ..., "direction": "asc" or "desc"}')
    return compact({"field": item["field"], "direction": item.get("direction"), "as": item.get("as")})


@mcp.tool(annotations=READ_ONLY)
async def describe_model(model_id: str, data: str = "published") -> SemanticModelMcpResultV1:
    """Describe the data of a model before querying it: each concept with its key, label, aliases, description, key fields and number of records, its fields (key, label, type text/number/boolean/date/enum, options, description, aliases), and the relationships (key, label, inverse label, from, to, cardinality). No change is made.
    Use it first when you do not know the model: query_records and find_records accept only the concept and field names it returns (key or label). A field with inData: false was added after the last data update and holds no value yet.
    data: "published" (default, what chat uses) or "draft" (the data being built; only for the model's editors). howToQuery recalls the query_records syntax."""
    try:
        environment = choice(data, "data", DATA_CHOICES)
    except ValueError as exc:
        return fail(str(exc))
    return await call(backend().get(with_query(f"{BASE}/models/{path_id(model_id)}/data-description", data=environment), require_acting_user_id()))


@mcp.tool(annotations=READ_ONLY)
async def query_records(
    model_id: str,
    concept: str,
    filters: list[dict[str, Any]] | str | None = None,
    match: str = "all",
    group_by: list[Any] | str | None = None,
    aggregates: list[Any] | str | None = None,
    order_by: list[Any] | str | None = None,
    fields: list[str] | str | None = None,
    limit: int = 50,
    offset: int = 0,
    data: str = "published",
) -> SemanticModelMcpResultV1:
    """Filter, count, group and list the records of ONE concept, with exact totals over all its data. Use it for "all X where...", how many, totals, stats per month or per value, date and amount comparisons, and to fetch the records a summary is written from. No change is made.
    concept: a concept key or label (from describe_model). Fields are named by key or label; "name" is the record name.
    filters: [{"field": "Sender domain", "op": "eq", "value": "acme.com"}]. ops: eq, ne, contains, starts_with, ends_with, in (list), gt, gte, lt, lte, between ([from, to] or one relative period), is_empty, not_empty. Text compares ignore case and accents; ne also keeps records with no value.
    Dates (date fields): an ISO date "2026-07-14", a month "2026-07" or a year "2026" (each covers the whole period), or a period resolved on the server in UTC: today, yesterday, last_7_days, last_N_days|weeks|months|years (N units up to today), this_week|month|quarter|year, last_week|month|quarter|year. Numbers compare as numbers on number fields.
    A linked record: "field": "<relation>.<field>" keeps the records linked through that relation (key, label or inverse label) to a record whose field matches, e.g. {"field": "sent by.domain", "op": "eq", "value": "acme.com"}; "field": "<relation>" with is_empty / not_empty keeps the records with no / some linked record.
    "as": "date"|"number"|"text"|"boolean" in a filter, group or aggregate reads a field with another type than declared (dates kept in a text field). match: "all" (default) or "any" of the filters.
    group_by: up to 2 fields, e.g. [{"field": "Received", "bucket": "month"}, "Sender"]; bucket (date fields): day, week, month, quarter, year. aggregates: [{"op": "count"}, {"op": "count_distinct", "field": "Sender"}, {"op": "sum", "field": "Amount"}] with count, count_distinct, sum, avg, min, max; [count] by default with group_by. Groups come back sorted (dates in order, otherwise largest count first), at most 500.
    Without group_by: total (exact) and a page of records {entityId, name, keyFields, values}, ordered by order_by [{"field": "Received", "direction": "desc"}]; fields: the fields to return (default all; ask only for what you need); long values are cut at 1500 characters (truncated). limit: 0 to 200 (0 returns only total and totals); offset pages through: call again with offset=nextOffset.
    data: "published" (default) or "draft".
    Report honestly: status invalid_query or not_represented comes with errors naming the wrong part and the names available: fix the query from them, never guess. appliedQuery shows how the query was read (field keys, absolute date ranges): state the filter you used. notes say when values could not be read (unparsable), records are hidden from the user, or groups or records were left out: say so in the answer."""
    try:
        payload = compact({
            "concept": concept.strip() if isinstance(concept, str) else concept,
            "filters": [filter_spec(item) for item in parse_json(filters, "filters", list) or []] or None,
            "match": choice(match, "match", MATCH_CHOICES),
            "groupBy": [group_spec(item) for item in parse_json(group_by, "group_by", list) or []] or None,
            "aggregates": [aggregate_spec(item) for item in parse_json(aggregates, "aggregates", list) or []] or None,
            "orderBy": [order_spec(item) for item in parse_json(order_by, "order_by", list) or []] or None,
            "fields": string_list(fields, "fields") or None,
            "limit": bounded(limit, "limit", 0, 200),
            "offset": bounded(offset, "offset", 0, 100000),
            "data": choice(data, "data", DATA_CHOICES),
        })
    except ValueError as exc:
        return fail(str(exc))
    if not payload.get("concept"):
        return fail("concept must name one concept of the model")
    return await call(backend().post(f"{BASE}/models/{path_id(model_id)}/records-query", require_acting_user_id(), payload))


@mcp.tool(annotations=DESTRUCTIVE)
async def publish_semantic_model(model_id: str) -> SemanticModelMcpResultV1:
    """Publish the current draft so chat can use the model, and open a new draft. Only when the user asked to publish."""
    return await call(backend().post(f"{BASE}/models/{path_id(model_id)}/publish", require_acting_user_id()))


if __name__ == "__main__":
    settings.validate()
    os.environ.setdefault("HOST", "0.0.0.0")
    middleware = [Middleware(TrustedIdentityMiddleware, ingress_token=settings.ingress_token)]
    mcp.run(transport="streamable-http", host="0.0.0.0", port=settings.port, middleware=middleware)
