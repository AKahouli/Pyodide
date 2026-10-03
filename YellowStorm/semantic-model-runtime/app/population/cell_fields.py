"""A spreadsheet cell read like a document: the document reading rules and AI applied to its text.

A sheet field can be "extracted with evidence" from a column: in each row, the text of that column's
cell is the document. The same functions read it as they read a file (``document._read_rules`` for
the rules, ``document._apply_ai_extraction`` for the AI and its grounding), so a rule or an AI reading
behaves the same on a cell as on a document. Evidence names the row, the column and the span of the
cell the value was found in.

AI is bounded per source: at most one call per row (all of the row's AI fields together), at most
``max_ai_rows()`` rows per source and run, a few rows at a time, and a row whose cells did not change
reuses its earlier answer from the extraction cache.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import re
from typing import Any

from .document_rules import MAX_LABEL_CHARS, RuleError, normalize_rules, shaped_input

CELL_EXTRACTION_VERSION = "cell-v1"
# A cell has no pages, headings or tables: the places that read a passage or a line still apply.
CELL_LOCATIONS = ("auto", "same_line", "next_line", "anywhere", "after_label", "before_label")
STRATEGIES = ("deterministic", "ai", "rules_then_ai")
MAX_FIELD_EXTRACTIONS = 25
MAX_COLUMN_CHARS = 200
MAX_CELL_CHARS = 20000
MAX_QUOTE_CHARS = 600
MAX_RAW_CHARS = 3000
# Rows of one source read with AI in a run, unless the environment says otherwise.
DEFAULT_MAX_AI_ROWS = 500
AI_ROW_CONCURRENCY = 4
MAX_PREVIEW_ROWS = 20
def _doc():  # type: ignore[no-untyped-def]
    """The document readers, imported on first use (they bring the index clients along)."""
    from . import document
    return document


_HINT_KEYS = ("semanticDefinition", "agentId", "description", "valueType")
_PARAGRAPH = re.compile(r"\n[ \t]*\n")
_LABEL_LOCATIONS = ("auto", "same_line", "next_line")


def max_ai_rows() -> int:
    """How many rows of one source a run may read with AI (``SEMANTIC_MAX_AI_ROWS_PER_SOURCE``)."""
    try:
        value = int(os.environ.get("SEMANTIC_MAX_AI_ROWS_PER_SOURCE", DEFAULT_MAX_AI_ROWS))
    except ValueError:
        value = DEFAULT_MAX_AI_ROWS
    return max(0, min(value, 200000))


def normalize_field_extractions(raw: Any) -> dict[str, dict[str, Any]]:
    """The cell extractions of a sheet mapping by field, in the shape the document readers use, or
    ``RuleError``. ``sourceField`` is the field's label (the default label its rules look for)."""
    if raw is None:
        return {}
    if not isinstance(raw, dict) or len(raw) > MAX_FIELD_EXTRACTIONS:
        raise RuleError(f"fieldExtractions must map at most {MAX_FIELD_EXTRACTIONS} fields")
    specs: dict[str, dict[str, Any]] = {}
    for attribute, item in raw.items():
        if not isinstance(attribute, str) or not attribute.strip() or not isinstance(item, dict):
            raise RuleError("fieldExtractions must map fields to how they are read")
        column = item.get("column")
        if not isinstance(column, str) or not column.strip() or len(column) > MAX_COLUMN_CHARS:
            raise RuleError(f"{attribute}: an extracted field reads a column")
        strategy = item.get("extractionStrategy") or "deterministic"
        if strategy not in STRATEGIES:
            raise RuleError(f"{attribute}: unknown strategy")
        rules = normalize_rules(item.get("rules"))
        if rules is not None and rules["location"] not in CELL_LOCATIONS:
            raise RuleError(f"{attribute}: a cell has no pages, headings or tables")
        label = item.get("label")
        label = label.strip()[:MAX_LABEL_CHARS] if isinstance(label, str) and label.strip() else attribute
        spec: dict[str, Any] = {"targetAttribute": attribute, "mode": "extract", "sourceField": label,
                                "column": column, "extractionStrategy": strategy, "rules": rules}
        for key in _HINT_KEYS:
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                spec[key] = value[:2000]
        allowed = item.get("allowedValues")
        if isinstance(allowed, list):
            spec["allowedValues"] = [str(value)[:200] for value in allowed[:200]]
        specs[attribute] = spec
    return specs


