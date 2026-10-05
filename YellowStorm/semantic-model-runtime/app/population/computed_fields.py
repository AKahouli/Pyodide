"""Fields computed from another value of the same record: a file name, another field or a sheet column.

``JOHNSON_JOHNSON_2023_8K_dated-2023-08-23.pdf`` gives a fiscal year of ``2023`` by splitting on
``_`` and taking the 3rd part from the end, by taking the text between ``dated-`` and ``-``, or by a
pattern with a group. There is no script: a pattern runs on the same engine and time limit as the
reading rules, and every step is bounded.

The same recipe (take it from, cut, keep, value pattern, clean-up) shapes a spreadsheet field: its
input is then a column of the row, or another field of the same row (see ``apply_row_recipes``).

An input can also join several parts into one text (``{"kind": "join", "parts": [...], "separator",
"skipEmpty"}``): each part is an input as above or a fixed text, and the usual steps then shape the
joined text. Every path (documents, sheet rows, another concept's records) resolves the input with
``resolve_input`` so a join works the same everywhere.
"""

from __future__ import annotations

import re
from typing import Any

from .document_rules import (MAX_PATTERN_CHARS, RuleError, compile_pattern, match_pattern, normalize_take,
                             take_part, to_iso_date, without_spaces)

COMPUTED_VERSION = "computed-v1"
FILE_INPUTS = ("document_name",)
# "whole" keeps the input as it is, for a recipe that only keeps a part, matches a shape or cleans up.
METHODS = ("whole", "split", "between", "regex")
INPUT_KINDS = ("file", "field", "column")
JOIN = "join"
MAX_INPUT_NAME_CHARS = 200
# A joined input: a few parts, each read from the record or a short fixed text.
MAX_JOIN_PARTS = 10
MAX_JOIN_TEXT_CHARS = 100
MAX_SEPARATOR_CHARS = 10
TRANSFORMS = ("none", "trim", "no_spaces", "upper", "lower", "date_iso", "year", "number")
MAX_DELIMITER_CHARS = 10
MAX_MARKER_CHARS = 50
MAX_TEMPLATE_CHARS = 100
MAX_PART = 20
MAX_INPUT_CHARS = 1000
MAX_VALUE_CHARS = 500
MAX_PREVIEW_SAMPLES = 20

_EXTENSION = re.compile(r"\.[A-Za-z0-9]{1,8}$")
_PLACEHOLDER = re.compile(r"\{(\w+)\}")
_YEAR = re.compile(r"(?<!\d)(1[89]\d{2}|2\d{3})(?!\d)")
_NUMBER = re.compile(r"-?\d+(?:[.,]\d+)?")


def _text(raw: dict[str, Any], key: str, limit: int, *, required: bool = False) -> str | None:
    value = raw.get(key)
    if value is None or value == "":
        if required:
            raise RuleError(f"{key} is required")
        return None
    if not isinstance(value, str) or len(value) > limit:
        raise RuleError(f"{key} must be a text of at most {limit} characters")
    return value


def _normalize_single(source: Any) -> dict[str, str]:
    if not isinstance(source, dict) or source.get("kind") not in INPUT_KINDS:
        raise RuleError("input must name the file, a field or a column")
    name = source.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > MAX_INPUT_NAME_CHARS:
        raise RuleError("input must name the file, a field or a column")
    if source["kind"] == "file" and name not in FILE_INPUTS:
        raise RuleError("unknown file property")
    # A column keeps its exact name (headers may carry spaces); a field or the file is trimmed.
    return {"kind": source["kind"], "name": name if source["kind"] == "column" else name.strip()}


def _normalize_input(source: Any) -> dict[str, Any]:
    if not isinstance(source, dict) or source.get("kind") != JOIN:
        return _normalize_single(source)
    parts = source.get("parts")
    if not isinstance(parts, list) or not 2 <= len(parts) <= MAX_JOIN_PARTS:
        raise RuleError(f"a join needs 2 to {MAX_JOIN_PARTS} parts")
    normalized: list[dict[str, str]] = []
    for part in parts:
        if isinstance(part, dict) and part.get("kind") == "text":
            value = part.get("value")
            if not isinstance(value, str) or not value or len(value) > MAX_JOIN_TEXT_CHARS:
                raise RuleError(f"a fixed text part needs 1 to {MAX_JOIN_TEXT_CHARS} characters")
            normalized.append({"kind": "text", "value": value})
        else:
            normalized.append(_normalize_single(part))
    if all(part["kind"] == "text" for part in normalized):
        raise RuleError("a join needs at least one part read from the record")
    separator = source.get("separator", " ")
    if separator is None:
        separator = ""
    if not isinstance(separator, str) or len(separator) > MAX_SEPARATOR_CHARS:
        raise RuleError(f"the separator must be a text of at most {MAX_SEPARATOR_CHARS} characters")
    skip_empty = source.get("skipEmpty", True)
    if not isinstance(skip_empty, bool):
        raise RuleError("skipEmpty must be true or false")
    return {"kind": JOIN, "parts": normalized, "separator": separator, "skipEmpty": skip_empty}


