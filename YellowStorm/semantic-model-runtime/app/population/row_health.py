"""What a run learned about how one concept's source rows became records.

A concept's rows go through a journey: rows in the source, rows read, rows that could make a record,
records made. This module counts that journey and keeps the few facts a person needs to act on a
problem: a key too coarse to tell rows apart (with the fields that would), values the key leaves out,
rows the AI never read because of the admin's limit, and competing values. Everything is bounded:
a sampled set of rows, a few examples per finding, and counts, never the documents themselves.

Pure stdlib. The tabular and derived readers feed it through ``observe`` hooks; a sheet's reading
is stored in the extraction cache as a ``snapshot`` and absorbed again when the sheet is reused.
"""

from __future__ import annotations

from collections import Counter
from typing import Any, Callable

from .tabular import normalize_identity_value

MAX_EXAMPLES = 5
MAX_TOP_KEYS = 5
# Distinct keys followed to name the most shared ones; rows of any other key are only counted.
MAX_TRACKED_KEYS = 2000
MAX_EXAMPLE_KEYS = 50
EXAMPLES_PER_KEY = 3
# A sample of the rows that made a key: the evidence for a better key.
MAX_SAMPLE_ROWS = 1000
SAMPLE_BLOCK = 100
MAX_SAMPLE_VALUE = 60
MAX_EXAMPLE_FIELDS = 6
MAX_EXAMPLE_VALUE = 80
MAX_CONFLICT_VALUES = 50
# A key is too coarse when many rows share few keys, and values were thrown away because of it.
MIN_ROWS_TOO_COARSE = 20
TOO_COARSE_RATIO = 0.05
UNIQUE_RATIO = 0.98
MAX_SUGGESTED_FIELDS = 4
SNAPSHOT_VERSION = 1
# What an archive's reading counts that a person may want to know about, per table (see ``archive_reading``).
READING_NOTABLE = {
    "attachments": ("truncated", "scanned", "unsupported", "encrypted", "tooLarge", "inflatedTooLarge", "unreadable",
                    "readerMissing"),
    "messages": ("notRead", "emlTooLarge", "bodyTruncated"),
}


def _clip(value: Any, limit: int) -> Any:
    return value[:limit] if isinstance(value, str) else value


def suggest_key(sample: list[dict[str, str]], key_fields: list[str], rows: int) -> dict[str, Any] | None:
    """Fields that, with the current key, tell the sampled rows apart; ``None`` when none does.

    Greedy: keep the current key, add the field that separates the most rows until (nearly) every
    sampled row is alone, then drop what was added without need. ``estimatedRecords`` scales the
    sample's distinct keys to the ``rows`` of the whole reading."""
    if len(sample) < 2:
        return None
    fields = sorted({name for row in sample for name in row})
    if not fields:
        return None

    def distinct(chosen: list[str]) -> int:
        return len({tuple(row.get(name) or "" for name in chosen) for row in sample})

    chosen = [name for name in key_fields if name in fields]
    best = distinct(chosen) if chosen else 1
    target = UNIQUE_RATIO * len(sample)
    while best < target and len(chosen) < len(key_fields) + MAX_SUGGESTED_FIELDS:
        candidates = [(distinct(chosen + [name]), name) for name in fields if name not in chosen
                      and sum(1 for row in sample if row.get(name)) >= len(sample) / 2]
        if not candidates:
            break
        count, name = min(candidates, key=lambda item: (-item[0], item[1]))
        if count <= best:
            break
        chosen.append(name)
        best = count
    if best < target:
        return None
    for name in [name for name in chosen if name not in key_fields]:
        rest = [other for other in chosen if other != name]
        if rest and distinct(rest) >= target:
            chosen = rest
            best = distinct(chosen)
    if chosen == [name for name in key_fields if name in fields]:
        return None
    return {"fields": chosen, "estimatedRecords": round(rows * best / len(sample)),
            "sampleRows": len(sample)}


