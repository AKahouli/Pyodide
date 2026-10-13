"""Bounded, noninteractive leaf execution over the native scoped history."""
import inspect

from google.adk.tools import FunctionTool
from yellowmind_observability import get_logger
from src.guardrails.adapters.google_adk import append_callback
from src.smart_rag.tools import present_choices

logger = get_logger(__name__)
MAX_NONPRODUCTIVE_CALLS = 6
MAX_WORKER_MODEL_TURNS = 40


class WorkerExecutionRejected(RuntimeError):
    pass


def nonproductive_calls(contents):
    count = 0
    for content in contents or []:
        for part in content.parts or []:
            response = part.function_response
            if response is None:
                continue
            value = response.response
            result = value.get('result', value)
            failed = isinstance(result, dict) and (result.get('error') or result.get('isError')
                or result.get('status') in ('failed', 'outcome_unknown', 'denied'))
            count = count + 1 if response.name == 'activate_skill' or failed else 0
    return count


def install_worker_execution(agent, scope):
    # Compare trusted executable identities; names and remote metadata grant nothing.
    agent.tools = [tool for tool in agent.tools if inspect.unwrap(
        tool.func if isinstance(tool, FunctionTool) else tool) is not present_choices]
    resolved = False

    def before_model(callback_context, llm_request):
        nonlocal resolved
        if not resolved:
            names = sorted(llm_request.tools_dict or {})
            logger.info('worker.profile.resolved', run_id=scope.execution_id,
                count=len(names), detail=', '.join(names[:16])[:512])
            resolved = True
        count = nonproductive_calls(llm_request.contents)
        turns = sum(content.role == 'model' for content in llm_request.contents or [])
        if count >= MAX_NONPRODUCTIVE_CALLS or turns >= MAX_WORKER_MODEL_TURNS:
            logger.warning('worker.execution.rejected', run_id=scope.execution_id,
                reason_code='no_tool_progress' if count >= MAX_NONPRODUCTIVE_CALLS else 'model_turn_limit',
                count=count if count >= MAX_NONPRODUCTIVE_CALLS else turns)
            raise WorkerExecutionRejected('Worker made repeated nonproductive tool calls; no retry was performed')
        return None

    agent.before_model_callback = append_callback(agent.before_model_callback, before_model)
