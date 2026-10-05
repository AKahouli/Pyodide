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
