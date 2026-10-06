import asyncio
from types import SimpleNamespace

import pytest
from google.genai import types

from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1
from src.root_runtime.evidence_capture import capture_citation, collect_evidence, install_evidence_capture


def test_shared_tool_cannot_keep_another_execution_owner():
    from google.adk.tools import FunctionTool

    def tool():
        return 'ok'

    shared = FunctionTool(tool)
    install_evidence_capture(SimpleNamespace(tools=[shared]), ExecutionScopeV1(execution_id='first'))
    with pytest.raises(ValueError, match='another execution'):
        install_evidence_capture(SimpleNamespace(tools=[shared]), ExecutionScopeV1(execution_id='second'))


@pytest.mark.asyncio
async def test_tool_failure_resets_producer_context():
    from google.adk.tools import FunctionTool

    async def fail():
        capture_citation('before-error', 1, {'title': 'registered'})
        raise RuntimeError('tool failed')

    agent = SimpleNamespace(tools=[FunctionTool(fail)])
    install_evidence_capture(agent, ExecutionScopeV1(role=ExecutionRole.LIBRARY_WORKER, execution_id='child'))
    context = SimpleNamespace(function_call_id='call', state={})
    with pytest.raises(RuntimeError, match='tool failed'):
        await agent.tools[0].run_async(args={}, tool_context=context)
    capture_citation('after-error', 2, {'title': 'outside'})
    assert [item['identity'] for item in collect_evidence(context.state, 'child')] == ['before-error']


@pytest.mark.asyncio
@pytest.mark.parametrize('success,valid_path', [(True, True), (False, True), (True, False)])
async def test_actual_run_code_only_captures_successful_verified_written_files(monkeypatch, success, valid_path):
    import json
    from google.adk.tools import FunctionTool
    from src.smart_rag.tools.utilities import run_code as module

    monkeypatch.setattr(module, 'run_code_globally_enabled', lambda: True)

    async def execute(_self, **kwargs):
        return {'ok': success, 'written_files': [{'name': 'report.txt',
            'path': '/workspace/run/report.txt' if valid_path else '/workspace/run/../secret',
            'sizeBytes': 3}]}

    monkeypatch.setattr(module.RunCodeClient, 'execute', execute)
    tool = module.create_run_code_tool({'run_code_context_json': json.dumps({
        'userId': 'owner', 'runId': 'conversation', 'mounts': [{ 'virtualPath': '/workspace/run',
            'cephPrefix': 'owner/system_conversation', 'mode': 'rw' }]})})
    agent = SimpleNamespace(tools=[FunctionTool(tool)])
    install_evidence_capture(agent, ExecutionScopeV1(role=ExecutionRole.LIBRARY_WORKER, execution_id='child'))
    context = SimpleNamespace(function_call_id='call', state={})
    await agent.tools[0].run_async(args={'description': 'write', 'code': 'return {};'}, tool_context=context)
    records = collect_evidence(context.state, 'child')
    assert len(records) == int(success and valid_path)
    if records:
        assert records[0]['payload']['file_path'] == 'owner/system_conversation/report.txt'


@pytest.mark.asyncio
@pytest.mark.parametrize('status,document', [(201, {'id': 'doc', 'filePath': 'owner/workspace/report.txt'}),
    (500, {'id': 'doc', 'filePath': 'owner/workspace/report.txt'}), (201, {'id': 'doc'})])
async def test_actual_upload_requires_http_success_and_verified_document_path(monkeypatch, status, document):
    import httpx
    from google.adk.tools import FunctionTool
    from src.smart_rag.tools.utilities.connector_tools import create_save_file_to_workspace

    real_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: real_client(
        transport=httpx.MockTransport(lambda request: httpx.Response(status, json={'document': document})), **kwargs))
    tool = create_save_file_to_workspace({'platform_api_url': 'https://platform.test/api',
        'platform_api_token': 'test-internal', 'user_id': 'owner'})
    agent = SimpleNamespace(tools=[FunctionTool(tool)])
    install_evidence_capture(agent, ExecutionScopeV1(role=ExecutionRole.LIBRARY_WORKER, execution_id='child'))
    context = SimpleNamespace(function_call_id='call', state={})
    await agent.tools[0].run_async(args={'download_url': 'https://file.test/report',
        'workspace_id': 'workspace', 'filename': 'report.txt'}, tool_context=context)
    records = collect_evidence(context.state, 'child')
    assert len(records) == int(status == 201 and 'filePath' in document)
    assert 'test-internal' not in str(records)


