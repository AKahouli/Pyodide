import asyncio
import sys
import types
import json
import base64
from types import SimpleNamespace

import pytest
from pydantic import BaseModel

fake_litellm = types.ModuleType("litellm")
fake_litellm.api_base = None
fake_litellm.api_key = None
fake_litellm.drop_params = False
fake_litellm.acompletion = None
sys.modules.setdefault("litellm", fake_litellm)

fake_structlog = types.ModuleType("structlog")
fake_structlog.get_logger = lambda *args, **kwargs: SimpleNamespace(
    info=lambda *a, **k: None,
    warning=lambda *a, **k: None,
    error=lambda *a, **k: None,
)
fake_structlog_types = types.ModuleType("structlog.types")
fake_structlog_types.EventDict = dict
fake_structlog_types.Processor = object
sys.modules.setdefault("structlog", fake_structlog)
sys.modules.setdefault("structlog.types", fake_structlog_types)

fake_langgraph = types.ModuleType("langgraph")
fake_langgraph_config = types.ModuleType("langgraph.config")
fake_langgraph_types = types.ModuleType("langgraph.types")
fake_langgraph_errors = types.ModuleType("langgraph.errors")
fake_langgraph_config.get_stream_writer = lambda: (lambda event: None)
fake_langgraph_types.interrupt = lambda *args, **kwargs: None
fake_langgraph_errors.GraphInterrupt = type("GraphInterrupt", (Exception,), {})
sys.modules.setdefault("langgraph", fake_langgraph)
sys.modules.setdefault("langgraph.config", fake_langgraph_config)
sys.modules.setdefault("langgraph.types", fake_langgraph_types)
sys.modules.setdefault("langgraph.errors", fake_langgraph_errors)

fake_settings = types.ModuleType("src.config.settings")
fake_settings.get_settings = lambda: SimpleNamespace(
    LITELLM_API_BASE_URL="http://localhost",
    LITELLM_API_SECRET_KEY="test-key",
    PLAYBOOK_MAX_TOOL_ITERATIONS=40,
)
fake_settings.Settings = SimpleNamespace
sys.modules.setdefault("src.config.settings", fake_settings)

fake_step_hitl = types.ModuleType("src.flow_engine.nodes.step_hitl")


class _FakeStepHitlResult:
    def __init__(self, skipped=False, failed=False, updated_description=None, error_msg="", needs_reexec=False):
        self.skipped = skipped
        self.failed = failed
        self.updated_description = updated_description
        self.error_msg = error_msg
        self.needs_reexec = needs_reexec
        self.suppress_follow_up_clarification = False
        self.human_context = []


async def _fake_handle_hitl(*args, **kwargs):
    return _FakeStepHitlResult()


fake_step_hitl.StepHitlResult = _FakeStepHitlResult
fake_step_hitl.needs_hitl = lambda metadata: False
fake_step_hitl._build_interrupt_payload = lambda interrupt_type, message, **kwargs: {
    "type": interrupt_type,
    "message": message,
    **kwargs,
}
fake_step_hitl.extract_interrupt_message = lambda response: str((response or {}).get("message") or "")
fake_step_hitl.normalize_interrupt_action = lambda response, interrupt_type: "approve"
fake_step_hitl.should_proceed_without_more_clarification = lambda _message: False
fake_step_hitl.extract_feedback_scope = lambda response, default_scope="step_only": (
    response.get("scope") if isinstance(response, dict) and response.get("scope") else default_scope
)
fake_step_hitl.build_human_context_entry = lambda *args, **kwargs: None
fake_step_hitl.append_hitl_transcript_block = lambda base_text, transcript: base_text
fake_step_hitl.build_blocker_judge_prompt = lambda *args, **kwargs: "judge prompt"
fake_step_hitl.parse_blocker_judge_response = lambda _text: None
fake_step_hitl.handle_interrupt_before = _fake_handle_hitl
fake_step_hitl.handle_clarification_before = _fake_handle_hitl
fake_step_hitl.handle_clarification_after = _fake_handle_hitl
fake_step_hitl.handle_interrupt_after = _fake_handle_hitl
sys.modules.setdefault("src.flow_engine.nodes.step_hitl", fake_step_hitl)

fake_step_hitl_handlers = types.ModuleType("src.flow_engine.nodes.step_hitl_handlers")
fake_step_hitl_handlers.handle_interrupt_before = _fake_handle_hitl
fake_step_hitl_handlers.handle_clarification_before = _fake_handle_hitl
fake_step_hitl_handlers.handle_clarification_after = _fake_handle_hitl
fake_step_hitl_handlers.handle_interrupt_after = _fake_handle_hitl
sys.modules.setdefault("src.flow_engine.nodes.step_hitl_handlers", fake_step_hitl_handlers)

from src.flow_engine.nodes.step import (
    TEMP_CHILD_PARENT_INSTRUCTION,
    _TemporaryChildAgentTool,
    _build_available_file_context,
    _generated_child_output_contract,
    _temporary_child_enabled,
    run_step,
)

sys.modules.pop("src.flow_engine.nodes.step_hitl", None)
sys.modules.pop("src.flow_engine.nodes.step_hitl_handlers", None)
sys.modules.pop("src.flow_engine.nodes.step_hitl_blockers", None)
from src.flow_engine.nodes.step_prompt import build_step_prompt
from src.flow_engine.nodes.step_result import finalize_step_result


@pytest.fixture
def anyio_backend():
    return "asyncio"


def test_temporary_child_enabled_uses_explicit_param_only():
    assert _temporary_child_enabled({"enable_temporary_child_agents": "true"}) is True
    assert _temporary_child_enabled({"enable_temporary_child_agents": "false"}) is False
    assert _temporary_child_enabled({"connector_bindings_json": "[{}]"}) is False


def test_generated_child_output_contract_uses_declared_ports_for_work_nodes():
    parent_contract = {"ports": [{"id": "final", "type": "text"}]}

    assert _generated_child_output_contract(
        "task",
        {"generatedOutputPorts": [{"id": "summary", "type": "text"}]},
        parent_contract,
    ) == {"ports": [{"id": "summary", "type": "text"}]}
    assert _generated_child_output_contract("synthesis", {}, parent_contract) == parent_contract


@pytest.mark.anyio
async def test_run_step_applies_generated_work_node_output_contract(monkeypatch):
    captured_contracts = []

    async def _fake_execute_step(*args, **_kwargs):
        captured_contracts.append(args[6])
        return "verified facts", [], None

    async def _fake_dynamic_reasoning(**kwargs):
        child_result = await kwargs["child_executor"](
            "parent::dynamic-reasoning::graph::research",
            "Research",
            "Research the topic",
            {
                "inputs": {"input": "topic"},
                "generatedKind": "task",
                "generatedLocalNodeId": "research",
                "generatedOutputPorts": [{"id": "summary", "type": "text"}],
                "runtimeSubgraphId": "graph",
            },
        )
        assert child_result["outputs"]["summary"]["content"] == "verified facts"
        return types.SimpleNamespace(mode="subgraph", result_payload={"output": "final"})

    monkeypatch.setattr("src.flow_engine.nodes.step._execute_step", _fake_execute_step)
    monkeypatch.setattr("src.flow_engine.nodes.step.run_dynamic_reasoning", _fake_dynamic_reasoning)

    result = await run_step(
        node_id="parent",
        node_config={
            "label": "Parent",
            "description": "Solve the task",
            "dynamicReasoning": {"enabled": True},
        },
        state={
            "execution_id": "exec-1",
            "flow_id": "flow-1",
            "inputs": {"input": "topic"},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
            "dynamic_reasoning_policy": {"maxWorkNodes": 6, "maxParallelism": 3, "maxDepth": 1, "maxRepairAttempts": 1},
            "playbook_planner": {"agentId": "planner-1", "agentTypeSlug": "playbook_planner", "model": "test-model"},
        },
    )

    assert captured_contracts == [{"ports": [{"id": "summary", "type": "text"}]}]
    assert result["task_outputs"][("parent", 0)]["output"] == "final"


