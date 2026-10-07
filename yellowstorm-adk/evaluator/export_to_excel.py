"""Convert a benchmark evaluation run folder into an Excel report.

Usage:
    python evaluation/export_to_excel.py <run_directory> [-o output.xlsx]

Example:
    python evaluation/export_to_excel.py evaluation/outputs/20260728_134219_796245

The run directory is expected to contain:
    summary.json            aggregate metrics + per-query results
    effective_config.json   (optional) run configuration
    Q*/result.json          per-query result (fallback when summary.json is absent)
    Q*/tool_calls.json      (optional) per-query tool call trace

The workbook contains four sheets:
    Overview          run info + aggregate benchmark metrics
    Results           one row per question with scores and answers
    Retrieval Detail  per question: expected vs retrieved files by category
    Tool Calls        flattened tool-call trace across all questions
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

HEADER_FILL = PatternFill("solid", fgColor="1F4E79")
HEADER_FONT = Font(color="FFFFFF", bold=True, size=11)
TITLE_FONT = Font(bold=True, size=14, color="1F4E79")
GOOD_FILL = PatternFill("solid", fgColor="C6EFCE")
GOOD_FONT = Font(color="006100")
BAD_FILL = PatternFill("solid", fgColor="FFC7CE")
BAD_FONT = Font(color="9C0006")
WARN_FILL = PatternFill("solid", fgColor="FFEB9C")
WARN_FONT = Font(color="9C6500")
THIN_BORDER = Border(*[Side(style="thin", color="D9D9D9")] * 4)
WRAP = Alignment(wrap_text=True, vertical="top")
TOP = Alignment(vertical="top")


def load_json(path: Path):
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def strip_markdown(text: str) -> str:
    """Remove bold markers and citation brackets so answers read cleanly in Excel."""
    if not text:
        return ""
    text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
    return text.strip()


def question_sort_key(name: str):
    m = re.match(r"Q(\d+)", name)
    return (0, int(m.group(1))) if m else (1, name)


def load_run(run_dir: Path) -> dict:
    """Load summary + per-question data, tolerating missing files."""
    summary_path = run_dir / "summary.json"
    summary = load_json(summary_path) if summary_path.exists() else {}

    results = summary.get("results")
    if not results:
        # Fall back to collecting Q*/result.json directly.
        results = []
        for qdir in sorted(run_dir.glob("Q*"), key=lambda p: question_sort_key(p.name)):
            result_file = qdir / "result.json"
            if result_file.exists():
                results.append(load_json(result_file))
        summary["results"] = results

    config_path = run_dir / "effective_config.json"
    config = load_json(config_path) if config_path.exists() else {}
    # Never leak secrets into a report shared in meetings.
    config.pop("grpc_api_key_env", None)

    tool_calls = {}
    errors = {}
    for r in results:
        qid = r.get("query_id", "")
        tc_path = run_dir / qid / "tool_calls.json"
        if tc_path.exists():
            try:
                tool_calls[qid] = load_json(tc_path)
            except (json.JSONDecodeError, OSError):
                tool_calls[qid] = []
        error = collect_question_errors(r, run_dir / qid, tool_calls.get(qid) or [])
        if error:
            errors[qid] = error
    return {"summary": summary, "config": config, "tool_calls": tool_calls, "errors": errors}


def collect_question_errors(result: dict, qdir: Path, tool_calls: list) -> str:
    """Best error available for a question: result error, then failed-node
    events, then failed tool calls. Older runs recorded node failures only in
    events.jsonl, leaving the result error empty."""
    if result.get("error"):
        return str(result["error"])

    found = []
    events_path = qdir / "events.jsonl"
    if events_path.exists():
        for line in events_path.read_text(encoding="utf-8").splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(event, dict):
                continue
            payload = event.get("payload") or {}
            if event.get("event_type") in ("NodeFailed", "ExecutionFailed") and payload.get("error"):
                found.append(f"{event.get('event_type')}: {payload['error']}")

    for call in tool_calls:
        if isinstance(call, dict) and call.get("error"):
            found.append(f"tool {call.get('tool_name')}: {call['error']}")

    return " | ".join(found)


def shorten(text: str, limit: int = 500) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


MAX_ROW_HEIGHT = 409  # Excel's hard cap, in points.
LINE_HEIGHT = 14.5


def estimate_lines(text: Any, width: float) -> int:
    """Rough wrapped-line count for a cell of the given column width
    (openpyxl width units approximate characters per line)."""
    lines = 0
    for paragraph in str(text or "").split("\n"):
        lines += max(1, math.ceil(len(paragraph) / max(width - 2, 10)))
    return lines


def fit_row_height(ws, row: int, cells: list[tuple[Any, float]]):
    """Size the row so wrapped text is visible; Excel does not auto-fit rows
    written by openpyxl. cells = [(text, column_width), ...]."""
    lines = max(estimate_lines(text, width) for text, width in cells) if cells else 1
    ws.row_dimensions[row].height = min(MAX_ROW_HEIGHT, max(15, lines * LINE_HEIGHT))


def style_header_row(ws, row: int, n_cols: int):
    for col in range(1, n_cols + 1):
        cell = ws.cell(row=row, column=col)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        cell.border = THIN_BORDER


def set_widths(ws, widths):
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


def pass_fail_cell(cell, ok: bool, good="PASS", bad="FAIL"):
    cell.value = good if ok else bad
    cell.fill = GOOD_FILL if ok else BAD_FILL
    cell.font = GOOD_FONT if ok else BAD_FONT
    cell.alignment = Alignment(horizontal="center", vertical="top")


def recall_cell(cell, value):
    cell.value = value
    cell.number_format = "0.0%"
    cell.alignment = Alignment(horizontal="center", vertical="top")
    if value is None:
        return
    if value >= 1.0:
        cell.fill, cell.font = GOOD_FILL, GOOD_FONT
    elif value >= 0.7:
        cell.fill, cell.font = WARN_FILL, WARN_FONT
    else:
        cell.fill, cell.font = BAD_FILL, BAD_FONT


def build_overview(wb: Workbook, run_dir: Path, summary: dict, config: dict):
    ws = wb.active
    ws.title = "Overview"
    ws["A1"] = "Benchmark Evaluation Report"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = f"Run: {run_dir.name}"
    ws["A2"].font = Font(italic=True, color="595959")

    results = summary.get("results", [])
    durations = [r.get("duration_ms") for r in results if r.get("duration_ms")]
    tool_counts = [r.get("tool_call_count") for r in results if r.get("tool_call_count") is not None]
    hard_neg_hits = sum(
        1 for r in results if (r.get("metrics") or {}).get("hard_negative_found")
    )

    rows = [
        ("Metric", "Value"),
        ("Total queries", summary.get("query_count", len(results))),
        ("Completed", summary.get("completed_count")),
        ("Failed", summary.get("failed_count")),
        ("Average required recall", summary.get("average_required_recall")),
        ("Exact set accuracy", summary.get("exact_set_accuracy")),
        ("LLM judge average score", summary.get("judge_average_score")),
        ("LLM judge accuracy (fully correct)", summary.get("judge_accuracy")),
        ("Queries retrieving a hard negative", f"{hard_neg_hits} / {len(results)}"),
        ("Average duration (s)", round(sum(durations) / len(durations) / 1000, 1) if durations else None),
        ("Average tool calls per query", round(sum(tool_counts) / len(tool_counts), 1) if tool_counts else None),
    ]
    rows = [rows[0]] + [(label, value) for label, value in rows[1:] if value is not None]
    start = 4
    for i, (label, value) in enumerate(rows):
        r = start + i
        ws.cell(row=r, column=1, value=label).border = THIN_BORDER
        cell = ws.cell(row=r, column=2, value=value)
        cell.border = THIN_BORDER
        if isinstance(value, float) and 0 <= value <= 1:
            cell.number_format = "0.0%"
    style_header_row(ws, start, 2)

    if config:
        r = start + len(rows) + 2
        ws.cell(row=r, column=1, value="Run configuration").font = Font(bold=True, size=12, color="1F4E79")
        r += 1
        ws.cell(row=r, column=1, value="Setting")
        ws.cell(row=r, column=2, value="Value")
        style_header_row(ws, r, 2)
        for key, value in config.items():
            r += 1
            ws.cell(row=r, column=1, value=key).border = THIN_BORDER
            cell = ws.cell(row=r, column=2, value=json.dumps(value) if isinstance(value, (list, dict)) else value)
            cell.border = THIN_BORDER
            cell.alignment = TOP

    set_widths(ws, [38, 70])


def build_results(wb: Workbook, results: list, errors: dict[str, str]):
    ws = wb.create_sheet("Results")
    has_judge = any(
        isinstance((r.get("metrics") or {}).get("llm_judge"), dict) for r in results
    )
    headers = [
        "ID", "Question", "Expected Answer", "Model Answer", "Status",
        "Required Recall", "Required Found / Total", "Exact Set (no hard neg)",
        "Hard Negatives Retrieved", "Tool Calls",
        "Duration (s)", "Skills Tested", "Error",
    ]
    if has_judge:
        headers[9:9] = ["Judge Verdict", "Judge Score", "Judge Reasoning"]
    ws.append(headers)
    style_header_row(ws, 1, len(headers))

    for r in results:
        metrics = r.get("metrics") or {}
        required = r.get("required") or []
        found = metrics.get("required_found") or []
        hard_neg = metrics.get("hard_negative_found") or []
        error = errors.get(r.get("query_id", ""), "")
        row = ws.max_row + 1
        ws.cell(row=row, column=1, value=r.get("query_id")).alignment = TOP
        ws.cell(row=row, column=2, value=r.get("query")).alignment = WRAP
        ws.cell(row=row, column=3, value=strip_markdown(r.get("expected_answer") or "")).alignment = WRAP
        answer = strip_markdown(r.get("answer") or "")
        answer_cell = ws.cell(row=row, column=4, value=answer)
        answer_cell.alignment = WRAP
        if not answer:
            answer_cell.value = (
                f"NO ANSWER — {shorten(error, 200)}" if error else "NO ANSWER"
            )
            answer_cell.fill, answer_cell.font = BAD_FILL, BAD_FONT
        status = r.get("status", "")
        status_cell = ws.cell(row=row, column=5, value=status)
        status_cell.alignment = Alignment(horizontal="center", vertical="top")
        if status == "completed" and not error:
            status_cell.fill, status_cell.font = GOOD_FILL, GOOD_FONT
        elif status == "completed":
            status_cell.value = "completed*"
            status_cell.fill, status_cell.font = WARN_FILL, WARN_FONT
        elif status:
            status_cell.fill, status_cell.font = BAD_FILL, BAD_FONT
        recall_cell(ws.cell(row=row, column=6), metrics.get("required_recall"))
        ws.cell(row=row, column=7, value=f"{len(found)} / {len(required)}").alignment = Alignment(
            horizontal="center", vertical="top"
        )
        pass_fail_cell(ws.cell(row=row, column=8), bool(metrics.get("exact_required_set_without_hard_negative")))
        hn_cell = ws.cell(row=row, column=9, value=", ".join(hard_neg) if hard_neg else "none")
        hn_cell.alignment = WRAP
        if hard_neg:
            hn_cell.fill, hn_cell.font = BAD_FILL, BAD_FONT
        else:
            hn_cell.fill, hn_cell.font = GOOD_FILL, GOOD_FONT
        col = 10
        if has_judge:
            judge = metrics.get("llm_judge") or {}
            verdict = str(judge.get("verdict") or "")
            verdict_cell = ws.cell(row=row, column=col, value=verdict)
            verdict_cell.alignment = Alignment(horizontal="center", vertical="top")
            if verdict == "correct":
                verdict_cell.fill, verdict_cell.font = GOOD_FILL, GOOD_FONT
            elif verdict in ("partially_correct", "not_judged", "judge_error"):
                verdict_cell.fill, verdict_cell.font = WARN_FILL, WARN_FONT
            elif verdict:
                verdict_cell.fill, verdict_cell.font = BAD_FILL, BAD_FONT
            recall_cell(ws.cell(row=row, column=col + 1), judge.get("score"))
            ws.cell(row=row, column=col + 2, value=judge.get("reasoning") or "").alignment = WRAP
            col += 3
        ws.cell(row=row, column=col, value=r.get("tool_call_count")).alignment = Alignment(
            horizontal="center", vertical="top"
        )
        dur = r.get("duration_ms")
        dur_cell = ws.cell(row=row, column=col + 1, value=round(dur / 1000, 1) if dur else None)
        dur_cell.alignment = Alignment(horizontal="center", vertical="top")
        ws.cell(row=row, column=col + 2, value=", ".join(r.get("skills") or [])).alignment = WRAP
        error_cell = ws.cell(row=row, column=col + 3, value=shorten(error) if error else "")
        error_cell.alignment = WRAP
        if error:
            error_cell.fill, error_cell.font = BAD_FILL, BAD_FONT
        for border_col in range(1, len(headers) + 1):
            ws.cell(row=row, column=border_col).border = THIN_BORDER
        fit_row_height(ws, row, [
            (r.get("query"), 45),
            (strip_markdown(r.get("expected_answer") or ""), 45),
            (answer_cell.value, 55),
        ])

    widths = [6, 45, 45, 55, 12, 12, 12, 14, 30]
    if has_judge:
        widths += [14, 10, 40]
    widths += [8, 10, 30, 40]
    set_widths(ws, widths)
    ws.freeze_panes = "C2"


def build_answers(wb: Workbook, results: list, errors: dict[str, str]):
    """Full, untruncated text of every question and answer, one paragraph per
    row, so nothing depends on Excel row-height limits."""
    ws = wb.create_sheet("Answers")
    set_widths(ws, [16, 110])
    label_font = Font(bold=True, color="1F4E79")
    row = 1

    def write_block(label: str, text: str, fill=None, font=None):
        nonlocal row
        first = True
        paragraphs = [p for p in (text or "").split("\n") if p.strip()] or [""]
        for paragraph in paragraphs:
            label_cell = ws.cell(row=row, column=1, value=label if first else "")
            label_cell.font = label_font
            label_cell.alignment = TOP
            cell = ws.cell(row=row, column=2, value=paragraph)
            cell.alignment = WRAP
            if fill:
                cell.fill = fill
            if font:
                cell.font = font
            fit_row_height(ws, row, [(paragraph, 110)])
            first = False
            row += 1

    for r in results:
        metrics = r.get("metrics") or {}
        qid = r.get("query_id", "")
        title = ws.cell(row=row, column=1, value=qid)
        title.fill = HEADER_FILL
        title.font = HEADER_FONT
        question_cell = ws.cell(row=row, column=2, value=r.get("query"))
        question_cell.fill = HEADER_FILL
        question_cell.font = HEADER_FONT
        question_cell.alignment = Alignment(wrap_text=True, vertical="center")
        fit_row_height(ws, row, [(r.get("query"), 110)])
        row += 1

        write_block("Expected", strip_markdown(r.get("expected_answer") or ""))
        answer = strip_markdown(r.get("answer") or "")
        error = errors.get(qid, "")
        if answer:
            write_block("Model answer", answer)
        else:
            write_block("Model answer", f"NO ANSWER — {error}" if error else "NO ANSWER", BAD_FILL, BAD_FONT)
        judge = metrics.get("llm_judge")
        if isinstance(judge, dict):
            verdict = str(judge.get("verdict") or "")
            score = judge.get("score")
            summary_line = verdict + (f" (score {score:.0%})" if isinstance(score, (int, float)) else "")
            reasoning = str(judge.get("reasoning") or "")
            write_block("Judge", f"{summary_line} — {reasoning}" if reasoning else summary_line)
        if answer and error:
            write_block("Error", shorten(error), BAD_FILL, BAD_FONT)
        row += 1  # spacer


def build_retrieval_detail(wb: Workbook, results: list):
    ws = wb.create_sheet("Retrieval Detail")
    headers = ["ID", "Category", "File", "Retrieved?"]
    ws.append(headers)
    style_header_row(ws, 1, len(headers))

    for r in results:
        qid = r.get("query_id")
        metrics = r.get("metrics") or {}
        retrieved = set(metrics.get("retrieved_files") or [])
        expected = set()
        categories = [
            ("Required", r.get("required") or [], True),
            ("Optional", r.get("optional") or [], None),
            ("Hard negative", r.get("hard_negative") or [], False),
        ]
        for category, files, want_retrieved in categories:
            for file_name in files:
                expected.add(file_name)
                row = ws.max_row + 1
                was_retrieved = file_name in retrieved
                ws.cell(row=row, column=1, value=qid)
                ws.cell(row=row, column=2, value=category)
                ws.cell(row=row, column=3, value=file_name)
                cell = ws.cell(row=row, column=4, value="yes" if was_retrieved else "no")
                cell.alignment = Alignment(horizontal="center")
                # Retrieving a required file is good; retrieving a hard negative is bad.
                if want_retrieved is True:
                    ok = was_retrieved
                elif want_retrieved is False:
                    ok = not was_retrieved
                else:
                    ok = None
                if ok is True:
                    cell.fill, cell.font = GOOD_FILL, GOOD_FONT
                elif ok is False:
                    cell.fill, cell.font = BAD_FILL, BAD_FONT
                for col in range(1, len(headers) + 1):
                    ws.cell(row=row, column=col).border = THIN_BORDER
        for file_name in sorted(retrieved - expected):
            row = ws.max_row + 1
            ws.cell(row=row, column=1, value=qid)
            ws.cell(row=row, column=2, value="Extra (unlisted)")
            ws.cell(row=row, column=3, value=file_name)
            cell = ws.cell(row=row, column=4, value="yes")
            cell.alignment = Alignment(horizontal="center")
            cell.fill, cell.font = WARN_FILL, WARN_FONT
            for col in range(1, len(headers) + 1):
                ws.cell(row=row, column=col).border = THIN_BORDER

    set_widths(ws, [6, 16, 55, 12])
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:D{ws.max_row}"


def build_tool_calls(wb: Workbook, tool_calls: dict):
    if not any(tool_calls.values()):
        return
    ws = wb.create_sheet("Tool Calls")
    headers = ["ID", "#", "Tool", "Agent", "Role", "Status", "Duration (ms)", "Error"]
    ws.append(headers)
    style_header_row(ws, 1, len(headers))

    for qid in sorted(tool_calls, key=question_sort_key):
        for call in tool_calls[qid]:
            row = ws.max_row + 1
            values = [
                qid,
                call.get("call_index"),
                call.get("tool_name"),
                call.get("agent_name"),
                call.get("agent_role"),
                call.get("status"),
                call.get("duration_ms"),
                call.get("error") or "",
            ]
            for col, value in enumerate(values, start=1):
                cell = ws.cell(row=row, column=col, value=value)
                cell.border = THIN_BORDER
                cell.alignment = TOP
            status_cell = ws.cell(row=row, column=6)
            if status_cell.value == "completed":
                status_cell.fill, status_cell.font = GOOD_FILL, GOOD_FONT
            elif status_cell.value:
                status_cell.fill, status_cell.font = BAD_FILL, BAD_FONT

    set_widths(ws, [6, 5, 45, 22, 12, 12, 14, 40])
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:H{ws.max_row}"


def export(run_dir: Path, output: Path | None) -> Path:
    data = load_run(run_dir)
    results = data["summary"].get("results", [])
    if not results:
        raise SystemExit(f"No results found in {run_dir} (missing summary.json and Q*/result.json)")

    wb = Workbook()
    build_overview(wb, run_dir, data["summary"], data["config"])
    build_results(wb, results, data["errors"])
    build_answers(wb, results, data["errors"])
    build_retrieval_detail(wb, results)
    build_tool_calls(wb, data["tool_calls"])

    if output is None:
        output = run_dir / f"benchmark_report_{run_dir.name}.xlsx"
    output.parent.mkdir(parents=True, exist_ok=True)
    wb.save(output)
    return output


def main():
    parser = argparse.ArgumentParser(description="Export a benchmark evaluation run folder to Excel.")
    parser.add_argument("run_dir", type=Path, help="Run directory, e.g. evaluation/outputs/20260728_134219_796245")
    parser.add_argument("-o", "--output", type=Path, default=None, help="Output .xlsx path (default: inside the run directory)")
    args = parser.parse_args()

    if not args.run_dir.is_dir():
        sys.exit(f"Not a directory: {args.run_dir}")
    output = export(args.run_dir, args.output)
    print(f"Report written to {output}")


if __name__ == "__main__":
    main()
