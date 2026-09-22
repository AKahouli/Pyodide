"""Tabular row-count probes with early stop at the configured threshold.

Hard rule: never load the full dataset. CSV uses the stdlib csv module row by
row; XLSX uses openpyxl in read-only mode; legacy XLS uses xlrd. Counting stops
as soon as threshold + 1 non-empty rows are seen so a multi-million-row sheet
costs the same as a small one.
"""

import csv
from typing import IO, List, Optional, Tuple


class ProbeError(Exception):
    """Raised when a tabular file cannot be probed reliably."""


def count_nonempty_cells(row) -> bool:
    return any(cell is not None and str(cell).strip() != "" for cell in row)


def probe_csv(file_obj: IO, threshold: int) -> Tuple[int, Optional[List[str]], bool]:
    """Returns (row_count | threshold+1 when exceeded, column_names, exceeded)."""
    reader = csv.reader(file_obj)
    row_count = 0
    column_names: Optional[List[str]] = None
    for row in reader:
        if not count_nonempty_cells(row):
            continue
        if column_names is None:
            column_names = [str(cell).strip() for cell in row]
        row_count += 1
        if row_count > threshold:
            return threshold + 1, column_names, True
    return row_count, column_names, False


def probe_xlsx(path: str, threshold: int) -> Tuple[int, Optional[List[str]], Optional[int], bool]:
    """Returns (rows, column_names, sheet_count, exceeded)."""
    openpyxl = _import("openpyxl")
    try:
        return _probe_xlsx_inner(openpyxl, path, threshold)
    except ProbeError:
        raise
    except Exception as exc:
        raise ProbeError(f"xlsx probe failed: {exc}") from exc


def _probe_xlsx_inner(openpyxl, path: str, threshold: int) -> Tuple[int, Optional[List[str]], Optional[int], bool]:
    workbook = openpyxl.load_workbook(filename=path, read_only=True, data_only=True)
    total_rows = 0
    column_names: Optional[List[str]] = None
    try:
        for sheet in workbook.worksheets:
            for row in sheet.iter_rows(values_only=True):
                if not count_nonempty_cells(row):
                    continue
                if column_names is None:
                    column_names = [str(value) if value is not None else "" for value in row]
                total_rows += 1
                if total_rows > threshold:
                    return threshold + 1, column_names, None, True
            if total_rows > threshold:
                break
        sheet_count = len(workbook.worksheets)
    finally:
        workbook.close()
    return total_rows, column_names, sheet_count, False


def probe_xls(path: str, threshold: int) -> Tuple[int, Optional[List[str]], Optional[int], bool]:
    """Returns (rows, column_names, sheet_count, exceeded)."""
    xlrd = _import("xlrd")
    try:
        return _probe_xls_inner(xlrd, path, threshold)
    except ProbeError:
        raise
    except Exception as exc:
        raise ProbeError(f"xls probe failed: {exc}") from exc


def _probe_xls_inner(xlrd, path: str, threshold: int) -> Tuple[int, Optional[List[str]], Optional[int], bool]:
    book = xlrd.open_workbook(filename=path)
    total_rows = 0
    column_names: Optional[List[str]] = None
    for sheet in book.sheets():
        for row_index in range(sheet.nrows):
            if not count_nonempty_cells(sheet.row_values(row_index)):
                continue
            if column_names is None:
                column_names = [str(value) for value in sheet.row_values(row_index)]
            total_rows += 1
            if total_rows > threshold:
                return threshold + 1, column_names, book.nsheets, True
    return total_rows, column_names, book.nsheets, False


def _import(name: str):
    try:
        return __import__(name)
    except ImportError as exc:  # pragma: no cover - environment issue
        raise ProbeError(f"{name} is not installed") from exc
