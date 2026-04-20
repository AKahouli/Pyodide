"""Deterministic action executor for playbook tasks.

Provides a non-LLM execution path for tasks with execution_mode='action'.
Actions operate on resolved document inputs from upstream ports.

Indexing calls the vectorstores API directly (no backend HTTP hop).
Status polling uses Redis via DocumentStatusRedis (no backend HTTP hop).
"""

import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import aiohttp

from src.langgraph_engine.port_resolution import (
    build_tool_scope,
    resolve_task_inputs,
    _unique_strings,
)

logger = logging.getLogger(__name__)

_cached_token: Optional[str] = None
_cached_token_expires_at: float = 0.0


def _get_vectorstores_url() -> str:
    from src.config.settings import get_settings
    settings = get_settings()
    return (settings.VECTORSTORES_API_URL or "").rstrip("/")


def _get_auth_token_url() -> str:
    from src.config.settings import get_settings

    settings = get_settings()
    normalized = (settings.API_ADK_URL or "").rstrip("/")
    return f"{normalized}/token"


def _get_indexing_webhook_url() -> str:
    from src.config.settings import get_settings

    settings = get_settings()
    normalized = (settings.API_URL or "").rstrip("/")
    if normalized.endswith("/api/v1"):
        return f"{normalized}/indexing/webhook"
    if normalized.endswith("/api"):
        return f"{normalized}/v1/indexing/webhook"
    return f"{normalized}/api/v1/indexing/webhook"


async def _generate_token() -> str:
    from src.config.settings import get_settings

    global _cached_token, _cached_token_expires_at

    now = time.time()
    if _cached_token and now < _cached_token_expires_at - 60:
        return _cached_token

    settings = get_settings()
    token_url = _get_auth_token_url()
    form_data = urlencode(
        {
            "username": settings.AUTH_USERNAME,
            "password": settings.AUTH_PASSWORD,
        }
    )

    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(
            token_url,
            data=form_data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        ) as resp:
            if resp.status != 200:
                body = await resp.text()
                raise RuntimeError(
                    f"[action:index] auth /token returned {resp.status}: {body[:200]}"
                )
            payload = json.loads(await resp.text())
            _cached_token = str(payload.get("access_token") or "").strip()
            if not _cached_token:
                raise RuntimeError("[action:index] auth /token returned no access_token")

    expire_minutes = settings.ACCESS_TOKEN_EXPIRE_MINUTES
    _cached_token_expires_at = now + (expire_minutes * 60)
    logger.info("[action:index] Obtained vectorstores access token via auth /token")
    return _cached_token


def get_action_document_ids(
    task: Dict[str, Any],
    resolved_inputs: Dict[str, Any],
) -> List[str]:
    """Collect document IDs from document-type input ports."""
    tool_scope = build_tool_scope(resolved_inputs)
    input_ports = task.get("input_ports") or []
    doc_ids: List[str] = []

    for port in input_ports:
        if str(port.get("artifact_kind") or "") != "document":
            continue
        port_id = str(port.get("id") or "default")
        doc_ids.extend(tool_scope["documents_by_port"].get(port_id, []))

    return _unique_strings(doc_ids)


def get_action_document_metadata(
    resolved_inputs: Dict[str, Any],
) -> List[Dict[str, str]]:
    """Extract full document metadata (filepath, workspace_id) from resolved inputs."""
    tool_scope = build_tool_scope(resolved_inputs)
    all_files = tool_scope.get("all_files") or []
    seen = set()
    result: List[Dict[str, str]] = []
    for f in all_files:
        if not isinstance(f, dict):
            continue
        doc_id = str(f.get("document_id") or "").strip()
        if not doc_id or doc_id in seen:
            continue
        seen.add(doc_id)
        result.append({
            "document_id": doc_id,
            "filepath": str(f.get("filepath") or "").strip(),
            "workspace_id": str(f.get("workspace_id") or "").strip(),
            "filename": str(f.get("filename") or "").strip(),
        })
    return result


def get_workspace_indexing_settings(
    resolved_inputs: Dict[str, Any],
    workspace_id: str,
) -> Dict[str, Any]:
    """Extract workspace-level indexing settings from resolved inputs."""
    for workspace in resolved_inputs.get("playbook_workspace_context") or []:
        if str(workspace.get("workspace_id") or "").strip() == workspace_id:
            return {
                "chunks": workspace.get("chunks"),
                "hybrid_search": workspace.get("hybrid_search"),
                "instruction": workspace.get("instruction"),
                "tag": workspace.get("tag"),
            }

    for workspace in resolved_inputs.get("fallback_workspace_context") or []:
        if str(workspace.get("workspace_id") or "").strip() == workspace_id:
            return {
                "chunks": workspace.get("chunks"),
                "hybrid_search": workspace.get("hybrid_search"),
                "instruction": workspace.get("instruction"),
                "tag": workspace.get("tag"),
            }

    return {}


