"""Pure protobuf conversion helpers for playbook-flow gRPC contracts."""

from __future__ import annotations

from typing import Any, Optional

from google.protobuf.json_format import MessageToDict
from google.protobuf.struct_pb2 import Struct, Value


def value_to_python(v: Value) -> Any:
    kind = v.WhichOneof("kind")
    if kind == "null_value":
        return None
    if kind == "number_value":
        return v.number_value
    if kind == "string_value":
        return v.string_value
    if kind == "bool_value":
        return v.bool_value
    if kind == "struct_value":
        return struct_to_dict(v.struct_value)
    if kind == "list_value":
        return [value_to_python(item) for item in v.list_value.values]
    return None


def struct_to_dict(s: Optional[Struct]) -> dict[str, Any]:
    if s is None:
        return {}
    result: dict[str, Any] = {}
    for key, value in s.fields.items():
        result[key] = value_to_python(value)
    return result


def snapshot_to_dict(snapshot: Any) -> dict[str, Any]:
    try:
        raw = MessageToDict(snapshot, preserving_proto_field_name=True, including_default_value_fields=False)
    except TypeError:
        raw = MessageToDict(snapshot, preserving_proto_field_name=True)
    return convert_snapshot(raw, snapshot)


def should_emit_fallback_completion(saw_terminal_event: bool) -> bool:
    return not saw_terminal_event


def convert_snapshot(raw: dict[str, Any], snapshot: Any | None = None) -> dict[str, Any]:
    nodes = raw.get("nodes", [])
    proto_nodes = list(getattr(snapshot, "nodes", [])) if snapshot is not None else []

    for index, node in enumerate(nodes):
        if index >= len(proto_nodes):
            metadata = node.get("metadata")
            if metadata:
                node["metadata"] = unwrap_metadata_fields(dict(metadata))
            continue

        metadata = struct_to_dict(proto_nodes[index].metadata)
        if metadata:
            node["metadata"] = metadata
        else:
            node.pop("metadata", None)
    return raw


def unwrap_metadata_fields(d: Any) -> Any:
    if isinstance(d, dict):
        if "fields" in d and len(d) == 1:
            return unwrap_metadata_fields(d["fields"])
        return {k: unwrap_metadata_fields(v) for k, v in d.items()}
    if isinstance(d, list):
        return [unwrap_metadata_fields(v) for v in d]
    return d
