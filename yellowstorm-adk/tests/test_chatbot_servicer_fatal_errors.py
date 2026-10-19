from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest
from src.grpc_generated import chatbot_pb2
from src.grpc_server import chatbot_servicer
from src.grpc_server.chatbot_servicer import ChatbotServicer


@pytest.mark.asyncio
@pytest.mark.parametrize('single', [True, False])
@pytest.mark.parametrize('partial', [True, False])
async def test_fatal_is_safe_non_ok_and_drains_partial(monkeypatch, native_dispatch_authority, single, partial):
    agent = chatbot_pb2.Agent(id='a', name='Agent', agent_type='manager')
    request = (chatbot_pb2.RunSingleAgentRequest(agent=agent) if single else chatbot_pb2.RunAgentTeamRequest(agents=[agent]))
    request.conversation_id = 'conversation'
    async def produce(_request, queue):
        if partial:
            await queue.put({'action': 'add', 'metadata': {'message_id': 'conversation'}, 'component': {'id': 'partial', 'type': 'text', 'data': {'content': 'partial answer'}}})
        await queue.put({'action': 'end'})
        raise RuntimeError('SECRET_API_KEY https://private/?sig=SECRET SELECT password C:\\private\\file')
    servicer = ChatbotServicer(MagicMock(process_team_request=AsyncMock(side_effect=produce)))
    converter = '_convert_single_agent_request' if single else '_convert_agent_team_request_v2'
    monkeypatch.setattr(servicer, converter, AsyncMock(return_value=SimpleNamespace(correction_replay_context=None, attached_files=[], session_id='conversation')))
    class Aborted(Exception):
        pass
    context = MagicMock(abort=AsyncMock(side_effect=Aborted))
    context.invocation_metadata.return_value = (('x-yellowstorm-native-authority', native_dispatch_authority('conversation')),)
    chunks = []
    with pytest.raises(Aborted):
        async for chunk in getattr(servicer, 'RunSingleAgent' if single else 'RunAgentTeam')(request, context):
            chunks.append(chunk)
    context.abort.assert_awaited_once_with(grpc.StatusCode.INTERNAL, 'EXECUTION_FAILED')
    wire = str(chunks)
    assert 'SECRET' not in wire and 'SELECT' not in wire and 'private' not in wire
    assert ('partial answer' in wire) == partial
    assert not any(chunk.action == 'end' for chunk in chunks)


@pytest.mark.parametrize('pb_request', [chatbot_pb2.RunAgentTeamRequest(query='secret'), chatbot_pb2.RunSingleAgentRequest(query='secret')])
def test_request_summary_never_converts_protobuf(monkeypatch, pb_request):
    monkeypatch.setattr(chatbot_servicer, '_message_to_dict', MagicMock(side_effect=AssertionError('must not serialize')))
    summary = ChatbotServicer._serialize_run_agent_team_request(pb_request)
    assert summary['query_length'] == 6
    assert 'secret' not in str(summary)


@pytest.mark.asyncio
@pytest.mark.parametrize('single', [True, False])
async def test_validation_failure_is_safe_before_producer(monkeypatch, native_dispatch_authority, single):
    pb_request = chatbot_pb2.RunSingleAgentRequest() if single else chatbot_pb2.RunAgentTeamRequest()
    servicer = ChatbotServicer(MagicMock())
    converter = '_convert_single_agent_request' if single else '_convert_agent_team_request_v2'
    monkeypatch.setattr(servicer, converter, AsyncMock(side_effect=ValueError('SECRET_API_KEY private-path ?sig=secret')))
    class Aborted(Exception):
        pass
    context = MagicMock(abort=AsyncMock(side_effect=Aborted))
    context.invocation_metadata.return_value = (('x-yellowstorm-native-authority', native_dispatch_authority('conversation')),)
    chunks = []
    with pytest.raises(Aborted):
        async for chunk in getattr(servicer, 'RunSingleAgent' if single else 'RunAgentTeam')(pb_request, context):
            chunks.append(chunk)
    context.abort.assert_awaited_once_with(grpc.StatusCode.INVALID_ARGUMENT, 'VALIDATION_ERROR')
    assert 'SECRET' not in str(chunks)
    servicer.agent_team_service.process_team_request.assert_not_called()
