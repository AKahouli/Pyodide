"""MCP visual evidence survives tool rounds, but never a fresh user invocation."""
import base64
from types import SimpleNamespace
import pytest

from google.adk.models.llm_request import LlmRequest
from google.adk.sessions.state import State
from src.smart_rag.infrastructure.processing.callback_helper import inject_images_before_model
from src.smart_rag.infrastructure.processing.tool_image_state import CACHE_KEY, IMAGE_PREFIX
from src.smart_rag.tools.utilities.connector_tools import _buffer_mcp_images_for_model


def buffer(context, raw):
    _buffer_mcp_images_for_model({'__mcp_content_parts': [
        {'type': 'image', 'mimeType': 'image/png', 'data': base64.b64encode(raw).decode()}
    ]}, context)


def injected(context, request=None):
    request = request or LlmRequest(contents=[])
    inject_images_before_model(context, request)
    return request, [p.inline_data.data for c in request.contents for p in c.parts if p.inline_data]


def context():
    return SimpleNamespace(invocation_id='turn-1', state=State({}, {}))


def test_first_search_image_survives_second_search_and_rebuilt_final_request():
    ctx = context()
    lion = b'\x89PNG\r\n\x1a\nlion'
    unrelated = b'\x89PNG\r\n\x1a\nunrelated'
    buffer(ctx, lion)
    assert injected(ctx)[1] == [lion]
    buffer(ctx, unrelated)
    assert injected(ctx)[1] == [lion, unrelated]
    assert injected(ctx)[1] == [lion, unrelated]
    # Calling the callback twice on the same request must not duplicate pixels.
    request, _ = injected(ctx)
    assert injected(ctx, request)[1] == [lion, unrelated]


def test_new_identical_question_turn_does_not_receive_previous_images():
    ctx = context()
    buffer(ctx, b'\x89PNG\r\n\x1a\nold')
    injected(ctx)
    ctx.invocation_id = 'turn-2'
    assert injected(ctx)[1] == []
    assert ctx.state[CACHE_KEY] == []


def test_interrupted_pending_images_are_cleared_before_next_turn_tool():
    ctx = context()
    buffer(ctx, b'\x89PNG\r\n\x1a\ninterrupted')
    ctx.invocation_id = 'turn-2'
    fresh = b'\x89PNG\r\n\x1a\nfresh'
    buffer(ctx, fresh)
    assert injected(ctx)[1] == [fresh]


def test_parallel_tool_buffers_are_deduplicated_and_retention_is_bounded():
    ctx = context()
    for i in range(52):
        raw = b'\x89PNG\r\n\x1a\n' + str(i).encode()
        buffer(ctx, raw)
        buffer(ctx, raw)
    assert len(injected(ctx)[1]) == 50
    assert len(ctx.state[CACHE_KEY]) == 50
    assert all(key.startswith('temp:') for key in ctx.state.to_dict())
    assert all(not value for key, value in ctx.state.to_dict().items() if key.startswith(IMAGE_PREFIX))


@pytest.mark.asyncio
async def test_real_adk_runner_keeps_visual_evidence_and_isolates_next_user_turn():
    from google.adk.agents import LlmAgent
    from google.adk.models import BaseLlm
    from google.adk.models.llm_response import LlmResponse
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.adk.tools.tool_context import ToolContext
    from google.genai import types

    lion = b'\x89PNG\r\n\x1a\nlion'
    unrelated = b'\x89PNG\r\n\x1a\nunrelated'
    calls = []

    class ScriptedModel(BaseLlm):
        async def generate_content_async(self, request, stream=False):
            calls.append([p.inline_data.data for c in request.contents for p in c.parts if p.inline_data])
            if len(calls) <= 2:
                part = types.Part.from_function_call(name='search_images', args={'index': len(calls) - 1})
            else:
                part = types.Part(text='done')
            yield LlmResponse(content=types.Content(role='model', parts=[part]))

    def search_images(index: int, tool_context: ToolContext) -> dict:
        """Retrieve the next MCP image result."""
        raw = lion if index == 0 else unrelated
        return _buffer_mcp_images_for_model({'__mcp_content_parts': [
            {'type': 'image', 'mimeType': 'image/png', 'data': base64.b64encode(raw).decode()}
        ]}, tool_context)

    sessions = InMemorySessionService()
    agent = LlmAgent(name='image_agent', model=ScriptedModel(model='scripted'),
                     tools=[search_images], before_model_callback=inject_images_before_model)
    runner = Runner(app_name='image_test', agent=agent, session_service=sessions)
    await sessions.create_session(app_name='image_test', user_id='user', session_id='session')

    async def run_question():
        async for _ in runner.run_async(user_id='user', session_id='session',
                new_message=types.Content(role='user', parts=[types.Part(text='same question')])):
            pass

    await run_question()
    assert calls == [[], [lion], [lion, unrelated]]
    session = await sessions.get_session(app_name='image_test', user_id='user', session_id='session')
    assert all(not key.startswith('temp:') for event in session.events
               for key in event.actions.state_delta)
    await run_question()
    assert calls[3] == []
