"""A terminal invocation must supply a deliverable, not just an end marker."""
from yellowmind_observability import get_logger
from src.root_runtime.worker_execution import WorkerExecutionRejected

logger = get_logger(__name__)


def _artifact_deliverable(item):
    if item.get('kind') != 'artifact':
        return False
    payload = item.get('payload', {})
    source = payload.get('source_object') or {}
    payload = {**payload, **source, **(source.get('metadata') or {}), **(source.get('content') or {})}
    return payload.get('availability') != 'unavailable' and any(
        isinstance(payload.get(key), str) and payload[key].strip()
        for key in ('artifact_id', 'path', 'filepath', 'file_path', 'document_id', 'source', 'url'))


def validate_worker_result(result, evidence, execution_id):
    artifact = any(_artifact_deliverable(item) for item in evidence)
    if result is not None and not isinstance(result, str):
        reason = 'invalid_result_type'
    elif isinstance(result, str) and len(result.encode('utf-8')) > 262144:
        reason = 'result_limit_exceeded'
    elif not (isinstance(result, str) and result.strip()) and not artifact:
        reason = 'empty_deliverable'
    else:
        return result or ''
    logger.warning('worker.execution.rejected', run_id=execution_id, reason_code=reason, count=0)
    raise WorkerExecutionRejected('Worker returned no valid deliverable; no retry was performed')