def extractions_from_mappings(mappings: list[Any]) -> dict[str, dict[str, Any]]:
    """The raw ``fieldExtractions`` of sheet field mappings read with ``mode: extract`` (preview drafts)."""
    raw: dict[str, dict[str, Any]] = {}
    for item in mappings:
        if not isinstance(item, dict) or item.get("mode") != "extract":
            continue
        attribute = item.get("targetAttribute")
        if not isinstance(attribute, str) or not attribute:
            continue
        raw[attribute] = {"column": item.get("sourceField"), "label": item.get("label"),
                          **{key: item[key] for key in ("extractionStrategy", "rules", "allowedValues", *_HINT_KEYS)
                             if item.get(key) is not None}}
    return raw


def extraction_columns(specs: dict[str, dict[str, Any]]) -> set[str]:
    return {spec["column"] for spec in specs.values()}


def uses_ai(specs: dict[str, dict[str, Any]]) -> bool:
    return any(spec["extractionStrategy"] != "deterministic" for spec in specs.values())


def cell_text(value: Any) -> str:
    """A cell as text, bounded."""
    return "" if value is None else str(value)[:MAX_CELL_CHARS]


def cell_sections(text: str, column: str, section_pk: int = 1) -> list[dict[str, Any]]:
    """The cell as a one-section document: one block per paragraph, each knowing where it starts."""
    blocks: list[dict[str, Any]] = []
    start = 0
    breaks = list(_PARAGRAPH.finditer(text))
    for match in [*breaks, None]:
        end = match.start() if match else len(text)
        content = text[start:end]
        if content.strip():
            number = len(blocks) + 1
            blocks.append({"blockPk": number, "blockKey": f"{column}#{number}", "pageNumber": None,
                           "blockType": "text", "origin": "cell_text", "content": content, "start": start})
        if match:
            start = match.end()
    return [{"sectionPk": section_pk, "sectionKey": column, "title": None, "blocks": blocks}] if blocks else []


def text_span(text: str, found: Any) -> dict[str, int] | None:
    """Where ``found`` is in the cell text (case aside), as character offsets."""
    if not isinstance(found, str) or not found.strip():
        return None
    needle = found.strip()
    at = text.find(needle)
    if at < 0:
        at = text.lower().find(needle.lower())
    return {"start": at, "end": at + len(needle)} if at >= 0 else None


def _labels_by_column(specs: dict[str, dict[str, Any]]) -> dict[str, list[str]]:
    """The labels of the rule fields read on each column: a record row needs two of them."""
    labels: dict[str, list[str]] = {}
    for spec in specs.values():
        location = (spec.get("rules") or {}).get("location") or "auto"
        if spec["extractionStrategy"] == "ai" or location not in _LABEL_LOCATIONS:
            continue
        labels.setdefault(spec["column"], []).extend(_doc()._mapping_labels(spec))
    return labels


def _evidence(context: dict[str, Any], row_number: Any, column: str, text: str, *, value: Any, raw: Any,
              quote: str, origin: str, extractor_version: str) -> dict[str, Any]:
    evidence = {"assetRef": context.get("assetRef"), "rowNumber": row_number, "column": column,
                "origin": origin, "extractorVersion": extractor_version,
                "mappingVersion": context.get("mappingVersion"),
                "rawEvidenceHash": "sha256:" + hashlib.sha256(text.encode()).hexdigest(),
                "quote": quote[:MAX_QUOTE_CHARS]}
    span = text_span(text, value if isinstance(value, str) else None) or text_span(text, raw)
    if span:
        evidence["span"] = span
    return evidence


def read_row_rules(specs: dict[str, dict[str, Any]], cells: dict[str, str], *, row_number: Any = None,
                   context: dict[str, Any] | None = None) -> dict[str, Any]:
    """The fields read by rules in one row: values, cell evidence and how each field was read."""
    context = context or {}
    labels = _labels_by_column(specs)
    values: dict[str, Any] = {}
    evidence: dict[str, dict[str, Any]] = {}
    fields: dict[str, dict[str, Any]] = {}
    for attribute, spec in specs.items():
        if spec["extractionStrategy"] == "ai":
            continue
        column = spec["column"]
        text = cells.get(column, "")
        if not text.strip():
            fields[attribute] = {"method": "rules", "reason": "no_input", "column": column}
            continue
        sections = cell_sections(text, column)
        outcome = _doc()._read_rules(spec, sections, sections, labels.get(column, []))
        if outcome["reason"] == "found":
            quote = str(outcome["block"].get("content") or "")
            values[attribute] = outcome["value"]
            evidence[attribute] = _evidence(context, row_number, column, text, value=outcome["value"],
                                            raw=outcome["raw"], quote=quote, origin="cell_rules",
                                            extractor_version=CELL_EXTRACTION_VERSION)
            fields[attribute] = {"method": "rules", "reason": "found", "value": outcome["value"], "column": column,
                                 "quote": quote[:MAX_QUOTE_CHARS], "raw": outcome["raw"][:MAX_RAW_CHARS],
                                 **({"span": evidence[attribute]["span"]} if "span" in evidence[attribute] else {})}
        else:
            reading = {"method": "rules", "column": column,
                       **{name: item for name, item in outcome.items() if name in ("reason", "values")}}
            if outcome.get("values"):
                reading["raw"] = shaped_input(str(outcome["values"][0]), spec.get("rules"))[:MAX_RAW_CHARS]
            fields[attribute] = reading
    return {"values": values, "evidence": evidence, "fields": fields}


