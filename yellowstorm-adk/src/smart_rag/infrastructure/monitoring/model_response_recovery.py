"""Retry only a wholly empty provider turn before any native tool history exists."""
from contextlib import aclosing
from google.adk.models.llm_response import LlmResponse
from yellowmind_observability import get_logger

logger = get_logger(__name__)


def _usable(response):
    return any(part.text or part.function_call or part.function_response or part.inline_data or part.file_data
        for part in getattr(response.content, 'parts', None) or [])


def _merge_usage(previous, current):
    if previous is None:
        return current
    if current is None:
        return previous
    merged = current.model_copy(deep=True)
    for field in ('prompt_token_count', 'candidates_token_count', 'total_token_count', 'thoughts_token_count', 'cached_content_token_count'):
        setattr(merged, field, (getattr(previous, field, None) or 0) + (getattr(current, field, None) or 0))
    return merged


async def recover_empty_response(generate, request, stream, model):
    can_retry = not any(part.function_call or part.function_response
        for content in request.contents or [] for part in content.parts or [])
    previous_usage = None
    for attempt in (1, 2):
        pending, usable, failed = [], False, False
        async with aclosing(generate(request, stream=stream)) as responses:
            async for response in responses:
                failed = failed or bool(response.error_code or response.error_message)
                finish = getattr(response.finish_reason, 'value', response.finish_reason)
                failed = failed or finish not in (None, 'STOP')
                usable = usable or _usable(response)
                if usable or len(pending) >= 8:
                    can_retry = False
                    for empty in pending:
                        yield empty
                    pending.clear()
                    if response.usage_metadata is not None:
                        response.usage_metadata = _merge_usage(previous_usage, response.usage_metadata)
                        previous_usage = None
                    yield response
                else:
                    pending.append(response)
        if usable:
            if previous_usage is not None:
                yield LlmResponse(usage_metadata=previous_usage, partial=True)
            return
        if attempt == 1 and can_retry and not failed and pending:
            previous_usage = next((item.usage_metadata for item in reversed(pending) if item.usage_metadata is not None), None)
            logger.warning('llm.call.retried', model=model, attempt=2)
            continue
        for response in pending:
            if response.usage_metadata is not None:
                response.usage_metadata = _merge_usage(previous_usage, response.usage_metadata)
                previous_usage = None
            yield response
        if previous_usage is not None:
            yield LlmResponse(usage_metadata=previous_usage, partial=True)
        return
