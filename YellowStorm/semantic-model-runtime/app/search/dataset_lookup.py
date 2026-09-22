"""Query-backed dataset resolution (P7.10-P7.12, P7.2-SB02).

Resolves exact keys against eligible prepared rows without materializing AGE
entities. Eligibility — never materialization — gates full-scope answers: rows
excluded by eligibility stay inaccessible, while eligible-but-unmaterialized
rows resolve normally. Enumeration is bounded; a capped scan reports
``complete: False`` instead of a silent partial answer (T02/T30).
"""

from __future__ import annotations

from typing import Any

from app.population.compiler import PopulationError, evaluate_filter, filter_fields

LOOKUP_ROW_LIMIT = 1000


def _manifest_for(observation: Any) -> dict[str, Any] | None:
    if not isinstance(observation, dict):
        return None
    dataset_id = observation.get("datasetId")
    content_hash = observation.get("contentHash")
    size = observation.get("sizeBytes")
    if (isinstance(dataset_id, str) and dataset_id
            and isinstance(content_hash, str) and content_hash.startswith("sha256:")
            and isinstance(size, int) and not isinstance(size, bool) and size >= 1):
        return {"datasetId": dataset_id, "contentHash": content_hash, "sizeBytes": size}
    return None


async def lookup_query_backed_rows(entry: dict[str, Any], concept: dict[str, Any],
                                   keys: list[str], *, key_field: str, actor: str,
                                   observation: dict[str, Any] | None = None,
                                   fetch=None, fetch_dataset=None, prepare=None,
                                   query=None) -> dict[str, Any]:
    """Exact key lookup over eligible rows of one mapped source.

    Prefers the recorded prepared artifact; falls back to a deterministic
    re-prepare of the same source when the artifact is unavailable. ``keys``
    match exactly against raw source cell values for ``key_field`` after
    eligibility. Callers holding normalized identities (e.g. from projections)
    must resolve candidates through the projection keys first; passing a
    normalized key here misses raw-case variants by design.
    """
    import asyncio
    import os
    import tempfile
    from pathlib import Path

    from app.datasource.asset_delivery import AssetFetchError, fetch_prepared_dataset
    from app.datasource.asset_delivery import fetch_workspace_asset
    from app.datasource.dataset_query import query_parquet
    from app.datasource.parsers import SHEET_ROW_KEY
    from app.datasource.parser_sandbox import prepare_dataset_subprocess

    if not isinstance(keys, list) or not keys or any(
            not isinstance(k, str) or not k for k in keys):
        raise PopulationError("invalid_lookup_keys")
    if not isinstance(key_field, str) or not key_field:
        raise PopulationError("invalid_lookup_field")
    if not isinstance(actor, str) or not actor:
        raise PopulationError("invalid_command")
    mapping = entry.get("columnMapping") or {}
    mapped_attributes = set(mapping.values())
    if key_field not in mapped_attributes:
        raise PopulationError("unmapped_lookup_field")
    if "_row" in mapped_attributes:
        raise PopulationError("reserved_attribute_name")
    # An eligibility field without a mapped column sees only None and would
    # exclude every row: reject before any fetch, mirroring population.
    for field in filter_fields(concept.get("eligibility")):
        if field not in set(mapping.values()):
            raise PopulationError("unmapped_filter_field")
    needed = {key_field} | set(filter_fields(concept.get("eligibility")))
    source_columns = sorted({src for src, attr in mapping.items() if attr in needed})
    if not source_columns:
        raise PopulationError("unmapped_lookup_field")

    source, options = entry.get("source"), entry.get("options") or {}
    manifest = _manifest_for(observation)
    temp_root = os.environ.get("SEMANTIC_TASK_TEMP_DIR")
    # Lookup is a query primitive with no retry wrapper: transient transport
    # failures become an explicit gap, while deterministic source failures do.
    import httpx

    transient = (TimeoutError, httpx.HTTPError)
    page = None
    if manifest is not None:
        try:
            with tempfile.TemporaryDirectory(prefix="semantic-lookup-",
                                             dir=temp_root) as directory:
                target = Path(directory) / "lookup.parquet"
                await (fetch_dataset or fetch_prepared_dataset)(
                    source, actor, manifest, target)
                page = await asyncio.to_thread(
                    query or query_parquet, target,
                    columns=sorted(set(source_columns) | {SHEET_ROW_KEY}),
                    limit=LOOKUP_ROW_LIMIT)
        except (AssetFetchError, RuntimeError, ValueError) + transient:
            page = None
    if page is None:
        try:
            async with asyncio.timeout(35):
                data = await (fetch or fetch_workspace_asset)(source, actor)
            with tempfile.TemporaryDirectory(prefix="semantic-lookup-",
                                             dir=temp_root) as directory:
                artifact = Path(directory) / "lookup.parquet"
                await asyncio.to_thread(
                    prepare or prepare_dataset_subprocess, source, options, data, artifact)
                page = await asyncio.to_thread(
                    query or query_parquet, artifact,
                    columns=sorted(set(source_columns) | {SHEET_ROW_KEY}),
                    limit=LOOKUP_ROW_LIMIT)
        except (AssetFetchError, ValueError, RuntimeError) + transient as exc:
            code = exc.code if isinstance(exc, AssetFetchError) else str(exc) or "lookup_failed"
            return {"keyField": key_field, "requestedKeys": len(keys), "rows": [],
                    "complete": False, "gaps": [{"kind": "dataset_unavailable",
                                                 "detail": code}]}

    wanted = set(keys)
    matched = []
    for raw in page["rows"]:
        renamed = {"_row": raw.get(SHEET_ROW_KEY)}
        renamed.update({attr: raw[src] for src, attr in mapping.items() if src in raw})
        if not evaluate_filter(concept.get("eligibility"), renamed):
            continue
        if renamed.get(key_field) in wanted:
            matched.append(renamed)
    complete = page["returnedRows"] < LOOKUP_ROW_LIMIT
    gaps = [] if complete else [{"kind": "enumeration_capped",
                                 "detail": f"lookup capped at {LOOKUP_ROW_LIMIT} rows"}]
    return {"keyField": key_field, "requestedKeys": len(keys), "rows": matched,
            "complete": complete, "gaps": gaps}
