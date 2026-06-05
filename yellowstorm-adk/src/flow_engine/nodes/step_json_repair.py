from __future__ import annotations

import re
from typing import Any


def recover_structured_response(
    response_text: str,
    candidates: list[dict[str, Any]],
) -> dict[str, Any] | None:
    text = response_text.strip()

    display_text = _extract_field_value_by_boundary(text, "display_text")
    if display_text is None:
        display_text = _extract_field_value_by_boundary(text, "displayText")
    if not display_text:
        return None

    output_ports = [_normalize_output_port(c) for c in candidates if _is_output_port(c)]
    if not output_ports:
        return None

    trace_entries = [c for c in candidates if _is_trace_entry(c)]

    result: dict[str, Any] = {
        "display_text": display_text,
        "outputs": output_ports,
    }
    if trace_entries:
        result["reasoning_trace"] = trace_entries
    return result


def _extract_field_value_by_boundary(text: str, field_name: str) -> str | None:
    match = re.search(rf'"{re.escape(field_name)}"\s*:\s*"', text)
    if not match:
        return None

    value_start = match.end()
    remaining = text[value_start:]

    boundary = re.search(
        r'",\s*"(?:outputs|reasoning_trace|ports|reasoningTrace)"\s*:' r'|"\s*}',
        remaining,
    )
    if not boundary:
        return None

    raw_value = remaining[: boundary.start()]
    return _decode_json_string_permissive(raw_value)


def _decode_json_string_permissive(raw: str) -> str:
    result: list[str] = []
    i = 0
    while i < len(raw):
        if raw[i] == "\\" and i + 1 < len(raw):
            nxt = raw[i + 1]
            if nxt == "n":
                result.append("\n")
            elif nxt == "t":
                result.append("\t")
            elif nxt == "r":
                result.append("\r")
            elif nxt == "\\":
                result.append("\\")
            elif nxt == '"':
                result.append('"')
            elif nxt == "/":
                result.append("/")
            elif nxt == "u" and i + 5 < len(raw):
                hex_str = raw[i + 2 : i + 6]
                try:
                    result.append(chr(int(hex_str, 16)))
                    i += 6
                    continue
                except ValueError:
                    result.append(raw[i])
            else:
                result.append(raw[i])
            i += 2
        else:
            result.append(raw[i])
            i += 1
    return "".join(result)


def _is_output_port(candidate: dict[str, Any]) -> bool:
    port_id_keys = ("output_port_id", "outputPortId", "port_id", "portId")
    return any(str(candidate.get(k) or "").strip() for k in port_id_keys)


def _is_trace_entry(candidate: dict[str, Any]) -> bool:
    required = ("id", "type", "label", "description")
    return all(str(candidate.get(k) or "").strip() for k in required)


def _normalize_output_port(candidate: dict[str, Any]) -> dict[str, Any]:
    entry = dict(candidate)
    if "content" not in entry and "value" in entry:
        entry["content"] = entry.get("value")
    return entry