def get_action_workspace_id(
    resolved_inputs: Dict[str, Any],
) -> str:
    """Extract workspace ID from resolved inputs."""
    playbook_ws = list(resolved_inputs.get("playbook_workspace_context") or [])
    if playbook_ws:
        ws_id = str(playbook_ws[0].get("workspace_id") or "").strip()
        if ws_id:
            return ws_id

    fallback_ws = list(resolved_inputs.get("fallback_workspace_context") or [])
    if fallback_ws:
        ws_id = str(fallback_ws[0].get("workspace_id") or "").strip()
        if ws_id:
            return ws_id
    return ""


def _build_step_result(
    task_id: str,
    status: str,
    output: str,
    start_time: float,
    started_at: str,
    artifacts: Optional[List[Dict[str, Any]]] = None,
    action_trace: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    duration_ms = int((time.time() - start_time) * 1000)

    return {
        "task_id": task_id,
        "status": status,
        "output": output,
        "error": "" if status == "completed" else output,
        "duration_ms": duration_ms,
        "components": [],
        "usage": {},
        "tool_trace": action_trace or [],
        "llm_prompt_trace": [],
        "artifacts": artifacts or [],
        "semantic_match": None,
    }


def _get_action_output_port_id(task: Dict[str, Any]) -> str:
    output_ports = list(task.get("output_ports") or [])
    if output_ports:
        return str(output_ports[0].get("id") or "default").strip() or "default"
    return "default"


def _build_index_output_artifacts(
    task: Dict[str, Any],
    documents: List[Dict[str, str]],
    trigger_result: Dict[str, Any],
    poll_result: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    output_port_id = _get_action_output_port_id(task)
    trigger_by_id = {
        str(item.get("document_id") or "").strip(): item
        for item in (trigger_result.get("results") or [])
        if isinstance(item, dict)
    }
    trigger_errors_by_id = {
        str(item.get("document_id") or "").strip(): item
        for item in (trigger_result.get("errors") or [])
        if isinstance(item, dict)
    }
    poll_completed_by_id = {
        str(item.get("document_id") or "").strip(): item
        for item in ((poll_result or {}).get("completed") or [])
        if isinstance(item, dict)
    }
    poll_failed_by_id = {
        str(item.get("document_id") or "").strip(): item
        for item in ((poll_result or {}).get("failed") or [])
        if isinstance(item, dict)
    }

    artifacts: List[Dict[str, Any]] = []
    for doc in documents:
        document_id = str(doc.get("document_id") or "").strip()
        if not document_id:
            continue

        status = "pending"
        error = ""
        if document_id in poll_completed_by_id:
            status = str(poll_completed_by_id[document_id].get("status") or "ready")
        elif document_id in poll_failed_by_id:
            failed_item = poll_failed_by_id[document_id]
            status = str(failed_item.get("status") or "failed")
            error = str(failed_item.get("error") or "")
        elif document_id in trigger_errors_by_id:
            status = "trigger_failed"
            error = str(trigger_errors_by_id[document_id].get("error") or "")
        elif document_id in trigger_by_id:
            status = str(trigger_by_id[document_id].get("status") or "triggered")

        artifact = {
            "port_id": output_port_id,
            "artifact_kind": "document",
            "document_id": document_id,
            "filename": str(doc.get("filename") or "").strip(),
            "filepath": str(doc.get("filepath") or "").strip(),
            "workspace_id": str(doc.get("workspace_id") or "").strip(),
            "metadata": {
                "action": "index",
                "indexing_status": status,
            },
        }
        if error:
            artifact["metadata"]["error"] = error
        artifacts.append(artifact)

    return artifacts


async def _action_index_trigger(
    documents: List[Dict[str, str]],
    vectorstores_url: str,
    task_id: str,
    workspace_settings: Dict[str, Any],
) -> Dict[str, Any]:
    """Trigger indexing via vectorstores API (direct, no backend hop)."""
    if not vectorstores_url:
        return {"errors": [{"document_id": "all", "error": "VECTORSTORES_API_URL not configured"}]}

    token = await _generate_token()
    index_url = f"{vectorstores_url}/vectorstores/indexDocumentFromAzureDatalake"
    webhook_url = _get_indexing_webhook_url()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    results: List[Dict[str, str]] = []
    errors: List[Dict[str, str]] = []
    timeout = aiohttp.ClientTimeout(total=30)

    async with aiohttp.ClientSession(timeout=timeout) as session:
        for doc in documents:
            doc_id = doc["document_id"]
            filepath = doc.get("filepath", "")
            workspace_id = doc.get("workspace_id", "")

            if not filepath:
                errors.append({"document_id": doc_id, "error": "No filepath resolved for document"})
                continue

            payload = {
                "filepath": filepath,
                "brain_id": workspace_id,
                "external_id": doc_id,
                "source": filepath,
                "brain_type": "doc",
                "lang_code": "auto",
                "chunk_size": int(workspace_settings.get("chunks") or 4000),
                "chunk_overlap": 400,
                "enable_smart_chunk": bool(workspace_settings.get("hybrid_search") or False),
                "enable_extract_images": True,
                "oneshot_prompt": workspace_settings.get("instruction") or None,
                "brain_tag": [workspace_settings.get("tag") or ""],
                "webhook_url": webhook_url,
            }

            try:
                async with session.post(index_url, json=payload, headers=headers) as resp:
                    if resp.status in (200, 201):
                        results.append({"document_id": doc_id, "status": "triggered"})
                        logger.info(f"[{task_id}][action:index] Triggered indexing for {doc_id}")
                    else:
                        body = await resp.text()
                        errors.append({
                            "document_id": doc_id,
                            "error": f"Vectorstores API returned {resp.status}: {body[:200]}",
                        })
                        logger.error(
                            f"[{task_id}][action:index] Failed for {doc_id}: {resp.status}",
                        )
            except Exception as e:
                logger.error(
                    f"[{task_id}][action:index] Exception for {doc_id}: {str(e)}"
                )
                errors.append({"document_id": doc_id, "error": str(e)})

    return {"results": results, "errors": errors}


async def _poll_indexing_via_redis(
    documents: List[Dict[str, str]],
    timeout: int = 600,
    poll_interval: int = 5,
) -> Dict[str, Any]:
    """Poll document indexing status via Redis (direct, no backend hop)."""
    from src.modules.redis_connection import get_redis_connection
    from src.modules.document_status_redis import DocumentStatusRedis

    redis_client = await get_redis_connection()
    status_client = DocumentStatusRedis(redis_client)

    pending = list(documents)
    elapsed = 0
    completed: List[Dict[str, str]] = []
    failed: List[Dict[str, str]] = []

    while elapsed < timeout and pending:
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval

        still_pending: List[Dict[str, str]] = []
        for doc in pending:
            doc_id = doc["document_id"]
            workspace_id = doc.get("workspace_id", "")
            try:
                status_data = await status_client.get_status_async(workspace_id, doc_id)
                if status_data:
                    status = status_data.get("status", "UNKNOWN")
                    if status == "COMPLETED":
                        completed.append({"document_id": doc_id, "status": "ready"})
                    elif status == "FAILED":
                        failed.append({
                            "document_id": doc_id,
                            "status": "failed",
                            "error": status_data.get("error", "Unknown indexing failure"),
                        })
                    else:
                        still_pending.append(doc)
                else:
                    still_pending.append(doc)
            except Exception:
                still_pending.append(doc)

        pending = still_pending

    for doc in pending:
        failed.append({
            "document_id": doc["document_id"],
            "status": "timeout",
            "error": f"Indexing did not complete within {timeout}s",
        })

    return {"completed": completed, "failed": failed}


async def execute_action_task(
    task: Dict[str, Any],
    *,
    task_id: str,
    start_time: float,
    started_at: str,
    workspace_context: Optional[list] = None,
    trigger_context: Optional[Dict[str, Any]] = None,
    edges: Optional[List[Dict[str, Any]]] = None,
    upstream_results: Optional[List[Dict[str, Any]]] = None,
    artifacts_by_port: Optional[Dict[str, List[Dict[str, Any]]]] = None,
    on_progress: Optional[Any] = None,
) -> Dict[str, Any]:
    """Execute a deterministic action task.

    Resolves document inputs from upstream ports and executes the selected
    action. Returns a standard step result envelope.
    """
    action = str(task.get("selected_action") or "").strip().lower()

    if not action:
        error_msg = "No action selected for task"
        logger.error(f"[{task_id}] {error_msg}")
        return {
            "completed_task_ids": [task_id],
            "results": {task_id: {"status": "failed", "output": error_msg}},
            "error": error_msg,
            "status": "failed",
        }

    upstream_results_map = {
        str(item.get("task_id") or "").strip(): item
        for item in (upstream_results or [])
        if isinstance(item, dict) and str(item.get("task_id") or "").strip()
    }

    resolved_inputs = resolve_task_inputs(
        task_id,
        task,
        {
            "edges": edges or [],
            "results": upstream_results_map,
            "task_outputs": {},
            "artifacts_by_port": artifacts_by_port or {},
            "workspace_context": workspace_context,
            "trigger_context": trigger_context,
        },
    )

    document_ids = get_action_document_ids(task, resolved_inputs)
    documents = get_action_document_metadata(resolved_inputs)
    workspace_id = get_action_workspace_id(resolved_inputs)
    workspace_settings = get_workspace_indexing_settings(
        resolved_inputs, workspace_id
    )
    vectorstores_url = _get_vectorstores_url()

    if not document_ids:
        error_msg = "No documents found on document-type input ports"
        logger.warning(f"[{task_id}] {error_msg}")
        return {
            "completed_task_ids": [task_id],
            "results": {task_id: {"status": "failed", "output": error_msg}},
            "error": error_msg,
            "status": "failed",
        }

    if not workspace_id:
        error_msg = "No workspace context available for action execution"
        logger.error(f"[{task_id}] {error_msg}")
        return {
            "completed_task_ids": [task_id],
            "results": {task_id: {"status": "failed", "output": error_msg}},
            "error": error_msg,
            "status": "failed",
        }

    logger.info(
        f"[{task_id}] Action '{action}' starting "
        f"(document_count={len(documents)}, workspace_id={workspace_id})"
    )

    try:
        if action == "index":
            trigger_result = await _action_index_trigger(
                documents, vectorstores_url, task_id, workspace_settings
            )
            trigger_errors = trigger_result.get("errors", [])

            if trigger_errors and not trigger_result.get("results"):
                error_lines = [f"{e['document_id']}: {e['error']}" for e in trigger_errors]
                output = f"Indexing trigger failed:\n" + "\n".join(error_lines)
                result = _build_step_result(
                    task_id,
                    "failed",
                    output,
                    start_time,
                    started_at,
                    artifacts=_build_index_output_artifacts(
                        task,
                        documents,
                        trigger_result,
                    ),
                )
            else:
                poll_result = await _poll_indexing_via_redis(documents)
                poll_failed = poll_result.get("failed", [])
                poll_completed = poll_result.get("completed", [])

                if poll_failed:
                    error_lines = [
                        f"{e['document_id']}: {e['error']}" for e in poll_failed
                    ]
                    output = f"Indexing failed:\n" + "\n".join(error_lines)
                    result = _build_step_result(
                        task_id,
                        "failed",
                        output,
                        start_time,
                        started_at,
                        artifacts=_build_index_output_artifacts(
                            task,
                            documents,
                            trigger_result,
                            poll_result,
                        ),
                    )
                else:
                    output = f"Indexed {len(poll_completed)} document(s) successfully."
                    result = _build_step_result(
                        task_id,
                        "completed",
                        output,
                        start_time,
                        started_at,
                        artifacts=_build_index_output_artifacts(
                            task,
                            documents,
                            trigger_result,
                            poll_result,
                        ),
                    )

        elif action == "delete":
            output = (
                f"Delete action not yet implemented. "
                f"Documents: {', '.join(document_ids[:5])}"
            )
            result = _build_step_result(
                task_id, "failed", output, start_time, started_at
            )

        elif action == "read":
            output = (
                f"Read action not yet implemented. "
                f"Documents: {', '.join(document_ids[:5])}"
            )
            result = _build_step_result(
                task_id, "failed", output, start_time, started_at
            )

        else:
            error_msg = f"Unknown action: {action}"
            result = _build_step_result(
                task_id, "failed", error_msg, start_time, started_at
            )

    except Exception as e:
        error_msg = f"Action '{action}' failed: {str(e)}"
        logger.error(f"[{task_id}] {error_msg}", exc_info=True)
        result = _build_step_result(
            task_id, "failed", error_msg, start_time, started_at
        )

    status = result.get("status", "failed")
    error = result.get("error", "")
    output = result.get("output", "")

    return {
        "completed_task_ids": [task_id],
        "results": {
            task_id: {
                "task_id": task_id,
                "status": status,
                "output": output,
                "error": error,
                "duration_ms": result.get("duration_ms", 0),
                "components": result.get("components", []),
                "tool_trace": result.get("tool_trace", []),
                "llm_prompt_trace": result.get("llm_prompt_trace", []),
            }
        },
        **({"error": error} if error else {}),
        "status": status,
    }
