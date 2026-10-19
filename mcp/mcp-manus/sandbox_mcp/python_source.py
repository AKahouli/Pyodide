"""Validate Python the agent writes so Excel A1 refs are not treated as code."""
from __future__ import annotations

EXCEL_IN_PYTHON_HINT = (
    "Excel A1 references such as 'Sheet'!B4 are not Python. "
    "Store them as strings for openpyxl, e.g. "
    "ws['C1'] = \"='3. Verdict & Gaps'!B4\" "
    "or labels = [(\"Verdict\", \"='3. Verdict & Gaps'!B4\")]. "
    "Never write 'Sheet Name'!B4 as a bare expression in a .py file."
)


def python_write_error(path: str, content: str) -> str | None:
    """Return an error message if `content` is invalid Python, else None.

    Only applies to .py paths. Incomplete fragments on append are not checked here.
    """
    if not str(path).replace("\\", "/").lower().endswith(".py"):
        return None
    if not content or not str(content).strip():
        return "Python file is empty."
    try:
        compile(content, path, "exec")
    except SyntaxError as exc:
        line = ""
        if exc.lineno and content:
            lines = content.splitlines()
            if 1 <= exc.lineno <= len(lines):
                line = lines[exc.lineno - 1]
        excelish = "!" in (exc.text or "") or "!" in line
        hint = f" {EXCEL_IN_PYTHON_HINT}" if excelish else ""
        where = f"line {exc.lineno}" if exc.lineno else "unknown line"
        return (
            f"Python SyntaxError at {where}: {exc.msg}. "
            f"Offending text: {(line or exc.text or '').strip()!r}.{hint}"
        )
    return None