def input_refs(spec: dict[str, Any]) -> list[dict[str, str]]:
    """What a recipe reads from the record: its input, or each part of a join that is not a fixed text."""
    source = spec["input"]
    if source["kind"] != JOIN:
        return [source]
    return [part for part in source["parts"] if part["kind"] != "text"]


def reads_field(spec: dict[str, Any]) -> bool:
    """Whether a recipe reads another field (so no other recipe may read it: no chains)."""
    return any(ref["kind"] == "field" for ref in input_refs(spec))


def normalize_computed(raw: Any) -> dict[str, Any]:
    """The computation in one shape, or ``RuleError`` when it cannot be used."""
    if not isinstance(raw, dict):
        raise RuleError("computed must be an object")
    source = _normalize_input(raw.get("input"))
    method = raw.get("method")
    if method not in METHODS:
        raise RuleError("unknown method")
    transform = raw.get("transform") or "none"
    if transform not in TRANSFORMS:
        raise RuleError("unknown transform")
    reads_file = any(ref["kind"] == "file" for ref in input_refs({"input": source}))
    strip_extension = raw.get("stripExtension", reads_file)
    if not isinstance(strip_extension, bool):
        raise RuleError("stripExtension must be true or false")
    spec: dict[str, Any] = {"input": source, "method": method, "transform": transform,
                            "stripExtension": strip_extension}
    if method == "whole":
        pass
    elif method == "split":
        spec["delimiter"] = _text(raw, "delimiter", MAX_DELIMITER_CHARS, required=True)
        part = raw.get("part")
        if not isinstance(part, int) or isinstance(part, bool) or part == 0 or abs(part) > MAX_PART:
            raise RuleError(f"part must be a position from 1 to {MAX_PART}, or -1 to -{MAX_PART} from the end")
        spec["part"] = part
    elif method == "between":
        spec["after"] = _text(raw, "after", MAX_MARKER_CHARS)
        spec["before"] = _text(raw, "before", MAX_MARKER_CHARS)
        if spec["after"] is None and spec["before"] is None:
            raise RuleError("between needs the text before or after the value")
    else:
        pattern = _text(raw, "pattern", MAX_PATTERN_CHARS, required=True)
        compiled = compile_pattern(pattern)
        if compiled.groups == 0:
            raise RuleError("the pattern needs a group, in parentheses, around the value")
        spec["pattern"] = pattern
        template = _text(raw, "template", MAX_TEMPLATE_CHARS)
        if template is not None:
            for placeholder in _PLACEHOLDER.findall(template):
                if not (placeholder.isdigit() and 0 < int(placeholder) <= compiled.groups
                        or placeholder in compiled.groupindex):
                    raise RuleError(f"the template names an unknown group: {placeholder}")
        spec["template"] = template
    # After the cut, the same shaping as the reading rules: a part to keep, then a shape to match.
    if raw.get("take") is not None:
        spec["take"] = normalize_take(raw["take"])
    value_pattern = _text(raw, "valuePattern", MAX_PATTERN_CHARS)
    if value_pattern is not None and value_pattern.strip():
        compile_pattern(value_pattern)
        spec["valuePattern"] = value_pattern
    return spec


def _transform(value: str, transform: str) -> str | None:
    if transform == "trim":
        return value.strip(" \t-_.,;") or None
    if transform == "no_spaces":
        return without_spaces(value) or None
    if transform == "upper":
        return value.upper()
    if transform == "lower":
        return value.lower()
    if transform == "date_iso":
        return to_iso_date(value) or None
    if transform == "year":
        found = _YEAR.search(value)
        return found.group(1) if found else None
    if transform == "number":
        found = _NUMBER.search(value)
        return found.group(0).replace(",", ".") if found else None
    return value


