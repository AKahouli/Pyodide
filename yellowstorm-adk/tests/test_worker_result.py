import pytest
from src.root_runtime.worker_result import validate_worker_result
from src.root_runtime.worker_execution import WorkerExecutionRejected


@pytest.mark.parametrize('result', [None, '', ' \n ', {'answer': 'accidental conversion'}, 'x' * 262145],
    ids=['missing', 'empty', 'whitespace', 'object', 'oversized'])
def test_invalid_completion_is_rejected(result):
    with pytest.raises(WorkerExecutionRejected):
        validate_worker_result(result, [], 'worker')


def test_text_and_real_artifact_are_deliverables_but_citations_alone_are_not():
    assert validate_worker_result('Verified findings', [], 'worker') == 'Verified findings'
    assert validate_worker_result(None, [{'kind': 'artifact', 'payload': {'path': 'chart.png'}}], 'worker') == ''
    assert validate_worker_result(None, [{'kind': 'artifact', 'payload': {'source_object': {
        'metadata': {'path': 'chart.png'}}}}], 'worker') == ''
    for evidence in ([{'kind': 'artifact', 'payload': {'title': 'No file'}}],
                     [{'kind': 'artifact', 'payload': {'path': 'chart.png', 'availability': 'unavailable'}}],
                     [{'kind': 'citation', 'payload': {'url': 'https://example.com'}}]):
        with pytest.raises(WorkerExecutionRejected):
            validate_worker_result(None, evidence, 'worker')
