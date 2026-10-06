"""Producer evidence lives in native tool response state, never model prose."""
from __future__ import annotations

from contextvars import ContextVar
from hashlib import sha256
from types import MethodType
from urllib.parse import urlsplit, urlunsplit

from google.adk.tools import BaseTool, FunctionTool

_producer = ContextVar('root_evidence_producer', default=None)
_PREFIX = '_root_evidence:'
_FIELDS = {'type', 'title', 'filename', 'file_name', 'fileName', 'path', 'filepath',
           'file_path', 'source', 'url', 'document_id', 'documentId', 'workspace_id',
           'workspaceId', 'brain_id', 'reference', 'page', 'artifact_id', 'artifact_kind',
           'mime_type', 'size_bytes', 'availability', 'producer_tool_id'}


def _safe_source(value, depth=0):
    if not isinstance(value, dict) or depth > 4:
        return {}
    safe = {}
    for key, item in value.items():
        if key in ('source_object', 'metadata', 'content') and isinstance(item, dict):
            nested = _safe_source(item, depth + 1)
            if nested:
                safe[key] = nested
        elif key in _FIELDS and isinstance(item, str) and len(item) <= 2000:
            from src.flow_engine.observability.redaction import redact_string
            item = redact_string(item, 2000)
            if key == 'url' or '://' in item:
                parsed = urlsplit(item)
                if parsed.scheme not in ('http', 'https') or parsed.username or parsed.password:
                    continue
                item = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, '', ''))
            safe[key] = item
        elif key in _FIELDS and type(item) in (int, bool):
            safe[key] = item
    return safe


def capture_evidence(kind, identity, payload):
    owner = _producer.get()
    if owner is None:
        return
    execution_id, context = owner
    call_id = context.function_call_id
    if not call_id:
        raise ValueError('Producer evidence requires a native tool call identity')
    key = _PREFIX + sha256(f'{execution_id}:{call_id}'.encode()).hexdigest()
    manifest = list(context.state.get(key, []))
    if any(item['identity'] == identity and item['kind'] == kind for item in manifest):
        return
    if len(manifest) >= 100:
        raise ValueError('Producer evidence manifest limit exceeded')
    manifest.append({'executionId': execution_id, 'nativeIdentity': call_id,
        'outputOrdinal': len(manifest), 'identity': identity, 'kind': kind,
        'payload': _safe_source(payload)})
    context.state[key] = manifest


def capture_citation(tag, number, source):
    capture_evidence('citation', tag, {**source, 'reference': str(number)})


def collect_evidence(state, execution_id):
    records = []
    for key, manifest in state.items():
        if key.startswith(_PREFIX) and isinstance(manifest, list):
            records.extend(item for item in manifest if item.get('executionId') == execution_id)
    return records


def install_evidence_capture(agent, scope):
    """Keep each tool's declaration, identity and callbacks while binding state."""
    tools = []
    for value in agent.tools:
        tool = value if isinstance(value, BaseTool) else FunctionTool(value) if callable(value) else value
        owner = getattr(tool, '_root_evidence_execution', None)
        if owner is not None and owner != scope.execution_id:
            raise ValueError('Evidence tool cannot be reused by another execution')
        if isinstance(tool, BaseTool) and not getattr(tool, '_root_evidence_capture', False):
            original = tool.run_async

            def adapter(original_run):
                async def run(_self, *, args, tool_context):
                    token = _producer.set((scope.execution_id, tool_context))
                    try:
                        return await original_run(args=args, tool_context=tool_context)
                    finally:
                        _producer.reset(token)
                return run

            tool.run_async = MethodType(adapter(original), tool)
            tool._root_evidence_capture = True
            tool._root_evidence_execution = scope.execution_id
        tools.append(tool)
    agent.tools = tools
