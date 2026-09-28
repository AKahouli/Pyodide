"""Tool schema parity between the evaluation runner and the chat UI.

MCP servers built with Pydantic expose optional parameters as ``anyOf`` unions
without a top-level ``type``. The evaluation runner used to drop those branches
and send untyped parameters to the model, which then called the connector with
empty arguments. These tests pin the schema shape sent to the model.
"""

import json

from langchain_core.tools import StructuredTool

from src.flow_engine.agent_runtime.model import _tool_parameters_schema
from src.flow_engine.tools.langchain_factory import (
    _build_args_schema_for_connector_tool,
    _connector_parameters_schema,
)

PYDANTIC_UNION_SCHEMA = {
    "type": "object",
    "properties": {
        "query": {
            "default": None,
            "title": "Query",
            "anyOf": [{"type": "string"}, {"type": "null"}],
        },
        "file_name": {
            "default": None,
            "title": "File Name",
            "anyOf": [
                {"type": "string"},
                {"type": "array", "items": {"type": "string"}},
                {"type": "null"},
            ],
        },
    },
}


async def _noop(**kwargs):
    return ""


def test_optional_union_property_is_typed_not_untyped() -> None:
    schema = _build_args_schema_for_connector_tool(
        "searchrayentest_search", PYDANTIC_UNION_SCHEMA
    ).model_json_schema()

    assert {"type": "string"} in schema["properties"]["query"]["anyOf"]
    assert {} not in schema["properties"]["query"]["anyOf"]
    # ``file_name`` accepts a string or a list; both branches must survive.
    file_name_branches = schema["properties"]["file_name"]["anyOf"]
    assert any(branch.get("type") == "string" for branch in file_name_branches)
    assert any(branch.get("type") == "array" for branch in file_name_branches)


def test_model_definition_matches_ui_parameters_schema() -> None:
    params = _connector_parameters_schema(
        "searchrayentest_search", "desc", PYDANTIC_UNION_SCHEMA
    )
    assert params["properties"]["query"] == {"type": "string"}

    tool = StructuredTool(
        name="searchrayentest_search",
        description="desc",
        func=None,
        coroutine=_noop,
        args_schema=_build_args_schema_for_connector_tool(
            "searchrayentest_search", PYDANTIC_UNION_SCHEMA
        ),
        metadata={"parameters_schema": params},
    )

    assert _tool_parameters_schema(tool) == params
    assert json.dumps(_tool_parameters_schema(tool)) == json.dumps(params)


def test_array_argument_sent_as_json_string_is_coerced() -> None:
    """GLM 5.2 serializes ``citations`` as a JSON string; it must reach the
    connector as a real list instead of failing with 'Input should be a valid
    list'."""
    schema = _build_args_schema_for_connector_tool(
        "searchrayentest_locate_answer_citations",
        {
            "type": "object",
            "properties": {
                "citations": {
                    "anyOf": [
                        {"type": "array", "items": {"type": "object"}},
                        {"type": "null"},
                    ],
                    "default": None,
                }
            },
        },
    )

    validated = schema.model_validate(
        {"citations": json.dumps([{"block_id": "204430", "reference": 1}])}
    )

    assert validated.citations == [{"block_id": "204430", "reference": 1}]