def test_available_file_context_leaves_filename_choice_to_model():
    context = _build_available_file_context(["Dragged.pdf", "Deep-search.pdf"])

    assert '"file_names": ["Dragged.pdf", "Deep-search.pdf"]' in context
    assert "Only send file_name or file_names when that tool declares the parameter" in context
    assert "Preserve filenames exactly" in context
    assert '"file_names": []' in _build_available_file_context([])


def test_temporary_child_instruction_requires_one_child_not_two():
    instruction = " ".join(TEMP_CHILD_PARENT_INSTRUCTION.split())
    assert "required first temporary child result has already been provided" in instruction
    assert "must call" not in instruction
    assert "at least once" not in instruction
    assert "two separate" not in instruction
    assert "again only when you decide more evidence or verification is needed" in instruction
    assert "multiple `tasks` with `execution_mode=\"parallel\"`" in instruction
    assert "hard total limit" in instruction
    assert "Do not use skills, MCP connector tools" in instruction
    assert "temporary children inherit and use those tools" in instruction
    assert "Call this only when more evidence or verification is needed" in (
        _TemporaryChildAgentTool.description
    )
    assert "two separate" not in _TemporaryChildAgentTool.description


def _assert_step_events_without_tokens(events: list[dict]) -> None:
    assert events[0]["type"] == "NodeStarted"
    assert events[-1]["type"] == "NodeCompleted"
    assert all(event["type"] in {"NodeStarted", "NodeTraceUpdate", "NodeCompleted"} for event in events)
    assert "NodeToken" not in {event["type"] for event in events}


class TestStepPrompt:
    def test_build_prompt_includes_prompt_contract_sections(self):
        prompt = build_step_prompt(
            label="Draft summary",
            node_id="step-1",
            node_description="Write an executive summary using the resolved inputs.",
            input_context={"brief": "Quarterly results", "tone": "concise"},
            output_contract={
                "raw": "Return JSON",
                "ports": [{"id": "summary", "label": "Summary", "type": "text", "required": True}],
            },
            iteration=2,
            trigger_context={"email": {"subject": "Q2 review"}},
        )

        assert "Task Node ID:\nstep-1" in prompt
        assert "Task Description:\nWrite an executive summary using the resolved inputs." in prompt
        assert 'Resolved Inputs:\n{\n  "brief": "Quarterly results"' in prompt
        assert 'Trigger Context:\n{\n  "email": {' in prompt
        assert 'Output Contract:\n{\n  "raw": "Return JSON"' in prompt
        assert "Iteration:\n2" in prompt
        assert "Complete this node using only the resolved input data (if applicable/available) and declared output contract." in prompt
        assert "---PUBLIC_REASONING_TRACE_JSON---" in prompt
        assert "Reasoning Trace:" in prompt
        assert "reasoning_trace" not in prompt

    def test_build_prompt_omits_duplicate_trigger_context(self):
        prompt = build_step_prompt(
            label="Draft summary",
            node_id="step-1",
            input_context={"brief": "Quarterly results"},
            trigger_context={"brief": "Quarterly results"},
        )

        assert "Trigger Context:" not in prompt

    def test_build_prompt_moves_default_workspace_out_of_trigger_context(self):
        prompt = build_step_prompt(
            label="Draft summary",
            node_id="step-1",
            input_context={"brief": "Quarterly results"},
            trigger_context={
                "email": {"subject": "Q2 review"},
                "__playbook_workspace_paths": {
                    "69e9d92e6f3d08e123c1fed7": "6984baadd6b2ec4585e8c707/mon-workspace-personnel",
                },
                "__playbook_default_workspace_path": "6984baadd6b2ec4585e8c707/mon-workspace-personnel",
                "__playbook_default_workspace_id": "69e9d92e6f3d08e123c1fed7",
            },
        )

        assert "6984baadd6b2ec4585e8c707" not in prompt
        assert "Playbook Default Workspace:" in prompt
        assert '"workspace_id": "69e9d92e6f3d08e123c1fed7"' in prompt
        assert '"workspace_path": "mon-workspace-personnel"' in prompt
        assert "Trigger Context:" in prompt
        assert '"email": {' in prompt
        assert "__playbook_default_workspace_path" not in prompt
        assert "__playbook_default_workspace_id" not in prompt

    def test_build_prompt_moves_default_workspace_out_of_resolved_inputs(self):
        prompt = build_step_prompt(
            label="Draft summary",
            node_id="step-1",
            input_context={
                "brief": "Quarterly results",
                "__playbook_default_workspace_id": "workspace-1",
                "__playbook_default_workspace_path": "user-1/default-workspace",
            },
        )

        assert "Playbook Default Workspace:" in prompt
        assert '"workspace_id": "workspace-1"' in prompt
        assert '"workspace_path": "user-1/default-workspace"' in prompt
        assert '"brief": "Quarterly results"' in prompt
        assert "__playbook_default_workspace_id" not in prompt
        assert "__playbook_default_workspace_path" not in prompt

    def test_build_prompt_derives_default_workspace_path_from_workspace_map(self):
        prompt = build_step_prompt(
            label="Draft summary",
            node_id="step-1",
            input_context={
                "__playbook_workspace_paths": {
                    "workspace-1": "6984baadd6b2ec4585e8c707/default-workspace",
                },
                "__playbook_default_workspace_id": "workspace-1",
            },
        )

        assert "Playbook Default Workspace:" in prompt
        assert '"workspace_id": "workspace-1"' in prompt
        assert '"workspace_path": "default-workspace"' in prompt
        assert "6984baadd6b2ec4585e8c707" not in prompt
        assert "__playbook_workspace_paths" not in prompt

    def test_build_prompt_includes_structured_response_schema_when_required(self):
        prompt = build_step_prompt(
            label="Draft summary",
            node_id="step-1",
            input_context={"brief": "Quarterly results"},
            output_contract={
                "ports": [
                    {"id": "summary", "type": "text"},
                    {"id": "report", "type": "document"},
                ],
            },
            require_structured_output=True,
        )

        assert "Response Format:" in prompt
        assert '"display_text": "user-visible final answer"' in prompt
        assert '"output_port_id": "summary"' in prompt
        assert '"output_port_id": "report"' in prompt
        assert "reasoning_trace" in prompt
        assert "Do not put reasoning steps inside `outputs`" in prompt
        assert "---PUBLIC_REASONING_TRACE_JSON---" not in prompt

    def test_build_prompt_keeps_human_guidance_without_raw_hitl_rules(self):
        prompt = build_step_prompt(
            label="Search leads",
            node_id="step-1",
            input_context={},
            hitl_policy={"mode": "auto"},
            hitl_blockers=[{"id": "custom-rule", "description": "population gender missing"}],
            human_context=[{"message": "Target female founders in France."}],
            hitl_memory=[{"message": "Prefer verified company websites."}],
        )

        assert "Human guidance from earlier workflow steps:" in prompt
        assert "Target female founders in France." in prompt
        assert "Reusable HITL memory:" in prompt
        assert "Prefer verified company websites." in prompt
        assert "Smart HITL policy:" not in prompt
        assert "Active blocker rules:" not in prompt
        assert "custom-rule" not in prompt


def test_build_prompt_sandbox_note_can_be_appended() -> None:
    prompt = build_step_prompt(
        label="Summarize CV",
        node_id="step-1",
        input_context={"default": {"name": "CV_Kevin_Diallo.pdf"}},
    )

    prompt = (
        f"{prompt}\n\nSandbox Files:\n"
        "Python sandbox files are mounted by these exact local filenames only: "
        "CV_Kevin_Diallo.pdf. Use those exact filenames in code."
    )

    assert "Sandbox Files:" in prompt
    assert "CV_Kevin_Diallo.pdf" in prompt


