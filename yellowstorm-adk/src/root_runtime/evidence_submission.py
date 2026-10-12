"""Preserve producer identities while paging bounded settlement metadata."""
import hashlib
import json

from src.root_runtime.delegate_resolver import _post
from src.root_runtime.worker_execution import WorkerExecutionRejected


def evidence_id(execution_id, item):
    key = hashlib.sha256(f"{execution_id}|{item['nativeIdentity']}|{item['outputOrdinal']}".encode()).hexdigest()
    return hashlib.sha256(key.encode()).hexdigest()[:24]


async def prepare_evidence_submission(scope, execution_id, evidence, page_path, authority=None):
    records = [{key: item[key] for key in ('nativeIdentity', 'outputOrdinal', 'kind', 'payload')}
        for item in evidence or []]
    if not records:
        return {}
    encoded = lambda value: json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()
    ids = [evidence_id(execution_id, item) for item in records]
    if len(records) > 1000 or len(set(ids)) != len(ids) or len(encoded(records)) > 786432:
        raise WorkerExecutionRejected('Worker evidence exceeds the bounded execution manifest')
    if len(records) <= 100 and len(encoded(records)) <= 65536:
        return {'evidence': records}
    page = []
    pages = []
    for item in records:
        if len(encoded(item['payload'])) > 8192:
            raise WorkerExecutionRejected('Worker evidence record exceeds the page contract')
        if page and (len(page) == 100 or len(encoded(page + [item])) > 65536):
            pages.append(page)
            page = []
        page.append(item)
    pages.append(page)
    for page in pages:
        acknowledgement = await _post(scope, page_path, {**(authority or {}), 'status': 'completed', 'evidence': page})
        if acknowledgement.get('count') != len(page):
            raise ValueError('Evidence page acknowledgement differs from submitted identities')
    return {'evidenceManifest': {'count': len(ids),
        'digest': hashlib.sha256(','.join(sorted(ids)).encode()).hexdigest()}}
