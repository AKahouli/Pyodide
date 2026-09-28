from __future__ import annotations

from pathlib import Path
from io import BytesIO

import pytest

from app.datasource.dataset_query import query_parquet
from app.datasource.datasets import dataset_id, prepare_parquet

SOURCE = {
    "workspaceId": "6512f0a1c9e77a001234aaa1",
    "assetId": "6512f0a1c9e77a001234bbb2",
    "mimeType": "text/csv",
    "sizeBytes": 35,
    "contentHash": "0123456789abcdef0123456789abcdef",
    "uploadedAt": "2026-09-20T12:00:00.000Z",
    "indexingStatus": "ready",
}


def test_prepares_full_csv_and_queries_structured_filters(tmp_path: Path):
    body = b"id,name,team\n001,Ada,Core\n002,Bob,Sales\n003,Eve,Core\n"
    output = tmp_path / "dataset.parquet"
    manifest = prepare_parquet({**SOURCE, "sizeBytes": len(body)}, None, body, output)

    assert output.read_bytes().startswith(b"PAR1")
    assert manifest["datasetId"] == dataset_id(SOURCE, None)
    assert manifest["rowCount"] == 3
    result = query_parquet(output, columns=["id", "name"],
                            filters=[{"column": "team", "op": "eq", "value": "Core"}],
                            limit=1, offset=1)
    assert result["rows"] == [{"id": "003", "name": "Eve"}]


def test_query_rejects_columns_filters_and_unbounded_limits(tmp_path: Path):
    body = b"id,name\n001,Ada\n"
    output = tmp_path / "dataset.parquet"
    prepare_parquet({**SOURCE, "sizeBytes": len(body)}, None, body, output)

    with pytest.raises(ValueError, match="invalid_query_column"):
        query_parquet(output, columns=["missing"])
    with pytest.raises(ValueError, match="invalid_query_filter"):
        query_parquet(output, filters=[{"column": "id", "op": "sql", "value": "x"}])
    with pytest.raises(ValueError, match="invalid_query_limit"):
        query_parquet(output, limit=1001)
    with pytest.raises(ValueError, match="invalid_query_offset"):
        query_parquet(output, offset=-1)


def test_preparation_preserves_columns_beyond_preview_and_is_deterministic(tmp_path: Path):
    headers = [f"column_{index}" for index in range(52)]
    values = [f"value_{index}" for index in range(52)]
    body = (",".join(headers) + "\n" + ",".join(values) + "\n").encode()
    first, second = tmp_path / "first.parquet", tmp_path / "second.parquet"
    source = {**SOURCE, "sizeBytes": len(body)}

    first_manifest = prepare_parquet(source, None, body, first)
    second_manifest = prepare_parquet(source, None, body, second)

    assert first.read_bytes() == second.read_bytes()
    assert first_manifest == second_manifest
    assert first_manifest["columns"][-1] == "column_51"
    assert query_parquet(first, columns=["column_51"])["rows"] == [{"column_51": "value_51"}]


def test_xlsx_preparation_preserves_columns_beyond_preview(tmp_path: Path):
    import openpyxl

    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.append([f"column_{index}" for index in range(52)])
    sheet.append([f"value_{index}" for index in range(52)])
    payload = BytesIO()
    workbook.save(payload)
    workbook.close()
    body = payload.getvalue()
    output = tmp_path / "dataset.parquet"
    source = {**SOURCE, "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "sizeBytes": len(body)}

    manifest = prepare_parquet(source, None, body, output)

    assert manifest["columns"][-1] == "column_51"
    assert query_parquet(output, columns=["column_51"])["rows"] == [{"column_51": "value_51"}]


def test_prepares_a_workbook_that_does_not_declare_its_dimension(tmp_path: Path):
    """Some tools write sheets without <dimension>; read-only openpyxl then reports no max_column."""
    import re
    import zipfile

    openpyxl = pytest.importorskip("openpyxl")
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Customers"
    sheet.append(["customer_id", "name"])
    sheet.append(["C041", "Acme"])
    written = BytesIO()
    workbook.save(written)
    stripped = BytesIO()
    with zipfile.ZipFile(BytesIO(written.getvalue())) as source, zipfile.ZipFile(stripped, "w") as target:
        for item in source.infolist():
            content = source.read(item.filename)
            if item.filename.startswith("xl/worksheets/"):
                content = re.sub(rb"<dimension[^>]*/>", b"", content)
            target.writestr(item, content)
    body = stripped.getvalue()
    xlsx = {**SOURCE, "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "sizeBytes": len(body)}
    manifest = prepare_parquet(xlsx, None, body, tmp_path / "dataset.parquet")
    assert manifest["rowCount"] == 1
    assert manifest["columns"] == ["__sheetRow", "customer_id", "name"]