@pytest.mark.asyncio
@pytest.mark.parametrize('durable', [False, True])
async def test_parallel_child_tool_evidence_survives_native_wait_and_fresh_runner(monkeypatch, tmp_path, durable):
    from google.adk.agents import LlmAgent
    from google.adk.apps import App
    from google.adk.apps.app import ResumabilityConfig
    from google.adk.events.request_input import RequestInput
    from google.adk.models.base_llm import BaseLlm
    from google.adk.models.llm_response import LlmResponse
    from google.adk.runners import Runner
    from google.adk.sessions import DatabaseSessionService, InMemorySessionService
    from google.adk.workflow import FunctionNode
    from google.adk.workflow.utils._workflow_hitl_utils import create_request_input_response
    from src.smart_rag.infrastructure.session.citation_manager import SessionCitationManager

    manager = SessionCitationManager.__new__(SessionCitationManager)
    manager.lock = asyncio.Lock()
    manager.citation_cache = {'cached': 7}

    async def add_citation(tag, source):
        return 8

    manager.global_manager = SimpleNamespace(add_citation=add_citation)
    executions = []

    class Scripted(BaseLlm):
        def __init__(self):
            super().__init__(model='evidence-test')
            object.__setattr__(self, 'calls', 0)

        async def generate_content_async(self, request, stream=False):
            object.__setattr__(self, 'calls', self.calls + 1)
            part = types.Part(function_call=types.FunctionCall(id='source-call', name='search', args={})) \
                if self.calls == 1 else types.Part(text='done')
            yield LlmResponse(content=types.Content(role='model', parts=[part]))

    workers = []
    for identity in ('child_a', 'child_b'):
        async def search(tool_context, identity=identity):
            executions.append(identity)
            await manager.register_source('cached', {'title': 'cached', 'secret': 'never persist'})
            await manager.register_source('new', {'title': 'new'})
            await asyncio.sleep(0)
            return 'found'

        # ToolContext must have the public type annotation for SDK injection.
        from google.adk.tools import ToolContext
        search.__annotations__['tool_context'] = ToolContext
        worker = LlmAgent(name=identity, model=Scripted(), tools=[search])
        install_evidence_capture(worker, ExecutionScopeV1(role=ExecutionRole.LIBRARY_WORKER, execution_id=identity))
        workers.append(worker)

    async def root(ctx):
        await asyncio.gather(*(ctx.run_node(worker, node_input='go', run_id=worker.name) for worker in workers))
        assert len(collect_evidence(ctx.state.to_dict(), 'child_a')) == 2
        assert len(collect_evidence(ctx.state.to_dict(), 'child_b')) == 2
        if 'answer' not in ctx.resume_inputs:
            return RequestInput(interrupt_id='answer', message='Continue?')
        return 'complete'

    app = App(name='capture_test', root_agent=FunctionNode(func=root, name='root', rerun_on_resume=True),
        resumability_config=ResumabilityConfig(is_resumable=True))
    database_url = f"sqlite+aiosqlite:///{(tmp_path / 'native-evidence.db').as_posix()}"
    sessions = DatabaseSessionService(db_url=database_url) if durable else InMemorySessionService()
    await sessions.create_session(app_name='capture_test', user_id='user', session_id='session')
    runner = Runner(app=app, session_service=sessions)
    first = [event async for event in runner.run_async(user_id='user', session_id='session',
        new_message=types.Content(role='user', parts=[types.Part(text='go')]))]
    session = await sessions.get_session(app_name='capture_test', user_id='user', session_id='session')
    for identity in ('child_a', 'child_b'):
        records = collect_evidence(session.state, identity)
        assert len(records) == 2
        assert {item['identity'] for item in records} == {'cached', 'new'}
        assert all(item['nativeIdentity'] == 'source-call' for item in records)
        assert 'secret' not in str(records)
    if durable:
        await sessions.close()
        sessions = DatabaseSessionService(db_url=database_url)
    second_runner = Runner(app=app, session_service=sessions)
    second = [event async for event in second_runner.run_async(user_id='user', session_id='session',
        invocation_id=first[0].invocation_id, new_message=types.Content(role='user', parts=[
            create_request_input_response('answer', {'result': True})]))]
    assert second and sorted(executions) == ['child_a', 'child_b']
    capture_citation('outside', 9, {'title': 'must not attach'})
    restored = await sessions.get_session(app_name='capture_test', user_id='user', session_id='session')
    assert len(collect_evidence(restored.state, 'child_a')) == 2
    if durable:
        await sessions.close()
