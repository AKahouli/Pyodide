"""Fields computed from another value of the same document: its file name or another mapped field.

``JOHNSON_JOHNSON_2023_8K_dated-2023-08-23.pdf`` gives a fiscal year of ``2023`` by splitting on
``_`` and taking the 3rd part from the end, by taking the text between ``dated-`` and ``-``, or by a
pattern with a group. There is no script: a pattern runs on the same engine and time limit as the
reading rules, and every step is bounded.
"""

from __future__ import annotations

import re
from typing import Any

from .document_rules import MAX_PATTERN_CHARS, RuleError, compile_pattern, to_iso_date

COMPUTED_VERSION = "computed-v1"
FILE_INPUTS = ("document_name",)
METHODS = ("split", "between", "regex")
TRANSFORMS = ("none", "trim", "upper", "lower", "date_iso", "year", "number")
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


def normalize_computed(raw: Any) -> dict[str, Any]:
    """The computation in one shape, or ``RuleError`` when it cannot be used."""
    if not isinstance(raw, dict):
        raise RuleError("computed must be an object")
    source = raw.get("input")
    if not isinstance(source, dict) or source.get("kind") not in ("file", "field"):
        raise RuleError("input must name the file or a field")
    name = source.get("name")
    if not isinstance(name, str) or not name.strip():
        raise RuleError("input must name the file or a field")
    if source["kind"] == "file" and name not in FILE_INPUTS:
        raise RuleError("unknown file property")
    method = raw.get("method")
    if method not in METHODS:
        raise RuleError("unknown method")
    transform = raw.get("transform") or "none"
    if transform not in TRANSFORMS:
        raise RuleError("unknown transform")
    strip_extension = raw.get("stripExtension", source["kind"] == "file")
    if not isinstance(strip_extension, bool):
        raise RuleError("stripExtension must be true or false")
    spec: dict[str, Any] = {"input": {"kind": source["kind"], "name": name.strip()}, "method": method,
                            "transform": transform, "stripExtension": strip_extension}
    if method == "split":
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
    return spec


def _transform(value: str, transform: str) -> str | None:
    if transform == "trim":
        return value.strip(" \t-_.,;") or None
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


def compute(spec: dict[str, Any], value: Any) -> tuple[str | None, str]:
    """The computed value and why: ``found``, ``no_input``, ``no_match`` or ``not_transformable``."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None, "no_input"
    text = str(value)[:MAX_INPUT_CHARS]
    if spec.get("stripExtension"):
        text = _EXTENSION.sub("", text)
    result: str | None
    if spec["method"] == "split":
        parts = text.split(spec["delimiter"])
        part = spec["part"]
        index = part - 1 if part > 0 else len(parts) + part
        result = parts[index] if 0 <= index < len(parts) else None
    elif spec["method"] == "between":
        start = 0
        if spec.get("after"):
            found = text.find(spec["after"])
            if found < 0:
                return None, "no_match"
            start = found + len(spec["after"])
        end = len(text)
        if spec.get("before"):
            found = text.find(spec["before"], start)
            if found < 0:
                return None, "no_match"
            end = found
        result = text[start:end]
    else:
        try:
            match = compile_pattern(spec["pattern"]).search(text, timeout=0.05)
        except TimeoutError:
            match = None
        if match is None:
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
        return None, "no_match"
    transformed = _transform(result.strip(), spec["transform"])
    if transformed is None:
        return None, "not_transformable"
    return transformed[:MAX_VALUE_CHARS], "found"


def check_inputs(mappings: list[dict[str, Any]]) -> None:
    """A computed field reads the file or a field that is read or fixed, never another computed one."""
    plain = {item["targetAttribute"] for item in mappings if item.get("mode") != "computed"}
    for item in mappings:
        if item.get("mode") != "computed":
            continue
        source = item["computed"]["input"]
        if source["kind"] == "field" and (source["name"] not in plain or source["name"] == item["targetAttribute"]):
            raise RuleError(f"{item['targetAttribute']} is computed from a field that is not read from the document")


def apply_computed(mappings: list[dict[str, Any]], values: dict[str, Any],
                   file_values: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Fill ``values`` with every computed field and say for each one how it went."""
    outcomes: dict[str, dict[str, Any]] = {}
    for item in mappings:
        if item.get("mode") != "computed":
            continue
        spec = item["computed"]
        source = spec["input"]
        raw = file_values.get(source["name"]) if source["kind"] == "file" else values.get(source["name"])
        value, reason = compute(spec, raw)
        if value is not None:
            values[item["targetAttribute"]] = value
        outcomes[item["targetAttribute"]] = {"method": "computed", "reason": reason,
                                             "input": None if raw is None else str(raw)[:200]}
    return outcomes