def compute(spec: dict[str, Any], value: Any,
            trace: list[dict[str, Any]] | None = None) -> tuple[str | None, str]:
    """The computed value and why: ``found``, ``no_input``, ``no_match`` or ``not_transformable``.

    With ``trace``, each step that ran appends ``{"step", "value"}`` (``cut``, ``keep``, ``pattern``,
    ``transform``); the value is None at the step where the recipe stopped.
    """
    if value is None or (isinstance(value, str) and not value.strip()):
        return None, "no_input"

    def step(name: str, result: str | None) -> None:
        if trace is not None:
            trace.append({"step": name, "value": result[:MAX_VALUE_CHARS] if result else None})

    text = str(value)[:MAX_INPUT_CHARS]
    # A join strips the extension of its file part only (see ``resolve_input``).
    if spec.get("stripExtension") and spec["input"]["kind"] != JOIN:
        text = _EXTENSION.sub("", text)
    result: str | None
    if spec["method"] == "whole":
        result = text
    elif spec["method"] == "split":
        parts = text.split(spec["delimiter"])
        part = spec["part"]
        index = part - 1 if part > 0 else len(parts) + part
        result = parts[index] if 0 <= index < len(parts) else None
    elif spec["method"] == "between":
        start = 0
        if spec.get("after"):
            found = text.find(spec["after"])
            if found < 0:
                step("cut", None)
                return None, "no_match"
            start = found + len(spec["after"])
        end = len(text)
        if spec.get("before"):
            found = text.find(spec["before"], start)
            if found < 0:
                step("cut", None)
                return None, "no_match"
            end = found
        result = text[start:end]
    else:
        try:
            match = compile_pattern(spec["pattern"]).search(text, timeout=0.05)
        except TimeoutError:
            match = None
        if match is None:
            step("cut", None)
            return None, "no_match"
        if spec.get("template"):
            def group(found: re.Match[str]) -> str:
                key = found.group(1)
                return match.group(int(key) if key.isdigit() else key) or ""
            result = _PLACEHOLDER.sub(group, spec["template"])
        else:
            named = [name for name, captured in match.groupdict().items() if captured]
            result = match.group(named[0]) if named else next((g for g in match.groups() if g), None)
    if result is None or not result.strip():
        if spec["method"] != "whole":
            step("cut", None)
        return None, "no_match"
    result = result.strip()
    if spec["method"] != "whole":
        step("cut", result)
    if spec.get("take"):
        result = take_part(result, spec["take"]).strip()
        step("keep", result)
    if spec.get("valuePattern"):
        result = match_pattern(compile_pattern(spec["valuePattern"]), result) or ""
        step("pattern", result)
    if not result:
        return None, "no_match"
    transformed = _transform(result, spec["transform"])
    if spec["transform"] != "none":
        step("transform", transformed)
    if transformed is None:
        return None, "not_transformable"
    return transformed[:MAX_VALUE_CHARS], "found"


def resolve_input(spec: dict[str, Any], lookup: Any, trace: list[dict[str, Any]] | None = None) -> Any:
    """The text a recipe shapes: ``lookup(kind, name)`` for a single input, or its parts joined.

    A joined part read from the record is trimmed; a fixed text is kept as it is. With ``skipEmpty`` an
    empty part is left out with its separator, so no separator is doubled; when every part read from the
    record is empty there is no input. ``trace`` gets a ``join`` step with the joined text.
    """
    source = spec["input"]
    if source["kind"] != JOIN:
        return lookup(source["kind"], source["name"])
    pieces: list[str] = []
    found = False
    for part in source["parts"]:
        if part["kind"] == "text":
            pieces.append(part["value"])
            continue
        raw = lookup(part["kind"], part["name"])
        text = "" if raw is None else str(raw)[:MAX_INPUT_CHARS].strip()
        if text and part["kind"] == "file" and spec.get("stripExtension"):
            text = _EXTENSION.sub("", text)
        if text:
            found = True
        elif source["skipEmpty"]:
            continue
        pieces.append(text)
    if not found:
        if trace is not None:
            trace.append({"step": "join", "value": None})
        return None
    joined = source["separator"].join(pieces)[:MAX_INPUT_CHARS]
    if trace is not None:
        trace.append({"step": "join", "value": joined[:MAX_VALUE_CHARS]})
    return joined


def compute_from(spec: dict[str, Any], lookup: Any,
                 trace: list[dict[str, Any]] | None = None) -> tuple[str | None, str, Any]:
    """``compute`` on the recipe's input resolved by ``lookup``: the value, why, and the input read."""
    raw = resolve_input(spec, lookup, trace)
    value, reason = compute(spec, raw, trace)
    return value, reason, raw


def recipe_sources(spec: dict[str, Any]) -> list[str]:
    """The names a recipe reads (columns, fields, the file), in order and once each, for its evidence."""
    return list(dict.fromkeys(ref["name"] for ref in input_refs(spec)))


