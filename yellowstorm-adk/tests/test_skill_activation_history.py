"""Successful skill bodies stay usable while their activation choices disappear."""
import pytest
from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from src.skills.runtime import make_activate_skill_tool, limit_loaded_skill_activation
from tests.wp04.test_delegate_dispatcher import _Scripted, _fc, _text


@pytest.mark.asyncio
async def test_loaded_skills_are_removed_without_hiding_remaining_skills_or_research():
    skills = [{'name': name, 'instructions': name + ' instructions'} for name in ('first', 'second')]
    activate = make_activate_skill_tool(skills)
    def research(query: str) -> str:
        return query

    def load_remaining(req):
        declarations = [declaration for tool in req.config.tools or []
            for declaration in tool.function_declarations or []]
        declaration = next(item for item in declarations if item.name == 'activate_skill')
        enum = (declaration.parameters_json_schema['properties']['name']['enum']
            if declaration.parameters_json_schema is not None else declaration.parameters.properties['name'].enum)
        assert enum == ['second']
        assert 'research' in req.tools_dict
        return _fc('activate_skill', {'name': 'second'})

    def finish(req):
        assert 'activate_skill' not in req.tools_dict
        assert 'research' in req.tools_dict
        bodies = [part.function_response.response['result']
            for content in req.contents for part in content.parts or [] if part.function_response is not None]
        assert len(bodies) == 2
        assert 'first instructions' in bodies[0] and 'second instructions' in bodies[1]
        return _text('Done')

    model = _Scripted('skills', [_fc('activate_skill', {'name': 'first'}), load_remaining, finish])
    agent = LlmAgent(name='worker', model=model, tools=[activate, research],
        before_model_callback=limit_loaded_skill_activation)
    sessions = InMemorySessionService()
    await sessions.create_session(app_name='skills_test', user_id='user', session_id='session')
    runner = Runner(app_name='skills_test', agent=agent, session_service=sessions)
    events = [event async for event in runner.run_async(user_id='user', session_id='session',
        new_message=types.Content(role='user', parts=[types.Part(text='Execute bounded research')]))]
    assert len(model.requests) == 3
    assert any(part.text == 'Done' for event in events if event.content for part in event.content.parts or [])
