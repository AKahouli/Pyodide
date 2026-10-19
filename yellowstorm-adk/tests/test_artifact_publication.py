import base64
import asyncio
import json
import time
from types import SimpleNamespace

import pytest
import httpx
from src.flow_engine.runtime import artifact_publication as publication

from src.flow_engine.runtime.artifact_publication import (
    MAX_ARTIFACT_BYTES,
    decode_artifact_base64,
)


def test_decode_artifact_base64_accepts_bounded_content() -> None:
    assert decode_artifact_base64(base64.b64encode(b"pdf").decode("ascii")) == b"pdf"


def test_decode_artifact_base64_accepts_normalized_mcp_result() -> None:
    assert decode_artifact_base64({"result": base64.b64encode(b"pdf").decode("ascii"), "text": "suppressed"}) == b"pdf"


@pytest.mark.parametrize("payload", ["", "not-base64!"])
def test_decode_artifact_base64_rejects_invalid_content(payload: str) -> None:
    with pytest.raises(ValueError):
        decode_artifact_base64(payload)


def test_decode_artifact_base64_rejects_oversized_content() -> None:
    payload = base64.b64encode(b"x" * (MAX_ARTIFACT_BYTES + 1)).decode("ascii")
    with pytest.raises(ValueError, match="10 MB"):
        decode_artifact_base64(payload)


def _proof(expires_in=300):
    # Parsing expiry in ADK is scheduling only; real RSA verification is covered
    # by the backend HTTP suite. A forged proof never grants backend authority.
    payload = base64.urlsafe_b64encode(json.dumps({'exp': time.time() + expires_in}).encode()).decode().rstrip('=')
    return f'header.{payload}.signature'


def test_dispatch_private_context_scoped_headers_refresh_and_cleanup(monkeypatch):
    calls = []
    renewed = _proof(400)
    monkeypatch.setattr(publication, 'get_settings', lambda: SimpleNamespace(API_URL='http://backend/api',
        ADK_PLAYBOOK_ARTIFACT_SERVICE_TOKEN='artifact-only-machine-secret', INTERNAL_SERVICE_SECRET='must-not-be-used'))
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, **kwargs):
            calls.append((url, kwargs))
            if url.endswith('/renew'):
                return httpx.Response(201, json={'data': {'token': renewed}})
            return httpx.Response(201, json={'artifactId': 'a' * 32, 'mimeType': 'application/pdf', 'size': 3})
    monkeypatch.setattr(publication.httpx, 'AsyncClient', Client)
    class Runtime:
        @publication.with_artifact_authority
        async def Run(self, request, context):
            yield await publication.publish_playbook_artifact(payload=base64.b64encode(b'pdf').decode(),
                filename='report.pdf', execution_id=request.execution_id, user_id=request.owner_id)
    async def run():
        request = SimpleNamespace(execution_id='execution-1', owner_id='actor-1', input_context={})
        context = SimpleNamespace(invocation_metadata=lambda: [('x-yellowstorm-artifact-authority', _proof(5))])
        result = [value async for value in Runtime().Run(request, context)]
        assert result[0]['artifactId'] == 'a' * 32
        assert publication._authority.get() is None
        assert request.input_context == {}
    asyncio.run(run())
    assert len(calls) == 2
    assert calls[0][0].endswith('/executions/execution-1/authority/renew')
    headers = calls[1][1]['headers']
    assert headers['X-YellowStorm-Service-Principal'] == 'adk-playbook-artifact'
    assert headers['X-YellowStorm-Service-Token'] == 'artifact-only-machine-secret'
    assert headers['X-YellowStorm-Execution-Authority'] == renewed
    assert 'X-Internal-Token' not in headers


@pytest.mark.parametrize('metadata', [None, [], [('x-yellowstorm-artifact-authority', 'one'), ('x-yellowstorm-artifact-authority', 'two')]])
def test_missing_or_duplicate_dispatch_proof_never_starts_runtime(metadata):
    started = []
    class Runtime:
        @publication.with_artifact_authority
        async def Run(self, request, context):
            started.append(True)
            yield 'started'
    async def run():
        with pytest.raises(ValueError, match='dispatch artifact authority'):
            async for _ in Runtime().Run(SimpleNamespace(execution_id='exec', owner_id='actor'),
                    None if metadata is None else SimpleNamespace(invocation_metadata=lambda: metadata)): pass
        assert not started
    asyncio.run(run())


