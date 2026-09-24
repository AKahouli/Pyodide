"""Structured, bounded DuckDB queries over prepared Parquet artifacts."""

from __future__ import annotations

from pathlib import Path
from typing import Any

MAX_QUERY_ROWS = 1000
_OPS = {"eq": "=", "ne": "!=", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def query_parquet(path: Path, *, columns: list[str] | None = None,
                  filters: list[dict[str, Any]] | None = None, limit: int = 100,
                  offset: int = 0) -> dict[str, Any]:
    import duckdb
    import pyarrow.parquet as pq

    if not path.is_file():
        raise ValueError("dataset_not_found")
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_QUERY_ROWS:
        raise ValueError("invalid_query_limit")
    if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
        raise ValueError("invalid_query_offset")
    available = pq.read_schema(path).names
    selected = columns or available
    if not selected or any(not isinstance(name, str) or name not in available for name in selected):
        raise ValueError("invalid_query_column")
    predicates: list[str] = []
    parameters: list[Any] = [str(path)]
    for item in filters or []:
        if not isinstance(item, dict) or item.get("column") not in available:
            raise ValueError("invalid_query_filter")
        operation = item.get("op")
        if operation == "contains":
            predicates.append(f"CAST({_quote(item['column'])} AS VARCHAR) LIKE ? ESCAPE '\\'")
            value = str(item.get("value", "")).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            parameters.append(f"%{value}%")
        elif operation in _OPS:
            predicates.append(f"{_quote(item['column'])} {_OPS[operation]} ?")
            parameters.append(item.get("value"))
        else:
            raise ValueError("invalid_query_filter")
    where = f" WHERE {' AND '.join(predicates)}" if predicates else ""
    sql = f"SELECT {', '.join(_quote(name) for name in selected)} FROM read_parquet(?){where} LIMIT ? OFFSET ?"
    parameters.extend((limit, offset))
    connection = duckdb.connect(config={
        "allow_persistent_secrets": False,
        "threads": 2,
        "max_memory": "256MB",
    })
    try:
        connection.execute("SET allowed_paths = ?", [[str(path)]])
        connection.execute("SET enable_external_access = false")
        cursor = connection.execute(sql, parameters)
        rows = cursor.fetchall()
    finally:
        connection.close()
    return {"columns": selected, "rows": [dict(zip(selected, row, strict=True)) for row in rows],
            "returnedRows": len(rows), "limit": limit, "offset": offset}
