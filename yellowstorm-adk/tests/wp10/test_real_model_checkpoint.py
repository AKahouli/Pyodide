"""Opt-in actual provider plus durable fenced ADK checkpoint qualification."""
import os
from pathlib import Path

import pytest
from dotenv import dotenv_values
from google.adk.agents import LlmAgent
from google.adk.apps import App
from google.adk.apps.app import ResumabilityConfig
from google.adk.runners import Runner
from google.genai import types
from sqlalchemy import text

from tests.wp07.test_background_sessions import guarded_native
from tests.wp09.test_background_synthesis import owned_synthesis


@pytest.mark.skipif(os.getenv('VECTOR_REAL_MODEL_QUALIFY') != '1', reason='Explicit real-provider opt-in required')
@pytest.mark.asyncio
async def test_real_provider_fenced_checkpoint_recovers_without_redispatch(guarded_native, monkeypatch):
    from src.config.settings import Settings
    from src.root_runtime.background_recovery import classify_native_history
    from src.root_runtime.model_capacity import CapacityClient, ModelCapacity
    from src.smart_rag.infrastructure.factories import llm_factory

    service, _session, grant, engine = guarded_native
    local = dotenv_values(Path(__file__).resolve().parents[2] / '.env')
    settings = Settings(_env_file=None, **{key: value for key, value in local.items() if value is not None})
    settings.ROOT_WORK_LLM_CAPACITY_ENABLED = False
    monkeypatch.setattr(llm_factory, 'app_settings', settings)
    monkeypatch.setattr('src.config.settings.get_settings', lambda: settings)
    model = llm_factory.LLMFactory.create_no_tool_calls_llm('gpt-6-luna', temperature=None,
        max_completion_tokens=128, num_retries=0)
    object.__setattr__(model, 'llm_client', CapacityClient(model.llm_client, ModelCapacity(engine)))
    agent = LlmAgent(name='qualification_worker', model=model,
        instruction='Return the user marker exactly. No tools or explanation.')
    app = App(name=grant.app_name, root_agent=agent, resumability_config=ResumabilityConfig(is_resumable=True))
    runner = Runner(app=app, session_service=service)
    marker = 'VECTORREALCHECKPOINT'
    events = [event async for event in runner.run_async(user_id=grant.actor_id, session_id=grant.session_id,
        new_message=types.Content(role='user', parts=[types.Part(text=marker)]))]
    assert events
    control = await service.control_state()
    persisted = await service.get_session(app_name=grant.app_name, user_id=grant.actor_id, session_id=grant.session_id)
    recovered = classify_native_history(persisted, control['native_invocation_id'],
        control['initial_input_event_id'], agent.name)
    assert recovered.status == 'completed' and marker in recovered.text
    # Recovery is classification of the original committed native invocation,
    # not another model run masquerading as a successful replay.
    from dataclasses import replace
    from src.root_runtime.background_sessions import FencedBackgroundSessionService
    fresh = FencedBackgroundSessionService(replace(grant, resume_intent='resume'), db_engine=engine)
    restored = await fresh.get_session(app_name=grant.app_name, user_id=grant.actor_id, session_id=grant.session_id)
    assert classify_native_history(restored, control['native_invocation_id'],
        control['initial_input_event_id'], agent.name) == recovered
    async with engine.connect() as connection:
        assert (await connection.execute(text("SELECT count(*) FROM conversation.root_model_slots WHERE status <> 'free'"))).scalar_one() == 0


@pytest.mark.skipif(os.getenv('VECTOR_REAL_MODEL_QUALIFY') != '1', reason='Explicit real-provider opt-in required')
@pytest.mark.asyncio
async def test_real_factory_pinned_synthesis_with_actual_provider_and_native_checkpoint(owned_synthesis, monkeypatch):
    import asyncio
    from src.config.settings import Settings
    from src.schema.chatbot_schema import AgentSuggestion, RunAgentTeamRequest
    from src.root_runtime import model_capacity
    from src.root_runtime.background_synthesis import run_owned_synthesis
    from src.smart_rag.infrastructure.factories import llm_factory
    service, scope = owned_synthesis
    # The repository's autouse fixture mocks google.adk.Agent; this opt-in
    # qualification must restore the real class before factory construction.
    monkeypatch.setattr('google.adk.Agent', LlmAgent)
    from src.smart_rag.agents.factories import base_factory
    monkeypatch.setattr(base_factory, 'Agent', LlmAgent)
    local = dotenv_values(Path(__file__).resolve().parents[2] / '.env')
    settings = Settings(_env_file=None, **{key: value for key, value in local.items() if value is not None})
    settings.ROOT_WORK_LLM_CAPACITY_ENABLED = True
    monkeypatch.setattr(llm_factory, 'app_settings', settings)
    monkeypatch.setattr('src.config.settings.get_settings', lambda: settings)
    monkeypatch.setattr(model_capacity, '_default', model_capacity.ModelCapacity(service.db_engine))
    model = {'provider': 'gpt-6-luna', 'name': 'GPT 6 Luna'}
    candidate = AgentSuggestion(id=service.grant.actor_id, name='QualificationSynthesis',
        description='Synthetic qualification only', prompt='Summarize the supplied synthetic terminal result.',
        tools=[], chatbot_name=model, save_memory=False)
    request = RunAgentTeamRequest(user_id=service.grant.actor_id, session_id=service.grant.session_id,
        message='The sealed manifest contains one completed worker result: VECTORREALSYNTHESIS. Return that marker only.',
        chatbot_name=model, agents=[candidate], agent_mode='multi_agent', execution_scope=scope)
    async with asyncio.timeout(90):
        output = await run_owned_synthesis(service, request, asyncio.Queue(), asyncio.Event())
    assert 'VECTORREALSYNTHESIS' in output
    control = await service.control_state()
    assert control['native_invocation_id'] and control['initial_input_event_id']
    async with service.db_engine.connect() as connection:
        assert (await connection.execute(text("SELECT count(*) FROM conversation.root_model_slots WHERE status <> 'free'"))).scalar_one() == 0
