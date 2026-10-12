import hashlib
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.root_runtime import evidence_submission, delegate_resolver, background_fanout
from src.root_runtime.worker_execution import WorkerExecutionRejected


def records(count):
    return [{'nativeIdentity': f'call-{index}', 'outputOrdinal': 0, 'kind': 'citation',
        'payload': {'type': 'web', 'reference': str(index + 1), 'source': f'https://official.test/{index}'}}
        for index in range(count)]


@pytest.mark.asyncio
@pytest.mark.parametrize('path', ['children/producer/evidence-page', 'background-evidence-page', 'background-items/producer/evidence-page'])
async def test_large_collection_pages_without_losing_any_producer_identity(monkeypatch, path):
    calls = []
    async def post(scope, route, payload):
        calls.append((route, payload))
        return {'count': len(payload['evidence'])}
    monkeypatch.setattr(evidence_submission, '_post', post)
    values = records(101)
    result = await evidence_submission.prepare_evidence_submission(SimpleNamespace(execution_id='root'), 'producer', values, path,
        {'owner': 'owner', 'fence': 3})
    assert [len(payload['evidence']) for _, payload in calls] == [100, 1]
    assert [item for _, payload in calls for item in payload['evidence']] == values
    assert all(route == path and payload['owner'] == 'owner' and payload['fence'] == 3 for route, payload in calls)
    ids = [evidence_submission.evidence_id('producer', item) for item in values]
    assert result == {'evidenceManifest': {'count': 101, 'digest': hashlib.sha256(','.join(sorted(ids)).encode()).hexdigest()}}


@pytest.mark.asyncio
async def test_actual_delegate_and_fanout_adapters_use_pages_before_one_final_settlement(monkeypatch):
    pages = []
    async def stage(scope, path, payload):
        pages.append(path)
        return {'count': len(payload['evidence'])}
    monkeypatch.setattr(evidence_submission, '_post', stage)
    final = AsyncMock(return_value={'status': 'completed'})
    monkeypatch.setattr(delegate_resolver, '_post', final)
    await delegate_resolver.settle_delegate(SimpleNamespace(execution_id='root'), 'producer', 'completed', 'Result [101]', records(101))
    assert pages == ['children/producer/evidence-page'] * 2
    assert 'evidence' not in final.call_args.args[2] and final.call_args.args[2]['evidenceManifest']['count'] == 101
    final.assert_awaited_once()
    pages.clear()
    monkeypatch.setattr(background_fanout, '_post', final)
    grant = SimpleNamespace(execution_id='coordinator', owner='owner', fence=3, native_owner='native', request_digest='digest')
    adapter = background_fanout.OwnedFanoutAdapter(SimpleNamespace(grant=grant), {'items': [{'executionId': 'producer'}]})
    await adapter.settle('producer', 'completed', 'Result [101]', records(101))
    assert pages == ['background-items/producer/evidence-page'] * 2
    assert final.call_args.args[2]['evidenceManifest']['count'] == 101


@pytest.mark.asyncio
async def test_failed_page_prevents_final_settlement_and_small_inputs_keep_existing_contract(monkeypatch):
    stage = AsyncMock(side_effect=RuntimeError('stale owner'))
    final = AsyncMock()
    monkeypatch.setattr(evidence_submission, '_post', stage)
    monkeypatch.setattr(delegate_resolver, '_post', final)
    with pytest.raises(RuntimeError, match='stale owner'):
        await delegate_resolver.settle_delegate(SimpleNamespace(execution_id='root'), 'producer', 'completed', 'Result', records(101))
    final.assert_not_awaited()
    assert await evidence_submission.prepare_evidence_submission(None, 'producer', records(2), 'unused') == {'evidence': records(2)}
    with pytest.raises(WorkerExecutionRejected):
        await evidence_submission.prepare_evidence_submission(None, 'producer', records(1001), 'unused')
