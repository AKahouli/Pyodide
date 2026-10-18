"""Real foreground Workflow -> private HTTP admission -> native boundary.

The backend store/signature boundary is covered by the companion RSA HTTP
suite; this suite treats proofs as opaque and checks they never enter model data.
"""
import asyncio
import hashlib
import json
from types import SimpleNamespace

import httpx
import pytest
from google.adk.agents.llm_agent import LlmAgent
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from src.root_runtime import delegate_resolver as authority
from src.root_runtime import dispatcher
from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1


class Scripted(BaseLlm):
    def __init__(self, parts):
        super().__init__(model='scripted-child-authority')
        object.__setattr__(self, 'parts', parts)
        object.__setattr__(self, 'requests', [])
    async def generate_content_async(self, request, stream=False):
        self.requests.append(request)
        yield LlmResponse(content=types.Content(role='model', parts=[self.parts[min(len(self.requests) - 1, len(self.parts) - 1)]]))


def call(name, args):
    return types.Part(function_call=types.FunctionCall(name=name, args=args, id='native-call'))


@pytest.mark.parametrize('temporary', [False, True])
@pytest.mark.parametrize('missing_proof', [False, True])
def test_admitted_foreground_child_has_distinct_native_proof_and_parent_callbacks(monkeypatch, temporary, missing_proof):
    scope = ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id='1' * 24, immutable_snapshot_ref='root-digest')
    parent = authority._RootAuthority(scope.execution_id, 'parent-proof')
    proofs, native_calls, callbacks, models = {}, [], [], []
    revoked = False
    real_client = httpx.AsyncClient
    monkeypatch.setattr(authority, 'get_settings', lambda: SimpleNamespace(API_URL='http://backend/api', ADK_ROOT_RUNTIME_SERVICE_TOKEN='root-machine'))
    def backend(request):
        nonlocal revoked
        token = request.headers.get('X-YellowStorm-Execution-Authority')
        payload = json.loads(request.content or b'{}')
        assert b'parent-proof' not in request.content and b'child-proof-' not in request.content
        if request.url.path.endswith(('delegate-definition', 'temporary-definition')):
            assert token == 'parent-proof'
            child_id = hashlib.sha256(f'{scope.execution_id}:{payload["nativeCallBranch"]}'.encode()).hexdigest()[:24]
            proof = f'child-proof-{child_id}'
            proofs[child_id] = proof
            return httpx.Response(201, headers={} if missing_proof else {'X-YellowStorm-Child-Authority': proof}, json={'executionId': child_id,
                'definition': {'id': child_id if temporary else 'worker-B', 'name': 'worker', 'prompt': '', 'tools': [],
                    'chatbot': {'model': 'test-native'}, 'brain_context': [{'workspace_id': 'workspace-B', 'workspace_name': 'B'}],
                    'agent_params': {'params': {}}}})
        if request.url.path == '/native/import-url':
            # Native worker B is intentionally outside conversation A. Parent A
            # cannot borrow B's grant. Selected revocation is independent of A.
            assert payload['workspaceId'] == 'workspace-B'
            admitted = token in proofs.values()
            status = 201 if admitted and not revoked else 403
            native_calls.append((token, status))
            revoked = True
            return httpx.Response(status, json={'accepted': status == 201})
        assert '/children/' in request.url.path and request.url.path.endswith('/lifecycle')
        assert token == 'parent-proof'
        callbacks.append(token)
        return httpx.Response(201, json={'status': payload['status']})
    class Client(real_client):
        def __init__(self, *args, **kwargs):
            kwargs.setdefault('transport', httpx.MockTransport(backend))
            super().__init__(*args, **kwargs)
    monkeypatch.setattr(authority.httpx, 'AsyncClient', Client)

    async def native_probe():
        results = []
        for _ in range(2):
            async with httpx.AsyncClient() as client:
                response = await client.post('http://backend/native/import-url', headers=await authority.native_actor_headers(),
                    json={'workspaceId': 'workspace-B'})
                results.append(response.status_code)
        assert results == [201, 403]
        return {'accepted': True, 'revocation_denied': True}
    async def compile_candidate(team, request, candidate, child_scope, authorize=None):
        assert (await authority.native_actor_headers())['X-YellowStorm-Execution-Authority'] == proofs[child_scope.execution_id]
        model = Scripted([call('native_probe', {}), types.Part(text='worker finished')])
        models.append(model)
        return LlmAgent(name='worker', model=model, tools=[native_probe])
    monkeypatch.setattr(dispatcher, '_compile_candidate', compile_candidate)
    context = {'root_agent_id': 'root-agent', 'max_depth': 1, 'delegate_definition_mode': 'lazy',
        'temporary_workers_enabled': temporary,
        'catalog': [{'agent_id': 'worker-B', 'name': 'B', 'snapshot_digest': 'worker-digest', 'configuration_mode': 'native'}]}
    request = SimpleNamespace(session_id='conversation-A', execution_scope=scope)
    tool = dispatcher.build_worker_dispatcher(SimpleNamespace(current_queue=None), request, context, [], scope, temporary)[0]
    model = Scripted([call('spawn_temporary_worker' if temporary else 'delegate_to_agent',
        {'task': 'bounded'} if temporary else {'agent_id': 'worker-B', 'task': 'bounded'}), types.Part(text='root finished')])
    models.append(model)
    async def run():
        binding = authority._root_authority.set(parent)
        try:
            sessions = InMemorySessionService()
            await sessions.create_session(app_name='child-authority', user_id='actor', session_id='conversation-A')
            runner = Runner(agent=LlmAgent(name='root', model=model, tools=[tool]), app_name='child-authority', session_service=sessions)
            events = [event async for event in runner.run_async(user_id='actor', session_id='conversation-A',
                new_message=types.Content(role='user', parts=[types.Part(text='go')]))]
            assert any(event.is_final_response() for event in events)
            assert authority._native_child_authority.get() is None
            assert (await authority.native_actor_headers())['X-YellowStorm-Execution-Authority'] == 'parent-proof'
        finally: authority._root_authority.reset(binding)
    asyncio.run(run())
    assert [status for _, status in native_calls] == ([] if missing_proof else [201, 403])
    assert callbacks == ([] if missing_proof else ['parent-proof'])
    assert len(models) == (1 if missing_proof else 2)
    for llm in models:
        rendered = str(llm.requests)
        assert 'child-proof-' not in rendered and 'parent-proof' not in rendered