def check_inputs(mappings: list[dict[str, Any]]) -> None:
    """A computed field reads the file or a field that is read or fixed, never another computed one."""
    plain = {item["targetAttribute"] for item in mappings if item.get("mode") != "computed"}
    for item in mappings:
        if item.get("mode") != "computed":
            continue
        for source in input_refs(item["computed"]):
            if source["kind"] == "column":
                raise RuleError(f"{item['targetAttribute']}: a document has no columns")
            if source["kind"] == "field" and (source["name"] not in plain or source["name"] == item["targetAttribute"]):
                raise RuleError(f"{item['targetAttribute']} is computed from a field that is not read from the document")


def apply_computed(mappings: list[dict[str, Any]], values: dict[str, Any],
                   file_values: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Fill ``values`` with every computed field and say for each one how it went."""
    outcomes: dict[str, dict[str, Any]] = {}
    for item in mappings:
        if item.get("mode") != "computed":
            continue
        value, reason, raw = compute_from(
            item["computed"], lambda kind, name: file_values.get(name) if kind == "file" else values.get(name))
        if value is not None:
            values[item["targetAttribute"]] = value
        outcomes[item["targetAttribute"]] = {"method": "computed", "reason": reason,
                                             "input": None if raw is None else str(raw)[:200]}
    return outcomes


# Spreadsheet rows: the same recipe on a column of the row, or on another field of the same row.

MAX_ROW_RECIPES = 50


def normalize_row_recipes(raw: Any, mapped: set[str]) -> dict[str, dict[str, Any]]:
    """The recipes of a sheet mapping by field, or ``RuleError``.

    A field input reads another mapped field of the row: read from a column, out of a cell, fixed, or
    itself taken from other fields (applied first), as long as no field ends up reading itself. A
    column input reads any column of the sheet.
    """
    if raw is None:
        return {}
    if not isinstance(raw, dict) or len(raw) > MAX_ROW_RECIPES:
        raise RuleError("fieldRecipes must map fields to recipes")
    recipes: dict[str, dict[str, Any]] = {}
    for attribute, recipe in raw.items():
        if not isinstance(attribute, str) or attribute not in mapped:
            raise RuleError(f"{attribute}: a recipe needs a mapped field")
        spec = normalize_computed(recipe)
        if any(ref["kind"] == "file" for ref in input_refs(spec)):
            raise RuleError(f"{attribute}: a sheet row has no file name")
        recipes[attribute] = spec
    for attribute, spec in recipes.items():
        for source in input_refs(spec):
            if source["kind"] == "field" and (source["name"] == attribute or source["name"] not in mapped):
                raise RuleError(f"{attribute} is taken from a field that is not mapped")
    recipe_order(recipes)
    return recipes


def recipe_order(recipes: dict[str, dict[str, Any]]) -> list[str]:
    """The recipes in the order they run: a field after every recipe field it reads. ``RuleError`` on a
    loop (a field that ends up reading itself)."""
    order: list[str] = []
    state: dict[str, str] = {}

    def visit(attribute: str, path: tuple[str, ...]) -> None:
        if state.get(attribute) == "done":
            return
        if state.get(attribute) == "visiting":
            loop = " → ".join((*path[path.index(attribute):], attribute))
            raise RuleError(f"these fields read each other in a loop: {loop}")
        state[attribute] = "visiting"
        for ref in input_refs(recipes[attribute]):
            if ref["kind"] == "field" and ref["name"] in recipes:
                visit(ref["name"], (*path, attribute))
        state[attribute] = "done"
        order.append(attribute)

    for attribute in recipes:
        visit(attribute, ())
    return order


def recipe_columns(recipes: dict[str, dict[str, Any]]) -> set[str]:
    """The columns the recipes read, to query with the mapped ones."""
    return {ref["name"] for spec in recipes.values() for ref in input_refs(spec) if ref["kind"] == "column"}


def apply_row_recipes(recipes: dict[str, dict[str, Any]], values: dict[str, Any],
                      raw_row: dict[str, Any], column: Any = None) -> dict[str, dict[str, Any]]:
    """Shape the mapped ``values`` of one row in place and say for each recipe how it went.

    A recipe runs after the recipe fields it reads, alone or joined (so it sees their shaped value). A recipe
    that finds nothing leaves its field empty (``None``), as a computed document field does, so an
    identity field without a value is reported as a missing identity rather than read raw.
    ``column`` resolves a column name against the row (a renamed column); identity by default.
    """
    resolve = column or (lambda name: name)
    outcomes: dict[str, dict[str, Any]] = {}
    for attribute in recipe_order(recipes):
        spec = recipes[attribute]
        value, reason, raw = compute_from(
            spec, lambda kind, name: raw_row.get(resolve(name)) if kind == "column" else values.get(name))
        values[attribute] = value
        outcomes[attribute] = {"method": "recipe", "reason": reason,
                               "input": None if raw is None else str(raw)[:200]}
    return outcomes