def test_no_dispatch_or_foreign_execution_context_cannot_publish(monkeypatch):
    monkeypatch.setattr(publication, 'get_settings', lambda: SimpleNamespace(API_URL='http://backend/api'))
    async def run():
        with pytest.raises(ValueError, match='not configured'):
            await publication.publish_playbook_artifact(payload='cGRm', filename='a.pdf', execution_id='foreign', user_id='actor')
        binding = publication._authority.set(publication._PublicationAuthority('owned', 'actor', _proof()))
        try:
            with pytest.raises(ValueError, match='not configured'):
                await publication.publish_playbook_artifact(payload='cGRm', filename='a.pdf', execution_id='foreign', user_id='actor')
            with pytest.raises(ValueError, match='not configured'):
                await publication.publish_playbook_artifact(payload='cGRm', filename='a.pdf', execution_id='owned', user_id='foreign')
        finally: publication._authority.reset(binding)
    asyncio.run(run())


def test_revoked_renewal_fails_closed_without_upload(monkeypatch):
    calls = []
    monkeypatch.setattr(publication, 'get_settings', lambda: SimpleNamespace(API_URL='http://backend/api',
        ADK_PLAYBOOK_ARTIFACT_SERVICE_TOKEN='artifact-only-machine-secret'))
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, **kwargs):
            calls.append(url)
            return httpx.Response(401, json={'message': 'denied'})
    monkeypatch.setattr(publication.httpx, 'AsyncClient', Client)
    async def run():
        authority = publication._PublicationAuthority('owned', 'actor', _proof(1))
        binding = publication._authority.set(authority)
        try:
            with pytest.raises(ValueError, match='renewal was denied'):
                await publication.publish_playbook_artifact(payload='cGRm', filename='a.pdf', execution_id='owned', user_id='actor')
            assert authority.failed
        finally: publication._authority.reset(binding)
    asyncio.run(run())
    assert len(calls) == 1 and calls[0].endswith('/renew')


def test_real_grpc_metadata_ingestion_concurrent_context_isolation_and_cleanup(monkeypatch):
    import grpc
    from src.grpc_generated import playbook_flow_pb2 as pb, playbook_flow_pb2_grpc as wire
    monkeypatch.setattr(publication, 'get_settings', lambda: SimpleNamespace(API_URL='http://backend/api',
        ADK_PLAYBOOK_ARTIFACT_SERVICE_TOKEN='test-only-artifact-machine-key'))
    seen = {}
    class Runtime(wire.PlaybookFlowRuntimeServicer):
        @publication.with_artifact_authority
        async def Run(self, request, context):
            current = publication._authority.get()
            await asyncio.sleep(0.02)  # Interleave two real HTTP/2 RPC tasks.
            assert publication._authority.get() is current
            assert current.execution_id == request.execution_id and current.user_id == request.owner_id
            seen[request.execution_id] = current.token
            yield pb.RunEvent(execution_id=request.execution_id, event_type='ExecutionCompleted')
    async def run():
        server = grpc.aio.server()
        wire.add_PlaybookFlowRuntimeServicer_to_server(Runtime(), server)
        port = server.add_insecure_port('127.0.0.1:0')
        await server.start()
        try:
            async with grpc.aio.insecure_channel(f'127.0.0.1:{port}') as channel:
                stub = wire.PlaybookFlowRuntimeStub(channel)
                async def invoke(identity):
                    request = pb.RunRequest(execution_id=identity, owner_id=f'actor-{identity}')
                    return [event async for event in stub.Run(request,
                        metadata=(('x-yellowstorm-artifact-authority', f'proof-{identity}'),))]
                results = await asyncio.gather(invoke('one'), invoke('two'))
                assert [events[0].execution_id for events in results] == ['one', 'two']
                for metadata in [(), (('x-yellowstorm-artifact-authority', 'one'), ('x-yellowstorm-artifact-authority', 'two'))]:
                    with pytest.raises(grpc.aio.AioRpcError):
                        async for _ in stub.Run(pb.RunRequest(execution_id='denied', owner_id='actor'), metadata=metadata): pass
            assert publication._authority.get() is None
        finally: await server.stop(0)
    asyncio.run(run())
    assert seen == {'one': 'proof-one', 'two': 'proof-two'}
