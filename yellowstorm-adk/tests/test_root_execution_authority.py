import asyncio
import base64
import contextlib
import json
from types import SimpleNamespace

import grpc
import pytest
from src.root_runtime import delegate_resolver as authority
from src.grpc_generated import chatbot_pb2 as pb, chatbot_pb2_grpc as wire


def test_real_grpc_root_and_normal_native_metadata_are_private_and_isolated(monkeypatch):
    monkeypatch.setattr(authority, 'get_settings', lambda: SimpleNamespace(ADK_ROOT_RUNTIME_SERVICE_TOKEN='root-machine', API_URL='http://backend/api'))
    seen = {}
    class Runtime(wire.ChatbotServiceServicer):
        @authority.with_root_authority
        async def RunSingleAgent(self, request, context):
            current = authority._root_authority.get()
            await asyncio.sleep(0.02)
            assert authority._root_authority.get() is current
            seen[request.conversation_id] = (current.execution_id, current.purpose, await authority.native_actor_headers())
            yield pb.StreamChunk()
    async def run():
        server = grpc.aio.server()
        wire.add_ChatbotServiceServicer_to_server(Runtime(), server)
        port = server.add_insecure_port('127.0.0.1:0')
        await server.start()
        try:
            async with grpc.aio.insecure_channel(f'127.0.0.1:{port}') as channel:
                stub = wire.ChatbotServiceStub(channel)
                async def invoke(identity, root):
                    request = pb.RunSingleAgentRequest(conversation_id=identity)
                    payload = base64.urlsafe_b64encode(json.dumps({'executionId': identity + '-message'}).encode()).decode().rstrip('=')
                    proof = f'header.{payload}.signature'
                    if root: request.execution_scope.execution_id = identity + '-execution'
                    key = 'x-yellowstorm-root-authority' if root else 'x-yellowstorm-native-authority'
                    return [event async for event in stub.RunSingleAgent(request, metadata=((key, proof),))]
                await asyncio.gather(invoke('root', True), invoke('normal', False))
                for metadata in [(), (('x-yellowstorm-root-authority', 'one'), ('x-yellowstorm-root-authority', 'two'))]:
                    request = pb.RunSingleAgentRequest()
                    request.execution_scope.execution_id = 'denied'
                    with pytest.raises(grpc.aio.AioRpcError):
                        async for _ in stub.RunSingleAgent(request, metadata=metadata): pass
            assert authority._root_authority.get() is None
        finally: await server.stop(0)
    asyncio.run(run())
    assert seen['root'][:2] == ('root-execution', 'root-work')
    assert seen['normal'][:2] == ('normal-message', 'native-conversation')
    assert seen['root'][2]['X-YellowStorm-Service-Principal'] == 'adk-root-runtime'
    assert seen['root'][2]['X-YellowStorm-Execution-Authority'] != seen['normal'][2]['X-YellowStorm-Execution-Authority']


def test_background_proof_is_verified_before_claim_and_renewal_survives_observer_disconnect(monkeypatch):
    from src.grpc_server import background_rpc
    calls = []
    monkeypatch.setattr(background_rpc, 'get_settings', lambda: SimpleNamespace(GRPC_API_KEY='grpc-test'))
    async def verify(scope, path, payload):
        assert authority._root_authority.get().token == 'backend-dispatch-proof'
        calls.append('verify')
        return {'token': 'renewed-proof'}
    monkeypatch.setattr(background_rpc, '_post', verify)
    async def run():
        finished, renewing = asyncio.Event(), asyncio.Event()
        async def independent_renewal(holder):
            assert authority._root_authority.get() is holder
            renewing.set()
            await finished.wait()
        monkeypatch.setattr(background_rpc, '_root_heartbeat', independent_renewal)
        async def worker():
            assert authority._root_authority.get().token == 'renewed-proof'
            await finished.wait()
        async def start(request):
            assert calls == ['verify']
            calls.append('claim/start')
            return SimpleNamespace(task=asyncio.create_task(worker()), status='running',
                execution_authority=None, authority_renewal_task=None)
        rpc = background_rpc.BackgroundRpc(None, None)
        rpc.host = SimpleNamespace(start=start)
        async def capabilities(): return SimpleNamespace(background_ready=True, control_database_fingerprint='test-db-identity')
        rpc.capabilities = capabilities
        context = SimpleNamespace(invocation_metadata=lambda: [('x-api-key', 'grpc-test'),
            ('x-yellowstorm-root-authority', 'backend-dispatch-proof')])
        request = SimpleNamespace(execution_id='execution', control_database_fingerprint='test-db-identity')
        observer = rpc.run(request, context)
        await observer.__anext__()
        await renewing.wait()
        await observer.aclose()
        assert authority._root_authority.get() is None
        finished.set()
        await asyncio.sleep(0)
        await asyncio.sleep(0)
    asyncio.run(run())
    assert calls == ['verify', 'claim/start']


def test_missing_dispatch_never_uses_a_generic_machine_secret(monkeypatch):
    monkeypatch.setattr(authority, 'get_settings', lambda: SimpleNamespace(INTERNAL_SERVICE_SECRET='generic'))
    async def run():
        with pytest.raises(ValueError, match='dispatch authority'):
            await authority.root_authority_headers()
        with pytest.raises(ValueError, match='dispatch authority'):
            await authority.native_actor_headers()
    asyncio.run(run())