class ConceptHealth:
    """The journey of one concept's rows, fed by the readers while they build its records."""

    def __init__(self, concept_id: str, key_fields: list[str] | None = None,
                 fields: list[str] | None = None) -> None:
        self.concept_id = concept_id
        self.key_fields = list(key_fields or [])
        self.fields = sorted(fields or [])
        self.sources: list[dict[str, Any]] = []
        self.keyed = 0
        self.tuples: Counter[tuple[str, ...]] = Counter()
        self.overflow = 0
        self.tuple_examples: dict[tuple[str, ...], list[dict[str, Any]]] = {}
        self.sample: list[dict[str, str]] = []
        self.sample_seen = 0
        self.missing: dict[str, dict[str, Any]] = {}
        self.ai_limited: Counter[str] = Counter()
        self.conflicts: dict[str, dict[str, Any]] = {}
        self.ai: dict[str, int] | None = None
        self._source: dict[str, Any] | None = None

    # -- the source being read ------------------------------------------------------------------

    def begin_source(self, name: str | None, *, sheet: str | None = None, workspace_id: str | None = None,
                     rows_available: int | None = None, derived_from: str | None = None) -> None:
        """Start a source: a sheet of a file, or another concept's records."""
        self._source = {"name": _clip(name, MAX_EXAMPLE_VALUE), "sheet": _clip(sheet, MAX_EXAMPLE_VALUE),
                        "workspaceId": workspace_id, "rowsAvailable": rows_available, "rowsRead": 0,
                        **({"derivedFrom": derived_from} if derived_from else {})}
        self.sources.append(self._source)

    def set_reading(self, counts: dict[str, int], limits: dict[str, int]) -> None:
        """What reading the archive of the current source left out or cut, and the limits it was read with."""
        if self._source is not None and counts:
            self._source["reading"] = {"counts": dict(counts), "limits": dict(limits)}

    def rows_read(self, count: int) -> None:
        if self._source is not None:
            self._source["rowsRead"] += count

    def set_ai(self, limit: int, stats: dict[str, Any], fields: Any = ()) -> None:
        """The AI's share of the reading: rows it read, rows the admin's limit left to the rules, and
        the fields it reads."""
        self.ai = {"limit": int(limit), "rowsRead": int(stats.get("aiRows") or 0),
                   "rowsLimited": int(stats.get("aiSkippedRows") or 0),
                   "rowsFailed": int(stats.get("aiFailedRows") or 0), "fields": sorted(fields)}

    # -- what the readers see -------------------------------------------------------------------

    def _where(self, number: Any = None, record: str | None = None) -> dict[str, Any]:
        source = self._source or {}
        return {key: value for key, value in (
            ("source", source.get("name")), ("sheet", source.get("sheet")), ("workspaceId", source.get("workspaceId")),
            ("row", number), ("record", _clip(record, MAX_EXAMPLE_VALUE))) if value is not None}

    def _example(self, row: dict[str, Any] | Callable[[], dict[str, Any]], number: Any, record: str | None,
                 first: list[str]) -> dict[str, Any]:
        values = row() if callable(row) else row
        shown: dict[str, Any] = {}
        for name in [*first, *(name for name in values if name not in first)]:
            if len(shown) >= MAX_EXAMPLE_FIELDS:
                break
            value = values.get(name)
            if name.startswith("_") or value in (None, ""):
                continue
            shown[name] = _clip(value if isinstance(value, str) else str(value), MAX_EXAMPLE_VALUE)
        return {**self._where(number, record), "values": shown}

    def keyed_row(self, identity: dict[str, str], row: dict[str, Any] | Callable[[], dict[str, Any]], *,
                  number: Any = None, record: str | None = None) -> None:
        """A row whose key could be read: it makes or joins a record."""
        self.keyed += 1
        key = tuple(identity.get(name, "") for name in self.key_fields)
        if key in self.tuples or len(self.tuples) < MAX_TRACKED_KEYS:
            self.tuples[key] += 1
            examples = self.tuple_examples.get(key)
            if examples is None and len(self.tuple_examples) < MAX_EXAMPLE_KEYS:
                examples = self.tuple_examples[key] = []
            if examples is not None and len(examples) < EXAMPLES_PER_KEY:
                examples.append(self._example(row, number, record, self.key_fields))
        else:
            self.overflow += 1
        # Blocks of neighbouring rows spread over the sheet: rows of one record are often adjacent, so
        # collisions of a candidate key show, which scattered single rows would miss.
        index = self.sample_seen
        self.sample_seen += 1
        total = (self._source or {}).get("rowsAvailable")
        step = max(1, total // MAX_SAMPLE_ROWS) if isinstance(total, int) else 1
        if len(self.sample) < MAX_SAMPLE_ROWS and (index // SAMPLE_BLOCK) % step == 0:
            values = row() if callable(row) else row
            self.sample.append({name: _clip(values[name] if isinstance(values[name], str) else str(values[name]),
                                            MAX_SAMPLE_VALUE)
                                for name in (*self.key_fields, *self.fields) if values.get(name) not in (None, "")})

    def missing_row(self, field: str, row: dict[str, Any] | Callable[[], dict[str, Any]], *,
                    number: Any = None, record: str | None = None) -> None:
        """A row left out because a key field is empty."""
        entry = self.missing.setdefault(field, {"rows": 0, "examples": []})
        entry["rows"] += 1
        if len(entry["examples"]) < MAX_EXAMPLES:
            entry["examples"].append(self._example(row, number, record, self.key_fields))

    def ai_limited_row(self, field: str) -> None:
        """A row whose key field the AI would read, left unread by the AI row limit: not a missing value."""
        self.ai_limited[field] += 1

    def conflict(self, field: str, kept: Any, other: Any, identity: dict[str, str], *, number: Any = None,
                 record: str | None = None, rows: int = 1, distinct: int | None = None) -> None:
        """Two source values for one field of one record: ``kept`` stays, ``other`` is thrown away."""
        entry = self.conflicts.setdefault(field, {"rows": 0, "values": [], "distinct": None, "examples": []})
        entry["rows"] += rows
        if distinct is not None:
            entry["distinct"] = max(entry["distinct"] or 0, distinct)
        for value in (kept, other):
            text = _clip(value if isinstance(value, str) else str(value), MAX_EXAMPLE_VALUE)
            if value is not None and text not in entry["values"] and len(entry["values"]) < MAX_CONFLICT_VALUES:
                entry["values"].append(text)
        if len(entry["examples"]) < MAX_EXAMPLES:
            entry["examples"].append({**self._where(number, record), "key": dict(identity),
                                      "values": {"kept": _clip(str(kept), MAX_EXAMPLE_VALUE),
                                                 "other": _clip(str(other), MAX_EXAMPLE_VALUE)}})

    # -- saving and merging ---------------------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        return {"v": SNAPSHOT_VERSION, "conceptId": self.concept_id, "keyFields": self.key_fields,
                "fields": self.fields, "sources": self.sources, "keyed": self.keyed,
                "tuples": [[list(key), count] for key, count in self.tuples.items()], "overflow": self.overflow,
                "tupleExamples": [[list(key), items] for key, items in self.tuple_examples.items()],
                "sample": self.sample, "sampleSeen": self.sample_seen, "missing": self.missing,
                "aiLimited": dict(self.ai_limited), "conflicts": self.conflicts, "ai": self.ai}

    @classmethod
    def restore(cls, data: dict[str, Any]) -> "ConceptHealth | None":
        """A snapshot read back; ``None`` when it is not one of this version."""
        if not isinstance(data, dict) or data.get("v") != SNAPSHOT_VERSION:
            return None
        health = cls(str(data.get("conceptId") or ""), data.get("keyFields"), data.get("fields"))
        health.sources = [dict(item) for item in data.get("sources") or []]
        health.keyed = int(data.get("keyed") or 0)
        health.tuples = Counter({tuple(key): count for key, count in data.get("tuples") or []})
        health.overflow = int(data.get("overflow") or 0)
        health.tuple_examples = {tuple(key): list(items) for key, items in data.get("tupleExamples") or []}
        health.sample = list(data.get("sample") or [])
        health.sample_seen = int(data.get("sampleSeen") or 0)
        health.missing = dict(data.get("missing") or {})
        health.ai_limited = Counter(data.get("aiLimited") or {})
        health.conflicts = dict(data.get("conflicts") or {})
        health.ai = data.get("ai")
        return health

    def absorb(self, other: "ConceptHealth") -> None:
        """Add another reading of the same concept (another sheet, or a reused one)."""
        self.sources.extend(other.sources)
        self.keyed += other.keyed
        for key, count in other.tuples.items():
            if key in self.tuples or len(self.tuples) < MAX_TRACKED_KEYS:
                self.tuples[key] += count
            else:
                self.overflow += count
        self.overflow += other.overflow
        for key, items in other.tuple_examples.items():
            known = self.tuple_examples.get(key)
            if known is None and len(self.tuple_examples) < MAX_EXAMPLE_KEYS:
                known = self.tuple_examples[key] = []
            if known is not None:
                known.extend(items[:max(0, EXAMPLES_PER_KEY - len(known))])
        self.sample_seen += other.sample_seen
        self.sample.extend(other.sample[:max(0, MAX_SAMPLE_ROWS - len(self.sample))])
        for field, entry in other.missing.items():
            mine = self.missing.setdefault(field, {"rows": 0, "examples": []})
            mine["rows"] += entry["rows"]
            mine["examples"].extend(entry["examples"][:max(0, MAX_EXAMPLES - len(mine["examples"]))])
        self.ai_limited.update(other.ai_limited)
        for field, entry in other.conflicts.items():
            mine = self.conflicts.setdefault(field, {"rows": 0, "values": [], "distinct": None, "examples": []})
            mine["rows"] += entry["rows"]
            if entry.get("distinct") is not None:
                mine["distinct"] = max(mine["distinct"] or 0, entry["distinct"])
            mine["values"].extend(value for value in entry["values"] if value not in mine["values"]
                                  and len(mine["values"]) < MAX_CONFLICT_VALUES)
            mine["examples"].extend(entry["examples"][:max(0, MAX_EXAMPLES - len(mine["examples"]))])
        if other.ai:
            if self.ai is None:
                self.ai = dict(other.ai)
            else:
                for name in ("rowsRead", "rowsLimited", "rowsFailed"):
                    self.ai[name] += other.ai.get(name, 0)
                self.ai["fields"] = sorted(set(self.ai.get("fields") or []) | set(other.ai.get("fields") or []))

    # -- the report -----------------------------------------------------------------------------

    def report(self, *, records: int, entities: int | None = None) -> dict[str, Any]:
        """The concept's journey and findings. ``entities`` is the records its rows made (before the
        run's cap), ``records`` those kept."""
        made = records if entities is None else entities
        available = [source["rowsAvailable"] for source in self.sources]
        rows_available = sum(available) if available and all(isinstance(item, int) for item in available) else None
        rows_read = sum(source["rowsRead"] for source in self.sources)
        dropped: list[dict[str, Any]] = []
        findings: list[dict[str, Any]] = []
        ai_fields = set((self.ai or {}).get("fields") or [])
        for field, entry in sorted(self.missing.items()):
            dropped.append({"reason": "missing_identity", "field": field, "rows": entry["rows"]})
            findings.append({"kind": "missing_identity", "field": field, "rows": entry["rows"],
                             "aiRead": field in ai_fields, "examples": entry["examples"][:MAX_EXAMPLES]})
        if self.ai_limited:
            limited = max(self.ai_limited.values())
            dropped.append({"reason": "ai_limit", "rows": limited})
        merged = self.keyed - made
        conflict_rows = sum(entry["rows"] for entry in self.conflicts.values())
        too_coarse = (self.keyed >= MIN_ROWS_TOO_COARSE and made <= self.keyed * TOO_COARSE_RATIO
                      and conflict_rows > 0)
        if merged > 0:
            dropped.append({"reason": "same_key", "rows": merged})
        if made > records:
            dropped.append({"reason": "run_cap", "rows": made - records})
        if too_coarse:
            findings.append(self._coarse_finding(made, conflict_rows))
        for field, entry in sorted(self.conflicts.items()):
            findings.append({"kind": "conflicting_values", "field": field, "rows": entry["rows"],
                             "distinctValues": entry["distinct"] or len(entry["values"]),
                             "values": entry["values"][:MAX_TOP_KEYS], "examples": entry["examples"][:MAX_EXAMPLES]})
        if self.ai is not None:
            findings.append({"kind": "ai_row_limit" if self.ai["rowsLimited"] else "ai_read", **self.ai,
                             "examples": []})
        findings.extend(self._reading_findings())
        return {"conceptId": self.concept_id, "keyFields": self.key_fields,
                "workspaceIds": sorted({source["workspaceId"] for source in self.sources if source.get("workspaceId")}),
                "sources": self.sources, "rowsAvailable": rows_available, "rowsRead": rows_read,
                "rowsKeyed": self.keyed, "recordsMade": records, "dropped": dropped,
                **({"ai": self.ai} if self.ai is not None else {}), "findings": findings}

    def _reading_findings(self) -> list[dict[str, Any]]:
        """One finding per mail table that was read with something left out or cut."""
        counts: dict[str, Counter[str]] = {}
        limits: dict[str, dict[str, int]] = {}
        for source in self.sources:
            reading = source.get("reading")
            if isinstance(reading, dict) and source.get("sheet"):
                counts.setdefault(source["sheet"], Counter()).update(reading.get("counts") or {})
                limits[source["sheet"]] = reading.get("limits") or {}
        return [{"kind": "archive_reading", "sheet": sheet, "total": tally["total"], "counts": dict(tally),
                 "limits": limits[sheet], "examples": []}
                for sheet, tally in sorted(counts.items())
                if any(tally[name] for name in READING_NOTABLE.get(sheet, ()))]

    def _coarse_finding(self, entities: int, conflict_rows: int) -> dict[str, Any]:
        top = self.tuples.most_common(MAX_TOP_KEYS)
        finding: dict[str, Any] = {
            "kind": "identity_too_coarse", "rows": self.keyed, "entities": entities, "keyFields": self.key_fields,
            "discardedValues": conflict_rows,
            "topKeyValues": [{"values": dict(zip(self.key_fields, key)), "rows": count} for key, count in top],
            "keyCardinality": ({name: len({key[index] for key in self.tuples})
                                for index, name in enumerate(self.key_fields)} if not self.overflow else {}),
            "examples": [example for key, _count in top[:1] for example in self.tuple_examples.get(key, [])][:3]}
        suggested = suggest_key(self.sample, self.key_fields, self.keyed)
        if suggested is not None:
            finding["suggestedKey"] = suggested
        return finding
