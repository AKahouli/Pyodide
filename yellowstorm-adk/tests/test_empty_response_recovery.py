import asyncio
from types import SimpleNamespace
import pytest
from google.adk.models.llm_response import LlmResponse
from google.genai import types
from src.smart_rag.infrastructure.monitoring.model_response_recovery import recover_empty_response


def message(text=None, call=None):
    return LlmResponse(content=types.Content(role='model', parts=[] if text is None and call is None
        else [types.Part(text=text)] if text is not None else [types.Part(function_call=call)]))


@pytest.mark.asyncio
@pytest.mark.parametrize('second', [message('Recovered'), message()])
async def test_empty_turn_retries_once_and_accounts_for_both_attempts(second):
    calls = []
    first = message(); first.usage_metadata = types.GenerateContentResponseUsageMetadata(prompt_token_count=10, total_token_count=10)
    second = second.model_copy(deep=True)
    second.usage_metadata = types.GenerateContentResponseUsageMetadata(prompt_token_count=11, candidates_token_count=2, total_token_count=13)
    async def generate(request, stream=False):
        calls.append(request)
        yield first if len(calls) == 1 else second
    request = SimpleNamespace(contents=[])
    responses = [item async for item in recover_empty_response(generate, request, False, 'test')]
    assert calls == [request, request]
    assert len(responses) == 1 and responses[0].usage_metadata.total_token_count == 23


@pytest.mark.asyncio
async def test_tool_history_or_tool_output_never_retries():
    call = types.FunctionCall(name='save', args={})
    for contents, output in ([types.Content(role='model', parts=[types.Part(function_call=call)])], message()), ([], message(call=call)):
        calls = []
        async def generate(request, stream=False):
            calls.append(request); yield output
        responses = [item async for item in recover_empty_response(generate, SimpleNamespace(contents=contents), False, 'test')]
        assert len(calls) == 1 and len(responses) == 1


@pytest.mark.asyncio
async def test_error_or_interruption_never_retries():
    for failure in (False, True):
        calls = []
        async def generate(request, stream=False):
            calls.append(request)
            if failure:
                raise asyncio.CancelledError()
            yield LlmResponse(error_code='provider_error', error_message='Unavailable')
        if failure:
            with pytest.raises(asyncio.CancelledError):
                _ = [item async for item in recover_empty_response(generate, SimpleNamespace(contents=[]), False, 'test')]
        else:
            _ = [item async for item in recover_empty_response(generate, SimpleNamespace(contents=[]), False, 'test')]
        assert len(calls) == 1


@pytest.mark.asyncio
async def test_token_limit_is_not_an_empty_success_and_does_not_retry():
    calls = []
    async def generate(request, stream=False):
        calls.append(request)
        yield LlmResponse(finish_reason=types.FinishReason.MAX_TOKENS)
    responses = [item async for item in recover_empty_response(generate, SimpleNamespace(contents=[]), True, 'test')]
    assert len(calls) == 1 and responses[0].finish_reason == types.FinishReason.MAX_TOKENS


@pytest.mark.asyncio
@pytest.mark.parametrize('second', [message('Recovered'), message()])
async def test_recovery_without_new_usage_preserves_first_attempt_usage(second):
    calls = []
    async def generate(request, stream=False):
        calls.append(request)
        if len(calls) == 1:
            yield LlmResponse(usage_metadata=types.GenerateContentResponseUsageMetadata(total_token_count=10))
        else:
            yield second
    responses = [item async for item in recover_empty_response(generate, SimpleNamespace(contents=[]), True, 'test')]
    assert len(calls) == 2
    assert responses[-1].usage_metadata.total_token_count == 10 and responses[-1].partial