def _cells_key(cells: dict[str, str], columns: list[str]) -> dict[str, str]:
    return {column: hashlib.sha256(cells.get(column, "").encode()).hexdigest() for column in columns}


class CellReader:
    """Reads the extracted fields of a sheet's rows: rules on every row, AI on at most ``ai_rows`` rows.

    ``context`` carries what the AI and the evidence need: ``conceptId``, ``conceptLabel``, ``source``
    (``assetId``, ``originalName``), ``assetRef``, ``mappingVersion``, ``modelId``, ``aiExtraction``
    and the normalized AI ``settings``. ``stats`` counts the AI calls made, reused and left out.
    """

    def __init__(self, specs: dict[str, dict[str, Any]], context: dict[str, Any], *, cache: Any = None,
                 ai_rows: int | None = None, extract: Any = None) -> None:
        from .document_rules import normalize_ai_settings

        self.specs = specs
        self.context = {**context, "settings": context.get("settings") or normalize_ai_settings(None)}
        self.cache = cache
        self.ai_rows = max_ai_rows() if ai_rows is None else ai_rows
        # The AI reader, replaceable in tests; it is document._apply_ai_extraction's signature.
        self.extract = extract or _doc()._apply_ai_extraction
        self.stats: dict[str, Any] = {"aiRows": 0, "aiCalls": 0, "aiReused": 0, "aiSkippedRows": 0,
                                      "aiFailedRows": 0, "lastFailure": None}
        self._semaphore = asyncio.Semaphore(AI_ROW_CONCURRENCY)

    async def read_rows(self, rows: list[tuple[Any, dict[str, str]]]) -> list[dict[str, Any]]:
        """For each ``(rowNumber, cells by column)``: ``values``, ``evidence`` and ``fields`` (readings)."""
        results = [read_row_rules(self.specs, cells, row_number=number, context=self.context) for number, cells in rows]
        tasks = []
        for (number, cells), result in zip(rows, results):
            pending = [spec for attribute, spec in self.specs.items()
                       if spec["extractionStrategy"] == "ai"
                       or (spec["extractionStrategy"] == "rules_then_ai" and attribute not in result["values"])]
            if not pending:
                continue
            if not any(cells.get(spec["column"], "").strip() for spec in pending):
                for spec in pending:
                    self._missed(result, spec, "no_input", None)
                continue
            if self.stats["aiRows"] >= self.ai_rows:
                self.stats["aiSkippedRows"] += 1
                for spec in pending:
                    self._missed(result, spec, "ai_failed", "ai_row_limit")
                continue
            self.stats["aiRows"] += 1
            tasks.append(self._read_ai(number, cells, pending, result))
        if tasks:
            await asyncio.gather(*tasks)
        return results

    def _missed(self, result: dict[str, Any], spec: dict[str, Any], reason: str, detail: str | None) -> None:
        attribute = spec["targetAttribute"]
        earlier = result["fields"].get(attribute)
        result["fields"][attribute] = {"method": "ai", "reason": reason, "column": spec["column"],
                                       **({"detail": detail} if detail else {}),
                                       **({"rules": earlier} if earlier else {})}

    async def _read_ai(self, number: Any, cells: dict[str, str], pending: list[dict[str, Any]],
                       result: dict[str, Any]) -> None:
        columns = sorted({spec["column"] for spec in pending if cells.get(spec["column"], "").strip()})
        cache_key = None
        answer: dict[str, Any] | None = None
        if self.cache is not None:
            from app.persistence.extraction_cache import extraction_cache_key
            cache_key = extraction_cache_key({
                "engine": CELL_EXTRACTION_VERSION, "modelId": self.context.get("modelId"),
                "conceptId": self.context.get("conceptId"), "fields": pending, "cells": _cells_key(cells, columns),
                "settings": self.context.get("settings"), "aiExtraction": self.context.get("aiExtraction")})
            answer = await self.cache.get(cache_key)
            if answer is not None:
                self.stats["aiReused"] += 1
        if answer is None:
            sections: list[dict[str, Any]] = []
            for index, column in enumerate(columns, start=1):
                sections += cell_sections(cells[column], column, index)
            source = dict(self.context.get("source") or {})
            source["originalName"] = f"{source.get('originalName') or 'sheet'} Â· row {number}"
            entry = {"conceptId": self.context.get("conceptId"), "conceptLabel": self.context.get("conceptLabel"),
                     "source": source, "mappingVersion": self.context.get("mappingVersion")}
            values: dict[str, Any] = {}
            evidence: dict[str, dict[str, Any]] = {}
            quotes: dict[str, str] = {}
            async with self._semaphore:
                self.stats["aiCalls"] += 1
                failure, _sent = await self.extract(
                    entry, self.context.get("assetRef") or {}, sections, pending,
                    str(self.context.get("modelId") or ""), self.context.get("aiExtraction"),
                    values, evidence, self.context["settings"], quotes)
            by_section = {index: column for index, column in enumerate(columns, start=1)}
            answer = {"failure": failure, "values": values, "quotes": quotes,
                      "evidence": {key: {"column": by_section.get(item.get("sectionPk"), pending[0]["column"]),
                                         **{name: item[name] for name in ("extractorVersion", "model", "requestedAgentId", "rephrased")
                                            if name in item}}
                                   for key, item in evidence.items()}}
            if failure is None and cache_key is not None:
                asset = str((self.context.get("source") or {}).get("assetId") or "")
                await self.cache.put(cache_key, concept_id=str(self.context.get("conceptId") or ""),
                                     asset_id=f"{asset}#cell-ai:{number}", output=answer)
        if answer.get("failure") is not None:
            self.stats["aiFailedRows"] += 1
            self.stats["lastFailure"] = answer["failure"]
        for spec in pending:
            attribute = spec["targetAttribute"]
            if attribute not in answer["values"]:
                self._missed(result, spec, "ai_failed" if answer.get("failure") else "ai_not_found", answer.get("failure"))
                continue
            found = answer["evidence"].get(attribute) or {"column": spec["column"]}
            column = found["column"]
            text = cells.get(column, "")
            value = answer["values"][attribute]
            quote = answer["quotes"].get(attribute) or text
            evidence = _evidence(self.context, number, column, text, value=value, raw=None, quote=quote,
                                 origin="ai", extractor_version=str(found.get("extractorVersion") or "ai-attribute-v1"))
            evidence.update({name: found[name] for name in ("model", "requestedAgentId", "rephrased") if name in found})
            result["values"][attribute] = value
            result["evidence"][attribute] = evidence
            result["fields"][attribute] = {"method": "ai", "reason": "found", "value": value, "column": column,
                                           "quote": quote[:MAX_QUOTE_CHARS],
                                           **({"span": evidence["span"]} if "span" in evidence else {})}


