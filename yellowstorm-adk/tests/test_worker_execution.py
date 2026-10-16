from types import SimpleNamespace
import pytest
from google.genai import types
from src.root_runtime.worker_execution import nonproductive_calls, install_worker_execution, WorkerExecutionRejected
from google.adk.agents import LlmAgent
from unittest.mock import MagicMock


def response(name, payload):
    return types.Content(role='user', parts=[types.Part(function_response=types.FunctionResponse(name=name, response=payload))])


def test_no_progress_reconstructs_from_history_and_resets_after_research():
    stalled = [response('activate_skill', {'result': 'loaded'}), response('lookup', {'error': 'invalid arguments'})] * 3
    assert nonproductive_calls(stalled) == 6
    assert nonproductive_calls(stalled + [response('lookup', {'result': 'official evidence'})]) == 0
    agent = LlmAgent(name='worker', model='test')
    scope = SimpleNamespace(execution_id='worker')
    install_worker_execution(agent, scope)
    request = SimpleNamespace(contents=stalled, tools_dict={'lookup': object()})
    with pytest.raises(WorkerExecutionRejected):
        agent.before_model_callback[0](None, request)
    # Recompilation/resume cannot reset the history-derived guard.
    resumed = LlmAgent(name='worker', model='test'); install_worker_execution(resumed, scope)
    with pytest.raises(WorkerExecutionRejected):
        resumed.before_model_callback[0](None, request)


def test_capability_diagnostics_contain_only_bounded_names_and_counts(monkeypatch):
    logger = MagicMock(); monkeypatch.setattr('src.root_runtime.worker_execution.logger', logger)
    agent = LlmAgent(name='worker', model='test')
    install_worker_execution(agent, SimpleNamespace(execution_id='worker'))
    request = SimpleNamespace(contents=[types.Content(role='user', parts=[types.Part(text='secret prompt')])],
        tools_dict={'lookup': object()})
    agent.before_model_callback[0](None, request)
    agent.before_model_callback[0](None, request)
    logger.info.assert_called_once_with('worker.profile.resolved', run_id='worker', count=1, detail='lookup')


def test_model_turn_limit_survives_recompilation(monkeypatch):
    logger = MagicMock(); monkeypatch.setattr('src.root_runtime.worker_execution.logger', logger)
    agent = LlmAgent(name='worker', model='test')
    install_worker_execution(agent, SimpleNamespace(execution_id='worker'))
    request = SimpleNamespace(contents=[types.Content(role='model', parts=[types.Part(text='private')])] * 40,
        tools_dict={})
    with pytest.raises(WorkerExecutionRejected):
        agent.before_model_callback[0](None, request)
    logger.warning.assert_called_once_with('worker.execution.rejected', run_id='worker',
        reason_code='model_turn_limit', count=40)