class TestStepResultReasoningTrace:
    def test_plain_text_response_extracts_public_reasoning_trace(self):
        response = (
            "invoice\n"
            "---PUBLIC_REASONING_TRACE_JSON---\n"
            '[{"id":"step_1","type":"observation","label":"Inspected document metadata",'
            '"description":"Used source cues.","confidence":0.99}]'
        )

        result = finalize_step_result(
            {"ports": [{"id": "default", "type": "text"}]},
            response,
        )

        assert result["output"] == "invoice"
        assert result["display_text"] == "invoice"
        assert result["outputs"]["default"]["content"] == "invoice"
        assert result["reasoning_trace"] == [
            {
                "id": "step_1",
                "type": "observation",
                "label": "Inspected document metadata",
                "description": "Used source cues.",
                "confidence": 0.99,
            }
        ]

    def test_plain_text_response_ignores_malformed_public_reasoning_trace(self):
        response = "invoice\n---PUBLIC_REASONING_TRACE_JSON---\nnot-json"

        result = finalize_step_result(
            {"ports": [{"id": "default", "type": "text"}]},
            response,
        )

        assert result["output"] == "invoice"
        assert result["outputs"]["default"]["content"] == "invoice"
        assert "reasoning_trace" not in result

    def test_plain_text_response_uses_last_public_reasoning_trace_marker(self):
        response = (
            "Some echoed instructions\n"
            "---PUBLIC_REASONING_TRACE_JSON---\n"
            "[{\"id\":\"example\",\"type\":\"observation\",\"label\":\"Example\",\"description\":\"Example only.\"}]\n"
            "invoice\n"
            "---PUBLIC_REASONING_TRACE_JSON---\n"
            '[{"id":"step_1","type":"observation","label":"Inspected document metadata",'
            '"description":"Used source cues."}]'
        )

        result = finalize_step_result(
            {"ports": [{"id": "default", "type": "text"}]},
            response,
        )

        assert result["output"] == "Some echoed instructions\n---PUBLIC_REASONING_TRACE_JSON---\n[{\"id\":\"example\",\"type\":\"observation\",\"label\":\"Example\",\"description\":\"Example only.\"}]\ninvoice"
        assert result["outputs"]["default"]["content"] == result["output"]
        assert result["reasoning_trace"] == [
            {
                "id": "step_1",
                "type": "observation",
                "label": "Inspected document metadata",
                "description": "Used source cues.",
            }
        ]

    def test_structured_response_extracts_reasoning_trace(self):
        response = json.dumps({
            "display_text": "Summary",
            "outputs": [
                {"output_port_id": "summary", "artifact_kind": "text", "content": "done"},
                {"output_port_id": "report", "artifact_kind": "document", "content": {"url": "https://example.com/file.pdf"}},
            ],
            "reasoning_trace": [
                {"id": "s1", "type": "observation", "label": "Read", "description": "Read the brief.", "confidence": 0.9},
                {"id": "s2", "type": "analysis", "label": "Synthesized", "description": "Combined inputs."},
            ],
        })
        result = finalize_step_result(
            {"ports": [{"id": "summary", "type": "text"}, {"id": "report", "type": "document"}]},
            response,
        )
        assert result["output"] == "Summary"
        assert result["reasoning_trace"] == [
            {"id": "s1", "type": "observation", "label": "Read", "description": "Read the brief.", "confidence": 0.9},
            {"id": "s2", "type": "analysis", "label": "Synthesized", "description": "Combined inputs."},
        ]

    def test_structured_response_omits_reasoning_trace_when_absent(self):
        response = json.dumps({
            "display_text": "Summary",
            "outputs": [
                {"output_port_id": "summary", "artifact_kind": "text", "content": "done"},
                {"output_port_id": "report", "artifact_kind": "document", "content": {"url": "https://example.com/f.pdf"}},
            ],
        })
        result = finalize_step_result(
            {"ports": [{"id": "summary", "type": "text"}, {"id": "report", "type": "document"}]},
            response,
        )
        assert "reasoning_trace" not in result

    def test_structured_response_accepts_outputs_dict(self):
        response = json.dumps({
            "display_text": "Summary",
            "outputs": {
                "summary": {"artifactKind": "text", "content": "done"},
                "report": {"artifactKind": "document", "content": {"url": "https://example.com/f.pdf"}},
            },
        })
        result = finalize_step_result(
            {"ports": [{"id": "summary", "type": "text"}, {"id": "report", "type": "document"}]},
            response,
        )
        assert result["display_text"] == "Summary"
        assert result["outputs"]["summary"]["content"] == "done"
        assert result["outputs"]["report"]["ref"] == "https://example.com/f.pdf"

    def test_structured_response_accepts_legacy_ports_list(self):
        response = json.dumps({
            "display_text": "Summary",
            "ports": [
                {"id": "summary", "artifact_kind": "text", "value": "done"},
                {"id": "report", "artifact_kind": "document", "value": {"url": "https://example.com/f.pdf"}},
            ],
        })
        result = finalize_step_result(
            {"ports": [{"id": "summary", "type": "text"}, {"id": "report", "type": "document"}]},
            response,
        )
        assert result["display_text"] == "Summary"
        assert result["outputs"]["summary"]["content"] == "done"
        assert result["outputs"]["report"]["ref"] == "https://example.com/f.pdf"

    def test_structured_response_recovers_reasoning_trace_misplaced_in_outputs(self):
        response = json.dumps({
            "display_text": "Summary",
            "outputs": [
                {"output_port_id": "lead_list", "artifact_kind": "data", "content": {"items": ["done"]}},
                {
                    "id": "step_1",
                    "type": "observation",
                    "label": "Read",
                    "description": "Read the brief.",
                    "confidence": 0.9,
                },
            ],
        })
        result = finalize_step_result(
            {"ports": [{"id": "lead_list", "type": "data"}]},
            response,
        )
        assert result["outputs"]["lead_list"]["content"] == {"items": ["done"]}
        assert result["reasoning_trace"] == [
            {
                "id": "step_1",
                "type": "observation",
                "label": "Read",
                "description": "Read the brief.",
                "confidence": 0.9,
            }
        ]

    def test_structured_response_merges_top_level_and_recovered_reasoning_trace(self):
        response = json.dumps({
            "display_text": "Summary",
            "outputs": [
                {"output_port_id": "lead_list", "artifact_kind": "data", "content": {"items": ["done"]}},
                {
                    "id": "step_2",
                    "type": "observation",
                    "label": "Recovered",
                    "description": "Recovered from outputs.",
                },
            ],
            "reasoning_trace": [
                {
                    "id": "step_1",
                    "type": "observation",
                    "label": "Explicit",
                    "description": "Already present.",
                }
            ],
        })
        result = finalize_step_result(
            {"ports": [{"id": "lead_list", "type": "data"}]},
            response,
        )
        assert result["reasoning_trace"] == [
            {
                "id": "step_1",
                "type": "observation",
                "label": "Explicit",
                "description": "Already present.",
            },
            {
                "id": "step_2",
                "type": "observation",
                "label": "Recovered",
                "description": "Recovered from outputs.",
            },
        ]


class _CalculatorArgs(BaseModel):
    expression: str


class _FakeTool:
    name = "calculator"
    description = "Math helper"
    args_schema = _CalculatorArgs

    async def ainvoke(self, args):
        return "4"


class _ReadContentTool:
    name = "read_content"
    description = "Read document content"
    args_schema = _CalculatorArgs

    async def ainvoke(self, args):
        image_base64 = base64.b64encode(b"\xff\xd8\xfffake-jpeg").decode("ascii")
        return {
            "file_name": "recipes.pdf",
            "citation_sources": [
                {
                    "type": "text",
                    "page": "1",
                    "content": "<page_1>Recipe</page_1>",
                    "images": [
                        {
                            "image_id": "img-1",
                            "bbox": [1, 2, 3, 4],
                            "image_base64": image_base64,
                        },
                        {
                            "image_id": "img-2",
                            "bbox": [5, 6, 7, 8],
                            "image_base64": image_base64,
                        },
                    ],
                }
            ],
        }


class _ReadContentMcpImageTool:
    name = "read_content"
    description = "Read document content"
    args_schema = _CalculatorArgs

    async def ainvoke(self, args):
        return {
            "file_name": "recipes.pdf",
            "images": [
                {
                    "image_id": "p1_b8",
                    "image_content_index": 1,
                }
            ],
            "__mcp_content_parts": [
                {
                    "type": "text",
                    "text": '{"file_name":"recipes.pdf","images":[{"image_id":"p1_b8","image_content_index":1}]}',
                },
                {
                    "type": "image",
                    "data": "YWJjMTIz",
                    "mimeType": "image/png",
                    "decodedByteSize": 6,
                },
            ],
        }


