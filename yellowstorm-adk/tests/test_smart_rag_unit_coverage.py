"""Unit tests for smart_rag modules with low or no dedicated coverage."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from src.schema.chatbot_schema import AgentSuggestion
from src.schema.playbook import RunPlaybookStepRequest


def _playbook_step(task: str, agent_name: str = "search_agent") -> RunPlaybookStepRequest:
    agent = AgentSuggestion(name=agent_name, description="d", prompt="p")
    return RunPlaybookStepRequest(
        messageId="msg-1",
        userId="user-1",
        taskId="task-1",
        taskDescription=task,
        order=1,
        agent=agent,
        manager_agent=agent,
        call_id="call-1",
        vectorstore_name="vs",
    )


class TestSmartRagPackage:
    def test_lazy_import_chat_rag_service(self):
        import src.smart_rag as smart_rag

        assert smart_rag.ChatRAGService is not None

    def test_lazy_import_agent_team_service(self):
        import src.smart_rag as smart_rag

        assert smart_rag.AgentTeamService is not None

    def test_lazy_import_unknown_raises(self):
        import src.smart_rag as smart_rag

        with pytest.raises(AttributeError):
            _ = smart_rag.NotARealExport


class TestPlanGenerator:
    @pytest.mark.asyncio
    async def test_generate_execution_plan_success(self):
        from src.smart_rag.tools.utilities.plan_generator import generate_execution_plan

        steps = json.dumps([{"task": "Search", "agent": "search_agent"}])
        result = json.loads(await generate_execution_plan("My Plan", steps))
        assert result["title"] == "My Plan"
        assert result["steps"][0]["status"] == "pending"

    @pytest.mark.asyncio
    async def test_generate_execution_plan_invalid_steps(self):
        from src.smart_rag.tools.utilities.plan_generator import generate_execution_plan

        result = json.loads(await generate_execution_plan("Bad", "not-json"))
        assert "error" in result


class TestPlaybookHelpers:
    def test_construct_workplan_lists_steps(self):
        from src.smart_rag.playbook_dir.playbook_helpers import construct_workplan

        steps = [_playbook_step("Find revenue"), _playbook_step("Summarize", "writer")]
        workplan = construct_workplan(steps)
        assert "Step 1: Find revenue" in workplan
        assert "search_agent" in workplan

    def test_construct_manager_prompt_single_section(self):
        from src.smart_rag.playbook_dir.playbook_helpers import construct_manager_prompt

        modified, agent_prompt = construct_manager_prompt(
            "base prompt",
            "workplan body",
            "manager mono",
        )
        assert "PLAYBOOK_EXECUTION_MODE" in modified
        assert "workplan body" in modified
        assert "manager mono" in agent_prompt

    def test_construct_manager_prompt_penultimate_section(self):
        from src.smart_rag.playbook_dir.playbook_helpers import construct_manager_prompt

        modified, _ = construct_manager_prompt(
            "first###second###third",
            "steps here",
            "mono",
        )
        assert "steps here" in modified
        assert "third" in modified


class TestToolUtils:
    def test_normalize_tools_lowercases_names(self):
        from src.smart_rag.tools.utilities.tool_utils import (
            extract_tool_names,
            extract_tool_names_and_descriptions,
            normalize_tools,
        )

        tools = ["Search", {"name": "Calculator", "description": "math"}]

        def sample_tool():
            return None

        normalized = normalize_tools(tools + [sample_tool])
        assert normalized[0] == "search"
        assert normalized[1]["name"] == "calculator"

        names = extract_tool_names(tools + [sample_tool])
        assert names == ["search", "calculator", "sample_tool"]

        descriptions = extract_tool_names_and_descriptions(tools)
        assert "Calculator: math" in descriptions


class TestFormvizTools:
    @pytest.mark.asyncio
    async def test_generate_form_viz_builds_mcp_response(self):
        from src.smart_rag.tools.utilities.formviz_tools import generate_form_viz

        response = await generate_form_viz("Pick one", ["A", "B"])
        assert response["isError"] is False
        assert response["content"][0]["type"] == "resource"
        assert "Pick one" in response["content"][0]["resource"]["text"]


class TestSuggestionsHelper:
    def test_model_supports_structured_output(self):
        from src.smart_rag.agents.generators.suggestions_helper import (
            model_supports_structured_output,
            parse_suggestions_response,
        )

        assert model_supports_structured_output("gpt-4o") is True
        assert model_supports_structured_output("gpt-5-chat") is False
        assert model_supports_structured_output("") is False

        response = SimpleNamespace(text='{"suggestions": [{"text": "hi"}]}')
        parsed = parse_suggestions_response(response)
        assert parsed["suggestions"][0]["text"] == "hi"

        invalid = SimpleNamespace(text="[]")
        assert parse_suggestions_response(invalid) == []


class TestDiagramReferenceTracker:
    @pytest.mark.asyncio
    async def test_reference_tracker_round_trip(self):
        from src.smart_rag.infrastructure.diagram.reference_tracker import DiagramReferenceTracker

        tracker = DiagramReferenceTracker()
        await tracker.ensure_session("sess-1")
        ref = await tracker.get_next_reference("sess-1")
        assert ref == 1

        await tracker.store_diagram("sess-1", ref, "<html/>", "draw chart", "Chart")
        stored = await tracker.get_diagram("sess-1", ref)
        assert stored["title"] == "Chart"

        refs = await tracker.get_diagram_references("sess-1")
        assert refs == ["[diagram_1]"]

        summary = tracker.get_session_summary("sess-1")
        assert summary["total_diagrams"] == 1


class TestComponentTracker:
    def test_resolve_add_update_and_type_change(self):
        from src.smart_rag.messaging.component_tracker import ComponentTracker

        tracker = ComponentTracker("sess-1")
        component_id, action = tracker.resolve("agent-1", "text")
        assert action == "add"

        same_id, action = tracker.resolve("agent-1", "text")
        assert action == "update"
        assert same_id == component_id

        new_id, action = tracker.resolve("agent-1", "plan")
        assert action == "add"
        assert new_id != component_id

    def test_resolve_plan_and_finish_component(self):
        from src.smart_rag.messaging.component_tracker import ComponentTracker

        tracker = ComponentTracker("sess-2")
        first = tracker.resolve_plan()
        assert first == [("add", tracker._plan_component_id)]

        second = tracker.resolve_plan()
        assert second[0][0] == "delete"
        assert second[1][0] == "add"

        tracker.finish_component("agent-1")
        component_id, action = tracker.resolve("agent-1", "text")
        assert action == "add"
        assert component_id


class TestEnginesHelpers:
    def test_coerce_to_plain_and_dict(self):
        from src.smart_rag.engines.helpers import coerce_to_dict, coerce_to_plain

        nested = {"a": [{"b": 1}], "c": "x"}
        assert coerce_to_plain(nested)["a"][0]["b"] == 1
        assert coerce_to_dict('{"k": "v"}') == {"k": "v"}
        assert coerce_to_dict(None) == {}

    def test_build_content_with_images(self):
        from src.smart_rag.engines.helpers import build_content_with_images, decode_data_uri_to_part

        import base64

        raw = base64.b64encode(b"fake-image").decode()
        part = decode_data_uri_to_part(f"data:image/png;base64,{raw}")
        assert part.inline_data is not None

        content = build_content_with_images(
            "hello",
            [{"img": f"data:image/png;base64,{raw}"}],
        )
        assert content.role == "user"
        assert len(content.parts) == 2


class TestToolDescriptions:
    def test_get_tools_description_formats_entries(self):
        from src.smart_rag.tools.infrastructure.tool_descriptions import ToolDescriptionProvider

        def calculator():
            return None

        text = ToolDescriptionProvider.get_tools_description(
            ["search", calculator, {"name": "search_web", "description": "web", "top_k": 8}],
        )
        assert "Available Tools" in text
        assert "search_web" in text

    def test_get_source_citation_requirements(self):
        from src.smart_rag.tools.infrastructure.tool_descriptions import ToolDescriptionProvider

        doc_req = ToolDescriptionProvider.get_source_citation_requirements(["search"])
        assert "Document Source Citation" in doc_req

        web_req = ToolDescriptionProvider.get_source_citation_requirements(["search_web"])
        assert "Web Source Citation" in web_req

        report_req = ToolDescriptionProvider.get_source_reference_requirements_for_reports()
        assert "Citation and Source References" in report_req