def cell_gaps(concept_id: str, asset_ref: dict[str, Any], specs: dict[str, dict[str, Any]],
              missing: dict[str, int], rows: int, stats: dict[str, Any]) -> list[dict[str, Any]]:
    """What a source's cell extractions left unread, once per field rather than once per row."""
    gaps: list[dict[str, Any]] = []
    for attribute in specs:
        count = missing.get(attribute, 0)
        if count:
            gaps.append({"kind": "unresolved_document_field", "conceptId": concept_id, "rowNumber": None,
                         "field": attribute, "assetRef": asset_ref,
                         "detail": f"field '{attribute}' was not found in {count} of {rows} rows"})
    if stats.get("aiFailedRows"):
        gaps.append({"kind": "ai_extraction_unavailable", "conceptId": concept_id, "rowNumber": None,
                     "assetRef": asset_ref,
                     "detail": f"AI extraction failed for {stats['aiFailedRows']} rows: {stats.get('lastFailure')}"})
    if stats.get("aiSkippedRows"):
        gaps.append({"kind": "budget_exhausted", "conceptId": concept_id, "rowNumber": None, "scope": "ai",
                     "assetRef": asset_ref,
                     "detail": f"AI read {stats.get('aiRows', 0)} rows; {stats['aiSkippedRows']} more rows were "
                               "left to the rules"})
    return gaps