class _ToolCallResponse:
    def __init__(self, content, tool_calls=None):
        self.choices = [
            SimpleNamespace(
                message=SimpleNamespace(content=content, tool_calls=tool_calls or []),
            ),
        ]


@pytest.mark.anyio
async def test_run_step_executes_bound_tools(monkeypatch):
    events = []
    calls = []

    def _writer(event):
        events.append(event)

    async def _fake_acompletion(*args, **kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return _ToolCallResponse(
                "",
                [{
                    "id": "call-1",
                    "type": "function",
                    "function": {
                        "name": "calculator",
                        "arguments": '{"expression":"2+2"}',
                    },
                }],
            )
        return _ToolCallResponse("The answer is 4.")

    monkeypatch.setattr("src.flow_engine.nodes.step.get_stream_writer", lambda: _writer)
    monkeypatch.setattr("src.flow_engine.nodes.step.litellm.acompletion", _fake_acompletion)
    monkeypatch.setattr("src.flow_engine.nodes.step_tools.litellm.acompletion", _fake_acompletion)
    fake_factory_module = types.ModuleType("src.flow_engine.tools")
    fake_factory_module.create_langchain_tools = lambda **kwargs: ([_FakeTool()], None)
    monkeypatch.setitem(sys.modules, "src.flow_engine.tools", fake_factory_module)

    result = await run_step(
        node_id="step-1",
        node_config={
            "label": "Calculate",
            "metadata": {
                "agent_name": "Research agent",
                "agent_tools": [{"name": "calculator", "description": "Math helper"}],
            },
        },
        state={
            "execution_id": "exec-1",
            "flow_id": "flow-1",
            "inputs": {},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        },
    )

    assert len(calls) == 2
    assert calls[0]["tools"][0]["function"]["name"] == "calculator"
    assert any(message.get("role") == "tool" and message.get("content") == "4" for message in calls[1]["messages"])
    assert result["task_outputs"][("step-1", 0)]["output"] == "The answer is 4."
    assert events[-1]["type"] == "NodeCompleted"


@pytest.mark.anyio
async def test_run_step_attaches_temporary_child_tool_when_enabled(monkeypatch):
    calls = []

    async def _fake_acompletion(*args, **kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return _ToolCallResponse("Child evidence.")
        return _ToolCallResponse("Parent answer.")

    monkeypatch.setattr("src.flow_engine.nodes.step.litellm.acompletion", _fake_acompletion)
    monkeypatch.setattr("src.flow_engine.nodes.step_tools.litellm.acompletion", _fake_acompletion)
    fake_factory_module = types.ModuleType("src.flow_engine.tools")
    fake_factory_module.create_langchain_tools = lambda **kwargs: ([_FakeTool()], None)
    monkeypatch.setitem(sys.modules, "src.flow_engine.tools", fake_factory_module)

    result = await run_step(
        node_id="step-1",
        node_config={
            "label": "Research",
            "metadata": {
                "agent_name": "Research agent",
                "agent_tools": [{"name": "calculator", "description": "Math helper"}],
                "agent_params": {
                    "enable_temporary_child_agents": "true",
                    "max_temporary_child_agents": "2",
                },
            },
        },
        state={
            "execution_id": "exec-1",
            "flow_id": "flow-1",
            "inputs": {},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        },
    )

    assert len(calls) == 2
    child_tool_names = [tool["function"]["name"] for tool in calls[0]["tools"]]
    parent_tool_names = [tool["function"]["name"] for tool in calls[1]["tools"]]
    assert "calculator" in child_tool_names
    assert "create_temporary_child_agent" not in child_tool_names
    assert "calculator" not in parent_tool_names
    assert "create_temporary_child_agent" in parent_tool_names
    assert "Child evidence." in str(calls[1]["messages"])
    assert result["task_outputs"][("step-1", 0)]["output"] == "Parent answer."


@pytest.mark.anyio
async def test_temporary_child_tool_runs_parallel_tasks_with_hard_total_limit(monkeypatch):
    active = 0
    max_active = 0

    async def _fake_run_step_with_tools(**kwargs):
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.01)
        active -= 1
        return kwargs["user_msg"].splitlines()[1]

    monkeypatch.setattr("src.flow_engine.nodes.step.run_step_with_tools", _fake_run_step_with_tools)
    tool = _TemporaryChildAgentTool(
        model_id="gpt-test",
        system_prompt="system",
        child_tools=[],
        max_children=2,
        session_id="exec-1",
        parent_name="parent",
        inherited_context="context",
    )

    result = await tool.ainvoke({
        "tasks": [
            {"task_description": "task one"},
            {"task_description": "task two"},
            {"task_description": "task three"},
        ],
        "execution_mode": "parallel",
    })

    assert max_active == 2
    assert "Child 1 result" in result
    assert "Child 2 result" in result
    assert "Skipped 1 requested child task" in result
    assert "limit reached" in (await tool.ainvoke({"task_description": "another"})).lower()


@pytest.mark.anyio
async def test_run_step_with_tools_preserves_tool_base64_images(monkeypatch):
    from src.flow_engine.nodes.step_tools import run_step_with_tools

    calls = []

    async def _fake_acompletion(*args, **kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return _ToolCallResponse(
                "",
                [{
                    "id": "call-1",
                    "type": "function",
                    "function": {
                        "name": "read_content",
                        "arguments": '{"expression":"ignored"}',
                    },
                }],
            )
        return _ToolCallResponse("I used the attached images.")

    monkeypatch.setattr("src.flow_engine.nodes.step_tools.litellm.acompletion", _fake_acompletion)

    output = await run_step_with_tools(
        model_id="gpt-test",
        system_prompt="system",
        user_msg="read the document",
        tools=[_ReadContentTool()],
    )

    assert output == "I used the attached images."
    second_messages = calls[1]["messages"]
    tool_message = next(message for message in second_messages if message.get("role") == "tool")
    assert "image_base64" in tool_message["content"]
    assert "image_description" not in tool_message["content"]
    assert "img-1" in tool_message["content"]
    assert "[1, 2, 3, 4]" in tool_message["content"]
    assert not any(
        message.get("role") == "user" and isinstance(message.get("content"), list)
        for message in second_messages
    )


@pytest.mark.anyio
async def test_run_step_with_tools_forwards_mcp_image_parts(monkeypatch):
    from src.flow_engine.nodes.step_tools import run_step_with_tools

    calls = []

    async def _fake_acompletion(*args, **kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return _ToolCallResponse(
                "",
                [{
                    "id": "call-1",
                    "type": "function",
                    "function": {
                        "name": "read_content",
                        "arguments": '{"expression":"ignored"}',
                    },
                }],
            )
        return _ToolCallResponse("The answer is in image p1_b8.")

    monkeypatch.setattr("src.flow_engine.nodes.step_tools.litellm.acompletion", _fake_acompletion)

    output = await run_step_with_tools(
        model_id="gpt-test",
        system_prompt="system",
        user_msg="read the document",
        tools=[_ReadContentMcpImageTool()],
    )

    assert output == "The answer is in image p1_b8."
    second_messages = calls[1]["messages"]
    tool_message = next(message for message in second_messages if message.get("role") == "tool")
    assert "__mcp_content_parts" not in tool_message["content"]
    assert "p1_b8" in tool_message["content"]

    image_message = next(
        message
        for message in second_messages
        if message.get("role") == "user" and isinstance(message.get("content"), list)
    )
    image_blocks = [
        block
        for block in image_message["content"]
        if isinstance(block, dict) and block.get("type") == "image_url"
    ]
    assert image_message["content"][0]["text"] == tool_message["content"]
    assert len(image_blocks) == 1
    assert image_blocks[0]["image_url"]["url"] == "data:image/png;base64,YWJjMTIz"


@pytest.mark.anyio
async def test_run_step_with_tools_retries_text_only_after_mcp_image_rejection(monkeypatch):
    from src.flow_engine.nodes.step_tools import run_step_with_tools

    calls = []
    tool_invocations = []
    tool = _ReadContentMcpImageTool()
    original_ainvoke = tool.ainvoke

    async def _tracked_ainvoke(args):
        tool_invocations.append(args)
        return await original_ainvoke(args)

    async def _fake_acompletion(*args, **kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return _ToolCallResponse(
                "",
                [{
                    "id": "call-1",
                    "type": "function",
                    "function": {
                        "name": "read_content",
                        "arguments": '{"expression":"ignored"}',
                    },
                }],
            )
        if len(calls) == 2:
            raise ValueError(
                "messages.content.type is invalid, allowed values: ['text']"
            )
        return _ToolCallResponse("Text-only fallback succeeded.")

    monkeypatch.setattr(tool, "ainvoke", _tracked_ainvoke)
    monkeypatch.setattr("src.flow_engine.nodes.step_tools.litellm.acompletion", _fake_acompletion)

    output = await run_step_with_tools(
        model_id="test-model",
        system_prompt="system",
        user_msg="read the document",
        tools=[tool],
    )

    assert output == "Text-only fallback succeeded."
    assert len(tool_invocations) == 1
    retry_messages = calls[2]["messages"]
    assert not any(
        isinstance(message.get("content"), list)
        and any(block.get("type") != "text" for block in message["content"])
        for message in retry_messages
    )
    assert any(
        message.get("role") == "assistant"
        and message.get("tool_calls", [{}])[0].get("id") == "call-1"
        for message in retry_messages
    )
    assert any(
        message.get("role") == "tool" and message.get("tool_call_id") == "call-1"
        for message in retry_messages
    )


@pytest.mark.anyio
async def test_run_step_with_tools_does_not_retry_unrelated_mcp_image_error(monkeypatch):
    from src.flow_engine.nodes.step_tools import run_step_with_tools

    calls = []
    tool = _ReadContentMcpImageTool()

    async def _fake_acompletion(*args, **kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return _ToolCallResponse(
                "",
                [{
                    "id": "call-1",
                    "type": "function",
                    "function": {
                        "name": "read_content",
                        "arguments": '{"expression":"ignored"}',
                    },
                }],
            )
        raise ValueError("provider request timed out")

    monkeypatch.setattr("src.flow_engine.nodes.step_tools.litellm.acompletion", _fake_acompletion)

    with pytest.raises(ValueError, match="provider request timed out"):
        await run_step_with_tools(
            model_id="test-model",
            system_prompt="system",
            user_msg="read the document",
            tools=[tool],
        )

    assert len(calls) == 2


@pytest.mark.anyio
async def test_run_step_with_tools_limits_total_mcp_images_across_iterations(monkeypatch):
    from src.flow_engine.nodes.step_tools import run_step_with_tools

    class _ManyMcpImagesTool:
        name = "read_content"
        description = "Read document images"
        args_schema = _CalculatorArgs

        async def ainvoke(self, args):
            return {
                "result": "images",
                "__mcp_content_parts": [
                    {
                        "type": "image",
                        "data": "YWJjMTIz",
                        "mimeType": "image/png",
                        "decodedByteSize": 6,
                    }
                    for _ in range(30)
                ],
            }

    calls = []

    async def _fake_acompletion(*args, **kwargs):
        calls.append(kwargs)
        if len(calls) < 3:
            return _ToolCallResponse(
                "",
                [{
                    "id": f"call-{len(calls)}",
                    "type": "function",
                    "function": {
                        "name": "read_content",
                        "arguments": '{"expression":"ignored"}',
                    },
                }],
            )
        return _ToolCallResponse("Done.")

    monkeypatch.setattr(
        "src.flow_engine.nodes.step_tools.litellm.acompletion",
        _fake_acompletion,
    )

    output = await run_step_with_tools(
        model_id="gpt-test",
        system_prompt="system",
        user_msg="read the document",
        tools=[_ManyMcpImagesTool()],
    )

    assert output == "Done."
    final_messages = calls[2]["messages"]
    image_blocks = [
        block
        for message in final_messages
        if isinstance(message.get("content"), list)
        for block in message["content"]
        if isinstance(block, dict) and block.get("type") == "image_url"
    ]
    assert len(image_blocks) == 50


@pytest.mark.anyio
async def test_run_step_with_tools_keeps_parallel_tool_responses_adjacent(monkeypatch):
    from src.flow_engine.nodes.step_tools import run_step_with_tools

    calls = []

    async def _fake_acompletion(*args, **kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return _ToolCallResponse(
                "",
                [
                    {
                        "id": "call-image",
                        "type": "function",
                        "function": {
                            "name": "read_content",
                            "arguments": '{"expression":"ignored"}',
                        },
                    },
                    {
                        "id": "call-calc",
                        "type": "function",
                        "function": {
                            "name": "calculator",
                            "arguments": '{"expression":"2+2"}',
                        },
                    },
                ],
            )
        return _ToolCallResponse("Done.")

    monkeypatch.setattr("src.flow_engine.nodes.step_tools.litellm.acompletion", _fake_acompletion)

    output = await run_step_with_tools(
        model_id="gpt-test",
        system_prompt="system",
        user_msg="read and calculate",
        tools=[_ReadContentMcpImageTool(), _FakeTool()],
    )

    assert output == "Done."
    assert calls[0]["parallel_tool_calls"] is False

    second_messages = calls[1]["messages"]
    assistant_index = next(
        index
        for index, message in enumerate(second_messages)
        if message.get("role") == "assistant"
    )
    follow_up_messages = second_messages[assistant_index + 1:]
    assert [message.get("role") for message in follow_up_messages[:2]] == ["tool", "tool"]
    assert [message.get("tool_call_id") for message in follow_up_messages[:2]] == ["call-image", "call-calc"]
    assert follow_up_messages[2].get("role") == "user"


@pytest.mark.anyio
async def test_run_step_uses_state_workspace_when_node_inputs_are_resolved(monkeypatch):
    captured_kwargs = {}

    def _fake_create_langchain_tools(**kwargs):
        captured_kwargs.update(kwargs)
        return [], None

    class _Chunk:
        def __init__(self, token):
            self.choices = [SimpleNamespace(delta=SimpleNamespace(content=token))]

    class _Stream:
        def __aiter__(self):
            self._iter = iter([_Chunk("done")])
            return self

        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration as exc:
                raise StopAsyncIteration from exc

    async def _fake_acompletion(*args, **kwargs):
        return _Stream()

    monkeypatch.setattr("src.flow_engine.nodes.step.litellm.acompletion", _fake_acompletion)
    fake_factory_module = types.ModuleType("src.flow_engine.tools")
    fake_factory_module.create_langchain_tools = _fake_create_langchain_tools
    monkeypatch.setitem(sys.modules, "src.flow_engine.tools", fake_factory_module)

    await run_step(
        node_id="step-1",
        node_config={
            "label": "Calculate",
            "metadata": {
                "agent_name": "Document agent",
                "agent_tools": [{"name": "code interpreter"}],
            },
        },
        state={
            "execution_id": "exec-1",
            "flow_id": "flow-1",
            "inputs": {"__playbook_workspace_ids": ["workspace-1"]},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        },
        node_inputs={},
    )

    assert captured_kwargs["output_workspace_id"] == "workspace-1"


@pytest.mark.anyio
async def test_run_step_deep_search_merges_dragged_and_returned_files(monkeypatch):
    captured_factory_kwargs = {}
    captured_search = {}
    captured_completion = {}

    def _fake_create_langchain_tools(**kwargs):
        captured_factory_kwargs.update(kwargs)
        return [], None

    async def _fake_search(query, workspace_id):
        captured_search.update(query=query, workspace_id=workspace_id)
        return {
            "workspace_id": workspace_id,
            "status": "ROUTED",
            "total_files": 3,
            "files": {
                "required": [
                    {
                        "file_name": "DOC-1-cv_kevin_diallo.PDF",
                        "routing_decision": "ROUTE",
                        "search_for": ["candidate CV"],
                        "reason": "Candidate matches.",
                    },
                    {
                        "file_name": "contract.pdf",
                        "routing_decision": "ROUTE",
                        "search_for": ["contractual penalties"],
                        "reason": "Contract matches.",
                    },
                ],
                "optional": [
                    {
                        "file_name": "annex.pdf",
                        "routing_decision": "ROUTE",
                        "search_for": ["penalty schedule"],
                        "reason": "Annex matches.",
                    },
                ],
            },
        }

    class _Chunk:
        def __init__(self, token):
            self.choices = [SimpleNamespace(delta=SimpleNamespace(content=token))]

    class _Stream:
        def __aiter__(self):
            self._iter = iter([_Chunk("done")])
            return self

        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration as exc:
                raise StopAsyncIteration from exc

    async def _fake_acompletion(*args, **kwargs):
        captured_completion.update(kwargs)
        return _Stream()

    monkeypatch.setattr("src.flow_engine.nodes.step.litellm.acompletion", _fake_acompletion)
    monkeypatch.setattr("src.flow_engine.deep_search.search_relevant_documents", _fake_search)
    fake_factory_module = types.ModuleType("src.flow_engine.tools")
    fake_factory_module.create_langchain_tools = _fake_create_langchain_tools
    monkeypatch.setitem(sys.modules, "src.flow_engine.tools", fake_factory_module)

    await run_step(
        node_id="step-1",
        node_config={
            "label": "Research penalties",
            "description": "Find the contractual penalties",
            "metadata": {
                "agent_name": "Document agent",
                "deep_search": True,
            },
        },
        state={
            "execution_id": "exec-1",
            "flow_id": "flow-1",
            "inputs": {
                "query": "What penalties apply to late delivery?",
                "__playbook_default_workspace_id": "workspace-default",
            },
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        },
        node_inputs={
            "default": {
                "workspaceId": "workspace-1",
                "path": "user/workspace/doc-1/CV_Kevin_Diallo.pdf",
                "kind": "document",
                "id": "doc-1",
                "metadata": {
                    "documentId": "doc-1",
                    "workspaceId": "workspace-1",
                    "filepath": "user/workspace/doc-1/CV_Kevin_Diallo.pdf",
                    "filename": "doc-1-CV_Kevin_Diallo.pdf",
                },
                "name": "CV_Kevin_Diallo.pdf",
            }
        },
    )

    assert captured_search["query"] == "What penalties apply to late delivery?"
    assert captured_search["workspace_id"] == "workspace-1"
    assert captured_factory_kwargs["input_files"] == [
        "doc-1-CV_Kevin_Diallo.pdf",
        "contract.pdf",
        "annex.pdf",
    ]
    assert captured_factory_kwargs["deep_search"] is False
    llm_prompt = "\n".join(
        str(message.get("content") or "")
        for message in captured_completion["messages"]
    )
    assert "<deep_search_routing_plan>" in llm_prompt
    assert '"file_name": "contract.pdf"' in llm_prompt
    assert '"search_for": ["contractual penalties"]' in llm_prompt
    assert '"required": [' in llm_prompt
    assert '"optional": [' in llm_prompt
    assert "Decide which exact file_name or file_names" in llm_prompt


@pytest.mark.anyio
async def test_run_step_hitl_policy_off_suppresses_legacy_clarification(monkeypatch):
    handler_calls = []

    class _Chunk:
        def __init__(self, token):
            self.choices = [SimpleNamespace(delta=SimpleNamespace(content=token))]

    class _Stream:
        def __aiter__(self):
            self._iter = iter([_Chunk("done")])
            return self

        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration as exc:
                raise StopAsyncIteration from exc

    async def _fake_acompletion(*args, **kwargs):
        return _Stream()

    async def _unexpected_clarification(*args, **kwargs):
        handler_calls.append((args, kwargs))
        return _FakeStepHitlResult()

    monkeypatch.setattr("src.flow_engine.nodes.step.needs_hitl", lambda _metadata: True)
    monkeypatch.setattr("src.flow_engine.nodes.step.handle_clarification_before", _unexpected_clarification)
    monkeypatch.setattr("src.flow_engine.nodes.step.litellm.acompletion", _fake_acompletion)
    fake_factory_module = types.ModuleType("src.flow_engine.tools")
    fake_factory_module.create_langchain_tools = lambda **kwargs: ([], None)
    monkeypatch.setitem(sys.modules, "src.flow_engine.tools", fake_factory_module)

    result = await run_step(
        node_id="step-1",
        node_config={
            "label": "Collect input",
            "metadata": {"allowClarification": True},
        },
        state={
            "execution_id": "exec-1",
            "flow_id": "flow-1",
            "inputs": {},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
            "hitl_policy": {"mode": "off"},
        },
    )

    assert handler_calls == []
    assert result["task_outputs"][("step-1", 0)]["output"] == "done"


@pytest.mark.anyio
async def test_run_step_invokes_post_exec_clarification_for_question_output(monkeypatch):
    after_calls = []

    class _Chunk:
        def __init__(self, token):
            self.choices = [SimpleNamespace(delta=SimpleNamespace(content=token))]

    class _Stream:
        def __aiter__(self):
            self._iter = iter([_Chunk("What geography should I use?")])
            return self

        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration as exc:
                raise StopAsyncIteration from exc

    async def _fake_acompletion(*args, **kwargs):
        return _Stream()

    async def _no_pre_exec_hitl(*args, **kwargs):
        return _FakeStepHitlResult()

    async def _post_exec_hitl(*args, **kwargs):
        after_calls.append((args, kwargs))
        return _FakeStepHitlResult(skipped=True)

    fake_factory_module = types.ModuleType("src.flow_engine.tools")
    fake_factory_module.create_langchain_tools = lambda **kwargs: ([], None)
    monkeypatch.setitem(sys.modules, "src.flow_engine.tools", fake_factory_module)
    monkeypatch.setattr("src.flow_engine.nodes.step.needs_hitl", lambda _metadata: True)
    monkeypatch.setattr("src.flow_engine.nodes.step.handle_clarification_before", _no_pre_exec_hitl)
    monkeypatch.setattr("src.flow_engine.nodes.step.handle_clarification_after", _post_exec_hitl)
    monkeypatch.setattr("src.flow_engine.nodes.step.litellm.acompletion", _fake_acompletion)

    result = await run_step(
        node_id="step-1",
        node_config={
            "label": "Collect input",
            "metadata": {"allowClarification": True},
        },
        state={
            "execution_id": "exec-1",
            "flow_id": "flow-1",
            "inputs": {},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
            "hitl_policy": {"mode": "auto"},
        },
    )

    assert after_calls
    assert result["task_outputs"][("step-1", 0)]["status"] == "skipped"


@pytest.mark.anyio
async def test_run_step_injects_fresh_human_context_into_same_resumed_prompt(monkeypatch):
    captured_execute: dict[str, object] = {}

    async def _fake_execute_step(
        node_id,
        node_config,
        state,
        metadata,
        input_context,
        node_description,
        output_contract,
        model_id,
        system_prompt,
        structured_output,
        agent_config,
        connector_bindings,
        iteration,
        label,
        writer,
        hitl_policy,
        hitl_blockers,
        human_context,
        deep_search=False,
    ):
        captured_execute["node_description"] = node_description
        captured_execute["human_context"] = human_context
        return "done", [], None

    hitl_result = _FakeStepHitlResult(
        updated_description=(
            "Search leads.\n\n"
            "<HITL_Transcript>\n"
            "Assistant question 1: Which country?\n"
            "User answer 1: Use Germany.\n"
            "</HITL_Transcript>"
        )
    )
    hitl_result.human_context = [{
        "node_id": "step-1",
        "task_title": "Collect country",
        "interrupt_type": "clarification",
        "message": "Use Germany.",
        "scope": "downstream_run",
        "remember": False,
        "source_message": "Which country?",
    }]

    monkeypatch.setattr("src.flow_engine.nodes.step.evaluate_hitl_blocker", lambda *args, **kwargs: object())

    def _fake_handle_smart_hitl_blocker(decision, *args, **kwargs):
        return hitl_result if decision else _FakeStepHitlResult()

    monkeypatch.setattr("src.flow_engine.nodes.step.handle_smart_hitl_blocker", _fake_handle_smart_hitl_blocker)

    async def _no_llm_judge(*args, **kwargs):
        return _FakeStepHitlResult()

    monkeypatch.setattr("src.flow_engine.nodes.step.handle_llm_judge_blocker", _no_llm_judge)
    monkeypatch.setattr("src.flow_engine.nodes.step._execute_step", _fake_execute_step)

    result = await run_step(
        node_id="step-1",
        node_config={
            "label": "Collect country",
            "description": "Search leads.",
            "metadata": {},
        },
        state={
            "execution_id": "exec-1",
            "flow_id": "flow-1",
            "inputs": {},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
            "human_context": [],
            "hitl_policy": {"mode": "auto"},
        },
    )

    assert "<HITL_Transcript>" in captured_execute["node_description"]
    assert "Assistant question 1: Which country?" in captured_execute["node_description"]
    assert "User answer 1: Use Germany." in captured_execute["node_description"]
    assert captured_execute["human_context"] == hitl_result.human_context
    assert result["task_outputs"][("step-1", 0)]["output"] == "done"


@pytest.mark.anyio
async def test_run_step_passes_code_interpreter_file_scope(monkeypatch):
    captured_kwargs = {}
    captured_messages = []

    def _fake_create_langchain_tools(**kwargs):
        captured_kwargs.update(kwargs)
        return [], None

    class _Chunk:
        def __init__(self, token):
            self.choices = [SimpleNamespace(delta=SimpleNamespace(content=token))]

    class _Stream:
        def __aiter__(self):
            self._iter = iter([_Chunk("done")])
            return self

        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration as exc:
                raise StopAsyncIteration from exc

    async def _fake_acompletion(*args, **kwargs):
        captured_messages.extend(kwargs.get("messages") or [])
        return _Stream()

    monkeypatch.setattr("src.flow_engine.nodes.step.litellm.acompletion", _fake_acompletion)
    fake_factory_module = types.ModuleType("src.flow_engine.tools")
    fake_factory_module.create_langchain_tools = _fake_create_langchain_tools
    monkeypatch.setitem(sys.modules, "src.flow_engine.tools", fake_factory_module)

    await run_step(
        node_id="step-1",
        node_config={
            "label": "Summarize CV",
            "metadata": {
                "agent_name": "Document agent",
                "agent_tools": [{"name": "code interpreter"}],
            },
            "output": {"ports": [{"id": "default", "type": "text"}]},
        },
        state={
            "execution_id": "exec-1",
            "flow_id": "flow-1",
            "inputs": {"__playbook_default_workspace_id": "workspace-1"},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        },
        node_inputs={
            "default": {
                "workspaceId": "workspace-1",
                "path": "user/workspace/doc-1/CV_Kevin_Diallo.pdf",
                "kind": "document",
                "id": "doc-1",
                "metadata": {
                    "documentId": "doc-1",
                    "workspaceId": "workspace-1",
                    "filepath": "user/workspace/doc-1/CV_Kevin_Diallo.pdf",
                    "filename": "doc-1-CV_Kevin_Diallo.pdf",
                },
                "name": "CV_Kevin_Diallo.pdf",
            }
        },
    )

    assert captured_kwargs["input_files"] == ["doc-1-CV_Kevin_Diallo.pdf"]
    assert captured_kwargs["documents_by_port"] == {"default": ["doc-1-CV_Kevin_Diallo.pdf"]}
    assert captured_kwargs["code_interpreter_files"] == [
        {
            "document_id": "doc-1",
            "filename": "CV_Kevin_Diallo.pdf",
            "file_name": "doc-1-CV_Kevin_Diallo.pdf",
            "filepath": "user/workspace/doc-1/CV_Kevin_Diallo.pdf",
            "workspace_id": "workspace-1",
            "workspace_name": "workspace-1",
            "workspace_path": "user/workspace/doc-1",
            "kind": "document",
        }
    ]
    assert captured_kwargs["workspace_context_mode"] == "resolved_inputs_only"
    user_message = next(message["content"] for message in captured_messages if message.get("role") == "user")
    assert "Sandbox Files:" in user_message
    assert "CV_Kevin_Diallo.pdf" in user_message
    assert '"file_names": ["doc-1-CV_Kevin_Diallo.pdf"]' in user_message
    assert "available_mcp_file_names" in user_message


@pytest.mark.anyio
async def test_run_step_passes_opaque_document_refs_into_tool_scope(monkeypatch):
    captured_kwargs = {}

    def _fake_create_langchain_tools(**kwargs):
        captured_kwargs.update(kwargs)
        return [], None

    class _Chunk:
        def __init__(self, token):
            self.choices = [SimpleNamespace(delta=SimpleNamespace(content=token))]

    class _Stream:
        def __aiter__(self):
            self._iter = iter([_Chunk("done")])
            return self

        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration as exc:
                raise StopAsyncIteration from exc

    async def _fake_acompletion(*args, **kwargs):
        return _Stream()

    monkeypatch.setattr("src.flow_engine.nodes.step.litellm.acompletion", _fake_acompletion)
    fake_factory_module = types.ModuleType("src.flow_engine.tools")
    fake_factory_module.create_langchain_tools = _fake_create_langchain_tools
    monkeypatch.setitem(sys.modules, "src.flow_engine.tools", fake_factory_module)

    await run_step(
        node_id="step-1",
        node_config={
            "label": "Summarize report",
            "metadata": {
                "agent_name": "Document agent",
                "agent_tools": [{"name": "code interpreter"}],
                "brain_context": [
                    {
                        "workspace_id": "workspace-1",
                        "workspace_documents": [
                            {
                                "_id": "doc-1",
                                "filename": "report.xlsx",
                                "filepath": "user/workspace/doc-1/report.xlsx",
                            }
                        ],
                    }
                ],
            },
        },
        state={
            "execution_id": "exec-1",
            "flow_id": "flow-1",
            "inputs": {"__playbook_default_workspace_id": "workspace-1"},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        },
        node_inputs={"report": {"document_id": "doc-1", "filename": "report.xlsx"}},
    )

    assert captured_kwargs["input_files"] == ["report.xlsx"]
    assert captured_kwargs["documents_by_port"] == {"report": ["report.xlsx"]}
    assert captured_kwargs["code_interpreter_files"] == [
        {
            "document_id": "doc-1",
            "filename": "report.xlsx",
            "file_name": "report.xlsx",
            "filepath": "user/workspace/doc-1/report.xlsx",
            "workspace_id": "workspace-1",
            "workspace_name": "workspace-1",
            "workspace_path": "user/workspace/doc-1",
        }
    ]
    assert captured_kwargs["workspace_context"] == []


@pytest.mark.anyio
async def test_run_step_does_not_fallback_to_workspace_for_unresolved_opaque_ref(monkeypatch):
    captured_kwargs = {}

    def _fake_create_langchain_tools(**kwargs):
        captured_kwargs.update(kwargs)
        return [], None

    class _Chunk:
        def __init__(self, token):
            self.choices = [SimpleNamespace(delta=SimpleNamespace(content=token))]

    class _Stream:
        def __aiter__(self):
            self._iter = iter([_Chunk("done")])
            return self

        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration as exc:
                raise StopAsyncIteration from exc

    async def _fake_acompletion(*args, **kwargs):
        return _Stream()

    monkeypatch.setattr("src.flow_engine.nodes.step.litellm.acompletion", _fake_acompletion)
    fake_factory_module = types.ModuleType("src.flow_engine.tools")
    fake_factory_module.create_langchain_tools = _fake_create_langchain_tools
    monkeypatch.setitem(sys.modules, "src.flow_engine.tools", fake_factory_module)

    await run_step(
        node_id="step-1",
        node_config={
            "label": "Summarize report",
            "metadata": {
                "agent_name": "Document agent",
                "agent_tools": [{"name": "code interpreter"}],
                "brain_context": [
                    {
                        "workspace_id": "workspace-1",
                        "workspace_documents": [
                            {
                                "_id": "doc-1",
                                "filename": "report.xlsx",
                                "filepath": "user/workspace/doc-1/report.xlsx",
                            }
                        ],
                    }
                ],
            },
        },
        state={
            "execution_id": "exec-1",
            "flow_id": "flow-1",
            "inputs": {"__playbook_default_workspace_id": "workspace-1"},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        },
        node_inputs={"report": {"document_id": "doc-2", "filename": "generated-report.xlsx"}},
    )

    assert captured_kwargs["input_files"] == ["generated-report.xlsx"]
    assert captured_kwargs["documents_by_port"] == {"report": ["generated-report.xlsx"]}
    assert captured_kwargs["code_interpreter_files"] == []
    assert captured_kwargs["workspace_context"] == []
    assert captured_kwargs["workspace_context_mode"] == "resolved_inputs_only"


@pytest.mark.anyio
async def test_run_step_emits_structured_result_payload(monkeypatch):
    events = []

    def _writer(event):
        events.append(event)

    class _Chunk:
        def __init__(self, token):
            self.choices = [SimpleNamespace(delta=SimpleNamespace(content=token))]

    class _Stream:
        def __init__(self, chunks):
            self._chunks = chunks

        def __aiter__(self):
            self._iter = iter(self._chunks)
            return self

        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration as exc:
                raise StopAsyncIteration from exc

    response_text = (
        '{"display_text":"Executive summary","outputs":['
        '{"output_port_id":"summary","artifact_kind":"text","content":"Executive summary"},'
        '{"output_port_id":"report","artifact_kind":"document","content":{"filename":"report.pdf","url":"https://example.com/report.pdf","mime_type":"application/pdf"}}'
        ']}'
    )

    async def _fake_acompletion(*args, **kwargs):
        return _Stream([_Chunk(response_text)])

    monkeypatch.setattr("src.flow_engine.nodes.step.get_stream_writer", lambda: _writer)
    monkeypatch.setattr("src.flow_engine.nodes.step.litellm.acompletion", _fake_acompletion)
    fake_factory_module = types.ModuleType("src.flow_engine.tools")
    fake_factory_module.create_langchain_tools = lambda **kwargs: ([], None)
    monkeypatch.setitem(sys.modules, "src.flow_engine.tools", fake_factory_module)

    result = await run_step(
        node_id="step-1",
        node_config={
            "label": "Draft summary",
            "output": {
                "ports": [
                    {"id": "summary", "type": "text"},
                    {"id": "report", "type": "document"},
                ],
            },
            "metadata": {},
        },
        state={
            "execution_id": "exec-1",
            "flow_id": "flow-1",
            "inputs": {},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        },
    )

    payload = result["task_outputs"][("step-1", 0)]
    assert payload["output"] == "Executive summary"
    assert payload["display_text"] == "Executive summary"
    assert payload["outputs"]["summary"]["content"] == "Executive summary"
    assert payload["outputs"]["report"]["ref"] == "https://example.com/report.pdf"
    assert payload["artifacts"][1]["filename"] == "report.pdf"
    _assert_step_events_without_tokens(events)


@pytest.mark.anyio
async def test_run_step_suppresses_token_stream_for_data_visualizer(monkeypatch):
    events = []

    def _writer(event):
        events.append(event)

    class _Chunk:
        def __init__(self, token):
            self.choices = [SimpleNamespace(delta=SimpleNamespace(content=token, model_extra=None))]

    class _Stream:
        def __init__(self, chunks):
            self._chunks = chunks

        def __aiter__(self):
            self._iter = iter(self._chunks)
            return self

        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration as exc:
                raise StopAsyncIteration from exc

    async def _fake_acompletion(*args, **kwargs):
        return _Stream([_Chunk("<html><body><h1>Chart</h1></body></html>")])

    monkeypatch.setattr("src.flow_engine.nodes.step.get_stream_writer", lambda: _writer)
    monkeypatch.setattr("src.flow_engine.nodes.step.litellm.acompletion", _fake_acompletion)
    fake_factory_module = types.ModuleType("src.flow_engine.tools")
    fake_factory_module.create_langchain_tools = lambda **kwargs: ([], None)
    monkeypatch.setitem(sys.modules, "src.flow_engine.tools", fake_factory_module)

    result = await run_step(
        node_id="step-1",
        node_config={
            "label": "Render chart",
            "metadata": {
                "agent_type": "visualizer",
            },
            "output": {"ports": [{"id": "default", "type": "text"}]},
        },
        state={
            "execution_id": "exec-1",
            "flow_id": "flow-1",
            "inputs": {},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        },
    )

    assert result["task_outputs"][("step-1", 0)]["output"] == "<html><body><h1>Chart</h1></body></html>"
    _assert_step_events_without_tokens(events)


@pytest.mark.anyio
async def test_run_step_suppresses_tool_stream_for_visualizer(monkeypatch):
    events = []
    calls = []

    def _writer(event):
        events.append(event)

    async def _fake_acompletion(*args, **kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return _ToolCallResponse(
                "",
                [{
                    "id": "call-1",
                    "type": "function",
                    "function": {
                        "name": "calculator",
                        "arguments": '{"expression":"2+2"}',
                    },
                }],
            )
        return _ToolCallResponse("<html><body><h1>Chart</h1></body></html>")

    monkeypatch.setattr("src.flow_engine.nodes.step.get_stream_writer", lambda: _writer)
    monkeypatch.setattr("src.flow_engine.nodes.step.litellm.acompletion", _fake_acompletion)
    monkeypatch.setattr("src.flow_engine.nodes.step_tools.litellm.acompletion", _fake_acompletion)
    fake_factory_module = types.ModuleType("src.flow_engine.tools")
    fake_factory_module.create_langchain_tools = lambda **kwargs: ([_FakeTool()], None)
    monkeypatch.setitem(sys.modules, "src.flow_engine.tools", fake_factory_module)

    result = await run_step(
        node_id="step-1",
        node_config={
            "label": "Render chart",
            "metadata": {
                "agent_type": "visualizer",
                "agent_tools": [{"name": "calculator", "description": "Math helper"}],
            },
            "output": {"ports": [{"id": "default", "type": "text"}]},
        },
        state={
            "execution_id": "exec-1",
            "flow_id": "flow-1",
            "inputs": {},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        },
    )

    assert result["task_outputs"][("step-1", 0)]["output"] == "<html><body><h1>Chart</h1></body></html>"
    assert any(message.get("role") == "tool" and message.get("content") == "4" for message in calls[1]["messages"])
    _assert_step_events_without_tokens(events)


@pytest.mark.anyio
async def test_run_step_preserves_opaque_structured_refs(monkeypatch):
    events = []

    def _writer(event):
        events.append(event)

    class _Chunk:
        def __init__(self, token):
            self.choices = [SimpleNamespace(delta=SimpleNamespace(content=token))]

    class _Stream:
        def __init__(self, chunks):
            self._chunks = chunks

        def __aiter__(self):
            self._iter = iter(self._chunks)
            return self

        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration as exc:
                raise StopAsyncIteration from exc

    async def _fake_acompletion(*args, **kwargs):
        return _Stream([
            _Chunk('{"display_text":"Prepared","outputs":[{"output_port_id":"report","artifact_kind":"document","content":{"document_id":"doc-1"}}]}'),
        ])

    monkeypatch.setattr("src.flow_engine.nodes.step.get_stream_writer", lambda: _writer)
    monkeypatch.setattr("src.flow_engine.nodes.step.litellm.acompletion", _fake_acompletion)
    fake_factory_module = types.ModuleType("src.flow_engine.tools")
    fake_factory_module.create_langchain_tools = lambda **kwargs: ([], None)
    monkeypatch.setitem(sys.modules, "src.flow_engine.tools", fake_factory_module)

    result = await run_step(
        node_id="step-1",
        node_config={
            "label": "Prepare report",
            "output": {
                "ports": [{"id": "report", "type": "document"}],
            },
            "metadata": {},
        },
        state={
            "execution_id": "exec-1",
            "flow_id": "flow-1",
            "inputs": {},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        },
    )

    payload = result["task_outputs"][("step-1", 0)]
    assert payload["outputs"]["report"]["ref"] == {"document_id": "doc-1"}
    _assert_step_events_without_tokens(events)
