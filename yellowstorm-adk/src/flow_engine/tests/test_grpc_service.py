import sys

import pytest

from src.flow_engine.grpc_service import _unwrap_metadata_fields


# ---------------------------------------------------------------------------
# _unwrap_metadata_fields tests — pure dict-based, no protobuf required
# ---------------------------------------------------------------------------

class TestUnwrapMetadataFields:
    def test_flat_dict_passes_through(self):
        d = {"assignedAgentId": "abc", "custom_key": "value"}
        assert _unwrap_metadata_fields(d) == d

    def test_wrapped_fields_unwrapped(self):
        d = {"fields": {"assignedAgentId": "abc"}}
        assert _unwrap_metadata_fields(d) == {"assignedAgentId": "abc"}

    def test_nested_agent_fields_unwrapped(self):
        d = {"fields": {"assignedAgentId": "abc", "agent": {"fields": {"model": "gpt-5.4-mini", "prompt": "Do the thing"}}}}
        expected = {"assignedAgentId": "abc", "agent": {"model": "gpt-5.4-mini", "prompt": "Do the thing"}}
        assert _unwrap_metadata_fields(d) == expected

    def test_agent_without_fields_passes_through(self):
        d = {"fields": {"agent": {"model": "direct", "prompt": "sys"}}}
        expected = {"agent": {"model": "direct", "prompt": "sys"}}
        assert _unwrap_metadata_fields(d) == expected

    def test_arbitrary_nested_object_unwrapped(self):
        """Any nested Struct in metadata (not just 'agent') must be unwrapped."""
        d = {"fields": {"label": "my node", "toolConfig": {"fields": {"timeout": 30}}}}
        expected = {"label": "my node", "toolConfig": {"timeout": 30}}
        assert _unwrap_metadata_fields(d) == expected

    def test_no_fields_key_passes_through(self):
        d = {"agent": {"model": "gpt-4"}, "label": "test"}
        assert _unwrap_metadata_fields(d) == d

    def test_empty_dict(self):
        assert _unwrap_metadata_fields({}) == {}

    def test_fields_only_unwrapped(self):
        d = {"fields": {}}
        assert _unwrap_metadata_fields(d) == {}


# ---------------------------------------------------------------------------
# _value_to_python / _struct_to_dict tests — require protobuf
# ---------------------------------------------------------------------------

struct_pb2 = pytest.importorskip("google.protobuf.struct_pb2", reason="protobuf not available")

from src.flow_engine.grpc_service import _struct_to_dict, _value_to_python  # noqa: E402


class TestValueToPython:
    def test_null_value(self):
        v = struct_pb2.Value(null_value=0)
        assert _value_to_python(v) is None

    def test_number_value(self):
        v = struct_pb2.Value(number_value=3.14)
        assert _value_to_python(v) == 3.14

    def test_string_value(self):
        v = struct_pb2.Value(string_value="hello")
        assert _value_to_python(v) == "hello"

    def test_bool_value_true(self):
        v = struct_pb2.Value(bool_value=True)
        assert _value_to_python(v) is True

    def test_bool_value_false(self):
        v = struct_pb2.Value(bool_value=False)
        assert _value_to_python(v) is False

    def test_list_value(self):
        v = struct_pb2.Value()
        v.list_value.values.add().string_value = "a"
        v.list_value.values.add().number_value = 1
        assert _value_to_python(v) == ["a", 1]

    def test_struct_value(self):
        inner = struct_pb2.Struct()
        inner.fields["x"].number_value = 10
        inner.fields["y"].string_value = "hi"

        v = struct_pb2.Value()
        v.struct_value.CopyFrom(inner)
        assert _value_to_python(v) == {"x": 10, "y": "hi"}


class TestStructToDict:
    def test_none_input(self):
        assert _struct_to_dict(None) == {}

    def test_empty_struct(self):
        s = struct_pb2.Struct()
        assert _struct_to_dict(s) == {}

    def test_flat_struct(self):
        s = struct_pb2.Struct()
        s.fields["a"].string_value = "x"
        s.fields["b"].number_value = 42
        s.fields["c"].bool_value = True
        assert _struct_to_dict(s) == {"a": "x", "b": 42, "c": True}

    def test_nested_struct(self):
        inner = struct_pb2.Struct()
        inner.fields["key"].string_value = "val"
        outer = struct_pb2.Struct()
        outer.fields["nested"].struct_value.CopyFrom(inner)
        assert _struct_to_dict(outer) == {"nested": {"key": "val"}}

    def test_preserves_user_fields_key(self):
        inner = struct_pb2.Struct()
        inner.fields["x"].number_value = 1
        outer = struct_pb2.Struct()
        outer.fields["fields"].struct_value.CopyFrom(inner)
        result = _struct_to_dict(outer)
        assert result == {"fields": {"x": 1}}
