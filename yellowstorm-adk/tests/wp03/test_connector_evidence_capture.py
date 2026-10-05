import copy
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from google.adk.agents import LlmAgent

from src.root_runtime.compiler import compile_worker
from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1
from src.root_runtime.evidence_capture import collect_evidence
from src.smart_rag.tools.utilities.connector_tools import ConnectorToolContext, create_connector_tools


# Sanitized shape recorded from the live Smart Navigation locator action receipt.
RESPONSE = json.loads((Path(__file__).parent / 'fixtures/smartnav_locator_response.json').read_text())


async def owned_tool(action='locate_answer_citations', execution='child'):
    binding = {'connector_id': 'connector', 'connector_name': 'Smart Navigation Search',
        'connector_slug': 'smart-navigation-search', 'mcp_transport_type': 'streamable_http',
        'mcp_server_url': 'https://fixture.test/mcp', 'actions': [{'action_key': action,
            'label': 'Locate', 'execution_kind': 'leaf', 'parameter_schema': {'type': 'object', 'properties': {}}}]}
    context = ConnectorToolContext(workspace_id='workspace', brain_documents=[{
        'filepath': 'fixture/approved/manual.pdf', 'workspace_id': 'workspace', 'document_id': 'document'}])
    agent = LlmAgent(name='guide', model='gemini-2.5-flash', tools=create_connector_tools([binding], context))

    async def factory(*args):
        return agent, None

    compiled = await compile_worker({}, 'guide', 'guide', ExecutionScopeV1(
        execution_id=execution, parent_execution_id='root', role=ExecutionRole.LIBRARY_WORKER, depth=1), factory)
    return compiled.agent.tools[-1]


@pytest.mark.asyncio
async def test_recorded_locator_response_is_captured_inside_real_compiled_connector(monkeypatch):
    async def remote(*args, **kwargs):
        return copy.deepcopy(RESPONSE)
    monkeypatch.setattr('src.flow_engine.mcp.call_mcp_tool', remote)
    tool = await owned_tool()
    context = SimpleNamespace(function_call_id='native-call', invocation_id='invocation', state={})
    result = await tool.run_async(args={'display_purpose': 'Locate fixture sources'}, tool_context=context)
    assert 'citation_sources' in result, result
    records = collect_evidence(context.state, 'child')
    assert len(records) == 1
    assert records[0]['nativeIdentity'] == 'native-call'
    assert records[0]['outputOrdinal'] == 0
    assert records[0]['payload'] == {'type': 'text', 'source': 'fixture/approved/manual.pdf',
        'file_name': 'manual.pdf', 'page': '10', 'workspace_id': 'workspace', 'reference': '1',
        'document_id': 'document', 'file_path': 'fixture/approved/manual.pdf'}
    assert result['citation_sources'][0]['reference'] == '1'
    assert context.state['_connector_text_sources'][0]['object']['content']['workspace_id'] == 'workspace'
    context.function_call_id = 'next-call'
    await tool.run_async(args={'display_purpose': 'Locate fixture sources'}, tool_context=context)
    assert len(collect_evidence(context.state, 'child')) == 2
    assert collect_evidence(context.state, 'sibling') == []


@pytest.mark.asyncio
@pytest.mark.parametrize('action,response', [('search', RESPONSE), ('locate_answer_citations', {'citations': [None, {}]}),
    ('locate_answer_citations', {'citations': [{'source': 's3://vectorstore/other/private.pdf'}]}),
    ('locate_answer_citations', {'citations': [{'source': 's3://vectorstore/other/private.pdf', 'workspace_id': 'workspace', 'document_id': 'document'}]}),
    ('locate_answer_citations', {'citations': [{'source': 's3://vectorstore/fixture/approved/manual.pdf', 'workspace_id': 'other'}]}),
    ('locate_answer_citations', {'citations': [{'source': 's3://vectorstore/fixture/approved/manual.pdf', 'document_id': 'other'}]})])
async def test_untrusted_or_unbound_sources_do_not_become_owned_evidence(monkeypatch, action, response):
    async def remote(*args, **kwargs):
        return copy.deepcopy(response)
    monkeypatch.setattr('src.flow_engine.mcp.call_mcp_tool', remote)
    tool = await owned_tool(action)
    context = SimpleNamespace(function_call_id='native-call', state={})
    await tool.run_async(args={'display_purpose': 'Locate fixture sources'}, tool_context=context)
    assert collect_evidence(context.state, 'child') == []
