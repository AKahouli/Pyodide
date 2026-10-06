from types import SimpleNamespace

from google.adk.events import Event
from google.adk.events.event_actions import EventActions
from google.genai import types

from src.root_runtime.background_recovery import classify_native_history


def classify(*events):
    initial = Event(id='initial', author='user', invocation_id='invocation',
        content=types.Content(role='user', parts=[types.Part(text='bounded task')]))
    return classify_native_history(SimpleNamespace(events=[initial, *events]), 'invocation', 'initial', 'worker')


def native(*parts, author='worker', actions=None):
    return Event(author=author, invocation_id='invocation', actions=actions or EventActions(),
        content=types.Content(role='model', parts=list(parts)) if parts else None)


def test_text_requires_top_level_checkpoint_and_later_content_invalidates_it():
    text = native(types.Part(text='actual output'))
    end = native(actions=EventActions(end_of_agent=True))
    assert classify(text).status == 'resume'
    assert classify(text, native(author='nested', actions=EventActions(end_of_agent=True))).status == 'resume'
    assert classify(text, end).status == 'completed'
    assert classify(text, end).text == 'actual output'
    assert classify(text, end, native(types.Part(text='continued work'))).status == 'resume'
    assert classify(text, end, native(actions=EventActions(agent_state={}))).status == 'resume'
    nested = native(actions=EventActions(end_of_agent=True))
    nested.node_info.path = 'worker@1/child@1'
    assert classify(text, nested).status == 'resume'
    end.node_info.path = 'worker@1'
    assert classify(text, end).status == 'completed'


def test_native_input_wait_is_not_final_success_and_repeated_call_occurrence_parks_again():
    ask = native(types.Part(function_call=types.FunctionCall(id='input', name='adk_request_input', args={})))
    response = native(types.Part(function_response=types.FunctionResponse(id='input', name='adk_request_input', response={'answer': 'yes'})))
    text = native(types.Part(text='output'))
    end = native(actions=EventActions(end_of_agent=True))
    assert classify(ask, end).status == 'waiting'
    assert classify(ask, response, text, end).status == 'completed'
    assert classify(ask, response, text, end, ask).pending == (('input', 'adk_request_input'),)


def test_outstanding_effect_never_completes_and_missing_initial_proof_never_restarts():
    call = native(types.Part(function_call=types.FunctionCall(id='effect', name='save_file', args={})))
    assert classify(call, native(types.Part(text='output')), native(actions=EventActions(end_of_agent=True))).status == 'resume'
    assert classify_native_history(None, None, None, 'worker').status == 'never_started'
    assert classify_native_history(SimpleNamespace(events=[call]), None, None, 'worker').status == 'outcome_unknown'
    assert classify_native_history(SimpleNamespace(events=[call]), 'invocation', 'missing', 'worker').status == 'outcome_unknown'
