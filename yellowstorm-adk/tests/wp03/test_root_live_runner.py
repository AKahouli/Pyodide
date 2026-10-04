"""The production presenter must use the enrolled App and native Stop signal."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from dataclasses import replace

import pytest
from google.genai import types

from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1
from src.smart_rag.agents.core.runner import AgentRunner


@pytest.mark.asyncio
async def test_root_native_input_control_parks_and_resumes_through_real_presenter():
    from google.adk.agents import LlmAgent
    from google.adk.models.base_llm import BaseLlm
    from google.adk.models.llm_response import LlmResponse
    from google.adk.sessions import InMemorySessionService
    from src.root_runtime.compiler import attach_root_input_control
    from src.smart_rag.messaging import StreamingFormatter

    class Scripted(BaseLlm):
        def __init__(self):
            super().__init__(model='scripted-native-root')
            object.__setattr__(self, 'requests', [])

        async def generate_content_async(self, request, stream=False):
            self.requests.append(request)
            part = types.Part(function_call=types.FunctionCall(id='ask', name='adk_request_input', args={
                'message': 'Enter a word', 'response_schema': {'type': 'string', 'minLength': 1},
            })) if len(self.requests) == 1 else types.Part(text='NATIVE_RESUMED_OK')
            yield LlmResponse(content=types.Content(role='model', parts=[part]))

    model = Scripted()
    root = LlmAgent(name='root', model=model)
    scope = ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id='root_execution', native_session_id='conversation')
    attach_root_input_control(root, scope, 1)
    sessions = InMemorySessionService()
    await sessions.create_session(app_name='manager_app', user_id='user', session_id='conversation')
    queue = asyncio.Queue()
    presenter = AgentRunner(MagicMock(), MagicMock(), StreamingFormatter(), MagicMock())
    async def run(current_scope, responses=None):
        return await presenter._run_standard_agent(root, 'root', 'agent', sessions, 'user', 'conversation',
            types.Content(role='user', parts=[types.Part(text='ORIGINAL_REQUEST_ONCE')]), queue, '', None, [], 'root',
            execution_scope=current_scope, native_input_responses=responses)
    first = await run(scope)
    assert first[0] is None
    traces = []
    while not queue.empty():
        chunk = queue.get_nowait()
        assert chunk.get('component', {}).get('type') != 'tool_activity'
        if 'execution_trace' in chunk:
            traces.append(chunk['execution_trace'])
    waiting = [trace for trace in traces if trace['pending_inputs']][-1]
    pending = waiting['pending_inputs'][0]
    assert pending['message'] == 'Enter a word' and pending['input_version'] == 1
    resumed_scope = replace(scope, resume_intent='resume', native_invocation_id=waiting['native_invocation_id'])
    second = await run(resumed_scope, [{'input_id': pending['input_id'], 'function_name': 'adk_request_input',
        'response': {'result': '"yes"'}}])
    assert second[0] == 'NATIVE_RESUMED_OK'
    session = await sessions.get_session(app_name='manager_app', user_id='user', session_id='conversation')
    original = [part for event in session.events for part in getattr(event.content, 'parts', None) or []
        if part.text == 'ORIGINAL_REQUEST_ONCE']
    assert len(original) == 1
    assert all(event.invocation_id == waiting['native_invocation_id'] for event in session.events)


@pytest.mark.asyncio
@pytest.mark.parametrize("html", [False, True])
async def test_live_root_presenter_passes_scope_and_native_abort(html):
    presenter = AgentRunner(MagicMock(), MagicMock(), MagicMock(), MagicMock())
    agent = MagicMock(name="root")
    agent.name = "root"
    agent.tools = []
    agent.sub_agents = []
    scope = ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id="root_execution")
    abort_signal = asyncio.Event()
    native_runner = MagicMock()
    failure = RuntimeError("native runner reached")
    native_runner.run_async.side_effect = failure
    session_service = MagicMock()
    with patch("src.root_runtime.compiler.make_role_runner", return_value=native_runner) as make_runner:
        with pytest.raises(RuntimeError, match="native runner reached"):
            if html:
                await presenter._run_html_agent(
                    agent, session_service, "user", "conversation",
                    types.Content(role="user", parts=[types.Part(text="hello")]),
                    None, "root", execution_scope=scope, abort_signal=abort_signal,
                )
                return
            await presenter._run_standard_agent(
                agent=agent, agent_name="root", agent_type="agent",
                session_helper=session_service, user_id="user", session_id="conversation",
                content=types.Content(role="user", parts=[types.Part(text="hello")]),
                q=None, task_order="", toolkit=None, mcp_tools_used=[], agent_id="root",
                execution_scope=scope, abort_signal=abort_signal,
            )
    make_runner.assert_called_once_with(agent, session_service, scope)
    assert native_runner.run_async.call_args.kwargs["abort_signal"] is abort_signal


def test_abort_signal_is_internal_and_not_serialized():
    from src.schema.chatbot_schema import RunAgentTeamRequest

    assert RunAgentTeamRequest.model_fields["abort_signal"].exclude is True


@pytest.mark.asyncio
async def test_html_route_forwards_native_execution_context():
    presenter = AgentRunner(MagicMock(), MagicMock(), MagicMock(), MagicMock())
    agent = MagicMock()
    agent.name = "HtmlAgent"
    sessions = MagicMock()
    sessions.create_session = AsyncMock(return_value=MagicMock())
    scope = ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id="root_execution")
    abort = asyncio.Event()
    with patch.object(presenter, "_run_html_agent", new_callable=AsyncMock) as run_html:
        await presenter.run_agent_tool(
            agent, "hello", sessions, execution_scope=scope, abort_signal=abort,
        )
    assert run_html.call_args.kwargs == {
        "execution_scope": scope, "abort_signal": abort, "native_input_responses": None,
    }