def test_parallel_child_contexts_are_isolated_and_cleanup_does_not_replace_parent(monkeypatch):
    monkeypatch.setattr(authority, 'get_settings', lambda: SimpleNamespace(ADK_ROOT_RUNTIME_SERVICE_TOKEN='root-machine'))
    parent = authority._RootAuthority('root', 'parent', child_proofs={'one': 'one-proof', 'two': 'two-proof'})
    cleaned = set()
    async def heartbeat(holder):
        try: await asyncio.Event().wait()
        finally: cleaned.add(holder.execution_id)
    monkeypatch.setattr(authority, '_child_heartbeat', heartbeat)
    async def run():
        binding = authority._root_authority.set(parent)
        try:
            async def child(identity):
                async with authority.foreground_child_authority(identity):
                    await asyncio.sleep(0)
                    assert (await authority.native_actor_headers())['X-YellowStorm-Execution-Authority'] == identity + '-proof'
                    assert (await authority.root_authority_headers())['X-YellowStorm-Execution-Authority'] == 'parent'
            await asyncio.gather(child('one'), child('two'))
            assert cleaned == {'one', 'two'}
            assert authority._native_child_authority.get() is None
            with pytest.raises(ValueError, match='Privately admitted'):
                async with authority.foreground_child_authority('naked-selector'): pass
            assert (await authority.native_actor_headers())['X-YellowStorm-Execution-Authority'] == 'parent'
        finally: authority._root_authority.reset(binding)
    asyncio.run(run())


@pytest.mark.parametrize('denied', [False, True])
def test_child_renewal_keeps_child_identity_or_fails_closed_without_parent_fallback(monkeypatch, denied):
    monkeypatch.setattr(authority, 'get_settings', lambda: SimpleNamespace(API_URL='http://backend/api', ADK_ROOT_RUNTIME_SERVICE_TOKEN='root-machine'))
    original_sleep = asyncio.sleep
    ticks, calls = 0, []
    async def tick(delay):
        nonlocal ticks
        if delay == 120:
            ticks += 1
            if ticks > 1: raise asyncio.CancelledError()
            return
        await original_sleep(delay)
    monkeypatch.setattr(authority.asyncio, 'sleep', tick)
    real_client = httpx.AsyncClient
    def backend(request):
        calls.append(request)
        assert request.url.path.endswith('/child/authority/renew')
        assert request.headers['X-YellowStorm-Execution-Authority'] == 'child-proof'
        return httpx.Response(401 if denied else 201, json={} if denied else {'data': {'token': 'renewed-child-proof'}})
    class Client(real_client):
        def __init__(self, *args, **kwargs):
            kwargs.setdefault('transport', httpx.MockTransport(backend))
            super().__init__(*args, **kwargs)
    monkeypatch.setattr(authority.httpx, 'AsyncClient', Client)
    async def run():
        root_binding = authority._root_authority.set(authority._RootAuthority('parent', 'parent-proof'))
        holder = authority._RootAuthority('child', 'child-proof')
        child_binding = authority._native_child_authority.set(holder)
        try:
            if denied:
                await authority._child_heartbeat(holder)
                assert holder.failed
                with pytest.raises(ValueError): await authority.native_actor_headers()
            else:
                with pytest.raises(asyncio.CancelledError): await authority._child_heartbeat(holder)
                assert (await authority.native_actor_headers())['X-YellowStorm-Execution-Authority'] == 'renewed-child-proof'
            assert (await authority.root_authority_headers())['X-YellowStorm-Execution-Authority'] == 'parent-proof'
        finally:
            authority._native_child_authority.reset(child_binding)
            authority._root_authority.reset(root_binding)
    asyncio.run(run())
    assert len(calls) == 1
