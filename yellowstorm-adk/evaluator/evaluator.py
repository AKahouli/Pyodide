"""Run deep-search benchmark queries through PlaybookFlowRuntime.Run.

    python -m evaluation.evaluator
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import json
import os
import re
import sys
import time
import uuid
import zipfile
from dataclasses import asdict, dataclass, fields
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator, Iterable

import grpc
from google.protobuf.json_format import MessageToDict, ParseDict

from src.grpc_generated import playbook_flow_pb2 as pb
from src.grpc_generated import playbook_flow_pb2_grpc as pb_grpc


@dataclass(frozen=True)
class EvaluatorConfig:
    grpc_target: str = "localhost:50051"
    grpc_secure: bool = False
    grpc_root_certificate_path: str | None = None
    grpc_api_key_env: str | None = "GRPC_API_KEY"

    request_template_path: str = "evaluation/request_template.json"
    benchmark_zip_path: str = (
        r"C:\Users\Yellowsys\Downloads\deep_search_benchmark_v2.zip"
    )
    benchmark_queries_member: str = (
        "deep_search_benchmark_v2/benchmark_queries.json"
    )

    output_directory: str = "evaluation/outputs"
    answer_node_id: str | None = None
    query_ids: tuple[str, ...] = ()
    timeout_seconds: float = 600.0

    # Nested location of the query in the protobuf JSON request payload.
    query_path: tuple[str, ...] = ("input_context", "query")

    # Additional locations that must also receive the benchmark query. The
    # captured request template keeps the original manual question inside the
    # agent node (snapshot.nodes.0.metadata.description); without overwriting
    # it, the agent answers the stale question instead of the benchmark one.
    additional_query_paths: tuple[tuple[str, ...], ...] = ()

    # Optional locations that must receive the fresh execution ID. Use numeric
    # strings for list indexes, for example ("snapshot", "nodes", "0", ...).
    session_id_paths: tuple[tuple[str, ...], ...] = ()

    # LLM judge comparing the model answer against the expected answer.
    # Disabled when judge_model is null. Base URL / API key default to the
    # LITELLM_API_BASE_URL / LITELLM_API_SECRET_KEY environment variables.
    judge_model: str | None = None
    judge_base_url: str | None = None
    judge_api_key_env: str = "LITELLM_API_SECRET_KEY"


# ---------------------------------------------------------------------------
# Evaluator implementation.
# ---------------------------------------------------------------------------


TERMINAL_SUCCESS = "ExecutionCompleted"
TERMINAL_FAILURE = "ExecutionFailed"
PDF_NAME_PATTERN = re.compile(r"(?i)([A-Za-z0-9][A-Za-z0-9_().&'-]*\.pdf)")


def _json_default(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, tuple):
        return list(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _write_json(path: Path, payload: Any) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=_json_default),
        encoding="utf-8",
    )


def _append_json_line(stream: Any, payload: Any) -> None:
    stream.write(json.dumps(payload, ensure_ascii=False, default=_json_default))
    stream.write("\n")
    stream.flush()


def _safe_query_id(query_id: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", query_id.strip())
    return cleaned or "query"


def _load_config(path: str | Path) -> EvaluatorConfig:
    config_path = Path(path)
    if not config_path.is_file():
        raise FileNotFoundError(f"Evaluator config does not exist: {config_path}")
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("Evaluator config must contain a JSON object")

    allowed = {item.name for item in fields(EvaluatorConfig)}
    unknown = sorted(set(raw) - allowed)
    if unknown:
        raise ValueError(f"Unknown config fields: {', '.join(unknown)}")

    normalized = dict(raw)
    if "query_ids" in normalized:
        normalized["query_ids"] = tuple(normalized["query_ids"])
    if "query_path" in normalized:
        normalized["query_path"] = tuple(normalized["query_path"])
    if "additional_query_paths" in normalized:
        normalized["additional_query_paths"] = tuple(
            tuple(path_parts) for path_parts in normalized["additional_query_paths"]
        )
    if "session_id_paths" in normalized:
        normalized["session_id_paths"] = tuple(
            tuple(path_parts) for path_parts in normalized["session_id_paths"]
        )
    return EvaluatorConfig(**normalized)


def _load_request_template(path: str | Path) -> dict[str, Any]:
    template_path = Path(path)
    if not template_path.is_file():
        raise FileNotFoundError(
            f"Playbook request template does not exist: {template_path}"
        )
    payload = json.loads(template_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("request_template.json must contain a JSON object")
    return payload


def _set_nested_value(payload: Any, path: Iterable[str], value: Any) -> None:
    parts = list(path)
    if not parts:
        raise ValueError("Configuration path cannot be empty")

    current = payload
    for part in parts[:-1]:
        if isinstance(current, list):
            try:
                current = current[int(part)]
            except (ValueError, IndexError) as exc:
                raise ValueError(f"Invalid list index {part!r} in path {parts}") from exc
        elif isinstance(current, dict):
            if part not in current:
                current[part] = {}
            current = current[part]
        else:
            raise ValueError(f"Cannot traverse {part!r} in path {parts}")

    final = parts[-1]
    if isinstance(current, list):
        try:
            current[int(final)] = value
        except (ValueError, IndexError) as exc:
            raise ValueError(f"Invalid list index {final!r} in path {parts}") from exc
    elif isinstance(current, dict):
        current[final] = value
    else:
        raise ValueError(f"Cannot assign {final!r} in path {parts}")


def _get_nested_value(payload: Any, path: Iterable[str]) -> Any:
    current = payload
    for part in path:
        if isinstance(current, list):
            try:
                current = current[int(part)]
            except (ValueError, IndexError):
                return None
        elif isinstance(current, dict):
            if part not in current:
                return None
            current = current[part]
        else:
            return None
    return current


def _load_queries(config: EvaluatorConfig) -> list[dict[str, Any]]:
    archive_path = Path(config.benchmark_zip_path)
    if not archive_path.is_file():
        raise FileNotFoundError(f"Benchmark ZIP does not exist: {archive_path}")

    with zipfile.ZipFile(archive_path) as archive:
        try:
            raw_queries = archive.read(config.benchmark_queries_member)
        except KeyError as exc:
            raise FileNotFoundError(
                f"{config.benchmark_queries_member!r} is not present in {archive_path}"
            ) from exc

    queries = json.loads(raw_queries.decode("utf-8"))
    if not isinstance(queries, list):
        raise ValueError("benchmark_queries.json must contain a JSON array")

    selected = set(config.query_ids)
    normalized: list[dict[str, Any]] = []
    observed_ids: set[str] = set()
    for index, item in enumerate(queries):
        if not isinstance(item, dict):
            raise ValueError(f"Benchmark query at index {index} must be an object")
        query_id = str(item.get("id") or "").strip()
        query = str(item.get("query") or "").strip()
        if not query_id or not query:
            raise ValueError(f"Benchmark query at index {index} needs id and query")
        if query_id in observed_ids:
            raise ValueError(f"Duplicate benchmark query ID: {query_id}")
        observed_ids.add(query_id)
        if not selected or query_id in selected:
            normalized.append(item)

    missing_ids = selected - observed_ids
    if missing_ids:
        raise ValueError(f"Unknown query IDs: {', '.join(sorted(missing_ids))}")
    if not normalized:
        raise ValueError("No benchmark queries were selected")
    return normalized


def _validate_request_template(template: dict[str, Any], config: EvaluatorConfig) -> None:
    flow_id = str(template.get("flow_id") or "").strip()
    nodes = _get_nested_value(template, ("snapshot", "nodes"))
    if not flow_id or flow_id == "INSERT_FLOW_ID":
        raise ValueError(
            "Paste a real Playbook Run request_payload into request_template.json; "
            "flow_id is still a placeholder"
        )
    if not isinstance(nodes, list) or not nodes:
        raise ValueError(
            "Paste a real Playbook Run request_payload into request_template.json; "
            "snapshot.nodes is empty"
        )
    if not config.query_path:
        raise ValueError("query_path cannot be empty")
    if config.timeout_seconds <= 0:
        raise ValueError("timeout_seconds must be greater than zero")


def _make_execution_id(query_id: str) -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"eval-{timestamp}-{_safe_query_id(query_id)}-{uuid.uuid4().hex[:8]}"


def _build_request_payload(
    request_template: dict[str, Any],
    benchmark_query: dict[str, Any],
    config: EvaluatorConfig,
) -> tuple[dict[str, Any], str]:
    request_payload = copy.deepcopy(request_template)
    query_id = str(benchmark_query["id"])
    execution_id = _make_execution_id(query_id)

    request_payload["execution_id"] = execution_id
    request_payload["seeded_task_outputs"] = []
    _set_nested_value(request_payload, config.query_path, benchmark_query["query"])
    for query_path in config.additional_query_paths:
        _set_nested_value(request_payload, query_path, benchmark_query["query"])
    for session_path in config.session_id_paths:
        _set_nested_value(request_payload, session_path, execution_id)

    return request_payload, execution_id


def _payload_to_run_request(payload: dict[str, Any]) -> pb.RunRequest:
    request = pb.RunRequest()
    try:
        ParseDict(payload, request, ignore_unknown_fields=False)
    except Exception as exc:
        raise ValueError(f"request_template.json is not a valid RunRequest: {exc}") from exc
    return request


def _event_to_dict(event: pb.RunEvent) -> dict[str, Any]:
    return MessageToDict(
        event,
        preserving_proto_field_name=True,
        always_print_fields_with_no_presence=True,
    )


def _channel(config: EvaluatorConfig) -> grpc.aio.Channel:
    options = [
        ("grpc.max_send_message_length", 50 * 1024 * 1024),
        ("grpc.max_receive_message_length", 50 * 1024 * 1024),
    ]
    if not config.grpc_secure:
        return grpc.aio.insecure_channel(config.grpc_target, options=options)

    root_certificates = None
    if config.grpc_root_certificate_path:
        certificate_path = Path(config.grpc_root_certificate_path)
        root_certificates = certificate_path.read_bytes()
    credentials = grpc.ssl_channel_credentials(root_certificates=root_certificates)
    return grpc.aio.secure_channel(
        config.grpc_target,
        credentials,
        options=options,
    )


def _metadata(config: EvaluatorConfig) -> tuple[tuple[str, str], ...]:
    if not config.grpc_api_key_env:
        return ()
    api_key = os.getenv(config.grpc_api_key_env, "").strip()
    if not api_key:
        if config.grpc_secure:
            raise ValueError(
                f"Environment variable {config.grpc_api_key_env} is required "
                "for the configured secure gRPC connection"
            )
        return ()
    return (("x-api-key", api_key),)


def _answer_from_payload(payload: dict[str, Any]) -> str | None:
    for path in (("output",), ("raw_llm_output",), ("text",)):
        value = _get_nested_value(payload, path)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, (dict, list)) and value:
            return json.dumps(value, ensure_ascii=False)
    return None


def _collect_tool_trace(
    traces_by_node: dict[tuple[str, int], list[dict[str, Any]]],
    event: dict[str, Any],
) -> None:
    payload = event.get("payload")
    if not isinstance(payload, dict):
        return
    trace = payload.get("tool_trace")
    if not isinstance(trace, list):
        return
    key = (str(event.get("node_id") or ""), int(event.get("iteration") or 0))
    existing = traces_by_node.get(key, [])
    if len(trace) >= len(existing):
        traces_by_node[key] = [item for item in trace if isinstance(item, dict)]


def _flatten_tool_trace(
    traces_by_node: dict[tuple[str, int], list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    tool_calls: list[dict[str, Any]] = []
    for (node_id, iteration), trace in sorted(traces_by_node.items()):
        for item in trace:
            tool_calls.append(
                {
                    "node_id": node_id,
                    "iteration": iteration,
                    **item,
                }
            )
    return tool_calls


def _recover_from_events(
    events_path: Path,
    answer_node_id: str | None,
) -> tuple[str | None, list[dict[str, Any]]]:
    """Recover partial answer and tool traces after a timeout or stream error."""

    if not events_path.is_file():
        return None, []

    answer: str | None = None
    last_completed_answer: str | None = None
    traces_by_node: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for line in events_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict):
            continue
        _collect_tool_trace(traces_by_node, event)
        if event.get("event_type") != "NodeCompleted":
            continue
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
        candidate = _answer_from_payload(payload)
        if candidate:
            last_completed_answer = candidate
            if not answer_node_id or event.get("node_id") == answer_node_id:
                answer = candidate

    if answer is None and not answer_node_id:
        answer = last_completed_answer
    return answer, _flatten_tool_trace(traces_by_node)


def _extract_pdf_names(values: Iterable[Any]) -> list[str]:
    observed: list[str] = []
    seen: set[str] = set()
    for value in values:
        serialized = (
            value
            if isinstance(value, str)
            else json.dumps(value, ensure_ascii=False, default=_json_default)
        )
        for match in PDF_NAME_PATTERN.findall(serialized):
            file_name = match.strip()
            key = file_name.casefold()
            if key not in seen:
                observed.append(file_name)
                seen.add(key)
    return observed


def _normalized_text(value: str) -> str:
    return " ".join(value.casefold().split())


def _build_metrics(
    benchmark_query: dict[str, Any],
    answer: str | None,
    tool_calls: list[dict[str, Any]],
) -> dict[str, Any]:
    trace_values: list[Any] = []
    for call in tool_calls:
        trace_values.extend((call.get("args"), call.get("output_summary")))
    if answer:
        trace_values.append(answer)

    retrieved_files = _extract_pdf_names(trace_values)
    retrieved_keys = {name.casefold() for name in retrieved_files}
    required = [str(name) for name in benchmark_query.get("required", [])]
    optional = [str(name) for name in benchmark_query.get("optional", [])]
    hard_negative = [str(name) for name in benchmark_query.get("hard_negative", [])]
    required_found = [name for name in required if name.casefold() in retrieved_keys]
    optional_found = [name for name in optional if name.casefold() in retrieved_keys]
    hard_negative_found = [
        name for name in hard_negative if name.casefold() in retrieved_keys
    ]
    expected_answer = str(benchmark_query.get("answer") or "")

    return {
        "retrieved_files": retrieved_files,
        "required_found": required_found,
        "optional_found": optional_found,
        "hard_negative_found": hard_negative_found,
        "required_recall": (
            len(required_found) / len(required) if required else 1.0
        ),
        "exact_required_set_without_hard_negative": (
            len(required_found) == len(required) and not hard_negative_found
        ),
        "normalized_answer_match": bool(
            answer
            and expected_answer
            and _normalized_text(answer) == _normalized_text(expected_answer)
        ),
        "trace_output_notice": (
            "File metrics use gRPC tool-trace previews, which are currently "
            "truncated by the server."
        ),
    }


JUDGE_PROMPT = """You are a strict evaluation judge for a document question-answering benchmark.

Compare the model answer against the expected answer for the question below.
Judge only factual agreement on what the question asks (values, entities,
deadlines, percentages). Ignore formatting, citations like [1], markdown, and
extra commentary. Numeric values must match; equivalent phrasings of the same
fact count as a match.

Question:
{query}

Expected answer:
{expected_answer}

Model answer:
{answer}

Respond with ONLY a JSON object, no markdown fences, in this exact shape:
{{"verdict": "correct" | "partially_correct" | "incorrect", "score": <float between 0.0 and 1.0>, "reasoning": "<one or two sentences>"}}

Rules:
- "correct" (score 1.0): every fact the question asks for matches the expected answer.
- "partially_correct" (score strictly between 0.0 and 1.0, proportional to matched facts): some facts match, some are wrong or missing.
- "incorrect" (score 0.0): the answer addresses a different question or contradicts the expected facts.
"""


def _parse_judge_response(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", text).strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError(f"Judge returned no JSON object: {raw[:200]}")
    payload = json.loads(match.group(0))
    verdict = str(payload.get("verdict") or "").strip().lower()
    if verdict not in {"correct", "partially_correct", "incorrect"}:
        raise ValueError(f"Judge returned invalid verdict: {verdict!r}")
    score = max(0.0, min(1.0, float(payload.get("score", 0.0))))
    return {
        "verdict": verdict,
        "score": score,
        "reasoning": str(payload.get("reasoning") or "").strip(),
    }


def _judge_credentials(config: EvaluatorConfig) -> tuple[str, str]:
    base_url = config.judge_base_url or os.getenv("LITELLM_API_BASE_URL", "").strip()
    api_key = os.getenv(config.judge_api_key_env, "").strip()
    if not base_url or not api_key:
        try:
            from src.config.settings import get_settings

            settings = get_settings()
            base_url = base_url or settings.LITELLM_API_BASE_URL
            api_key = api_key or settings.LITELLM_API_SECRET_KEY
        except Exception:
            pass
    if not base_url or not api_key:
        raise ValueError(
            "LLM judge requires a base URL and API key: set judge_base_url in the "
            f"config or LITELLM_API_BASE_URL, and the {config.judge_api_key_env} "
            "environment variable"
        )
    return base_url, api_key


async def _judge_answer(
    config: EvaluatorConfig,
    benchmark_query: dict[str, Any],
    answer: str,
) -> dict[str, Any]:
    """Ask the judge model whether the answer matches the expected answer."""

    from langchain_core.messages import HumanMessage
    from langchain_openai import ChatOpenAI

    base_url, api_key = _judge_credentials(config)
    llm = ChatOpenAI(
        base_url=base_url,
        api_key=api_key,
        model=config.judge_model,
    )
    prompt = JUDGE_PROMPT.format(
        query=benchmark_query["query"],
        expected_answer=str(benchmark_query.get("answer") or ""),
        answer=answer,
    )
    response = await llm.ainvoke([HumanMessage(content=prompt)])
    parsed = _parse_judge_response(str(response.content))
    parsed["model"] = config.judge_model
    return parsed


async def _judge_safely(
    config: EvaluatorConfig,
    benchmark_query: dict[str, Any],
    answer: str | None,
) -> dict[str, Any] | None:
    if not config.judge_model:
        return None
    if not answer or not str(benchmark_query.get("answer") or "").strip():
        return {
            "verdict": "not_judged",
            "score": None,
            "reasoning": "Missing model answer or expected answer.",
            "model": config.judge_model,
        }
    try:
        return await _judge_answer(config, benchmark_query, answer)
    except Exception as exc:
        return {
            "verdict": "judge_error",
            "score": None,
            "reasoning": f"{type(exc).__name__}: {exc}",
            "model": config.judge_model,
        }


async def _consume_stream(
    stub: pb_grpc.PlaybookFlowRuntimeStub,
    request: pb.RunRequest,
    metadata: tuple[tuple[str, str], ...],
    events_path: Path,
    answer_node_id: str | None,
) -> tuple[str, str | None, str | None, list[dict[str, Any]]]:
    status = "running"
    error: str | None = None
    answer: str | None = None
    last_completed_answer: str | None = None
    node_errors: list[str] = []
    traces_by_node: dict[tuple[str, int], list[dict[str, Any]]] = {}

    with events_path.open("w", encoding="utf-8") as event_stream:
        call: AsyncIterator[pb.RunEvent] = stub.Run(request, metadata=metadata)
        async for event in call:
            event_payload = _event_to_dict(event)
            _append_json_line(event_stream, event_payload)
            _collect_tool_trace(traces_by_node, event_payload)

            event_type = event.event_type
            payload = event_payload.get("payload") or {}
            if event_type == "NodeCompleted":
                candidate = _answer_from_payload(payload)
                if candidate:
                    last_completed_answer = candidate
                    if not answer_node_id or event.node_id == answer_node_id:
                        answer = candidate
            elif event_type == "NodeFailed":
                node_error = str(payload.get("error") or "Node failed without error detail")
                node_errors.append(f"[node {event.node_id}] {node_error}")
            elif event_type == TERMINAL_SUCCESS:
                status = "completed"
            elif event_type == TERMINAL_FAILURE:
                status = "failed"
                error = str(payload.get("error") or "Playbook execution failed")

    if answer is None and not answer_node_id:
        answer = last_completed_answer
    if status == "running":
        status = "incomplete"
        error = "The gRPC stream ended without an execution terminal event"
    # A node can fail while the execution still reports ExecutionCompleted;
    # surface that failure instead of returning a silently empty answer.
    if node_errors and error is None:
        error = " | ".join(node_errors)
        if status == "completed" and answer is None:
            status = "node_failed"
    return status, answer, error, _flatten_tool_trace(traces_by_node)


async def _run_one_query(
    stub: pb_grpc.PlaybookFlowRuntimeStub,
    metadata: tuple[tuple[str, str], ...],
    request_template: dict[str, Any],
    benchmark_query: dict[str, Any],
    run_directory: Path,
    config: EvaluatorConfig,
) -> dict[str, Any]:
    query_id = str(benchmark_query["id"])
    query_directory = run_directory / _safe_query_id(query_id)
    query_directory.mkdir(parents=True, exist_ok=False)

    request_payload, execution_id = _build_request_payload(
        request_template,
        benchmark_query,
        config,
    )
    request = _payload_to_run_request(request_payload)
    _write_json(query_directory / "request.json", request_payload)
    events_path = query_directory / "events.jsonl"

    started_at = time.perf_counter()
    status = "failed"
    answer: str | None = None
    error: str | None = None
    tool_calls: list[dict[str, Any]] = []

    print(f"[{query_id}] started as {execution_id}", flush=True)
    try:
        status, answer, error, tool_calls = await asyncio.wait_for(
            _consume_stream(
                stub=stub,
                request=request,
                metadata=metadata,
                events_path=events_path,
                answer_node_id=config.answer_node_id,
            ),
            timeout=config.timeout_seconds,
        )
    except TimeoutError:
        status = "timed_out"
        error = f"Query exceeded {config.timeout_seconds} seconds"
    except grpc.aio.AioRpcError as exc:
        status = "grpc_error"
        error = f"{exc.code().name}: {exc.details()}"
    except Exception as exc:
        status = "failed"
        error = f"{type(exc).__name__}: {exc}"

    if not tool_calls or answer is None:
        recovered_answer, recovered_tool_calls = _recover_from_events(
            events_path,
            config.answer_node_id,
        )
        if answer is None:
            answer = recovered_answer
        if not tool_calls:
            tool_calls = recovered_tool_calls

    duration_ms = int((time.perf_counter() - started_at) * 1000)
    _write_json(query_directory / "tool_calls.json", tool_calls)
    metrics = _build_metrics(benchmark_query, answer, tool_calls)
    judge = await _judge_safely(config, benchmark_query, answer)
    if judge is not None:
        metrics["llm_judge"] = judge
    result = {
        "query_id": query_id,
        "query": benchmark_query["query"],
        "expected_answer": benchmark_query.get("answer"),
        "required": benchmark_query.get("required", []),
        "optional": benchmark_query.get("optional", []),
        "hard_negative": benchmark_query.get("hard_negative", []),
        "skills": benchmark_query.get("skills", []),
        "execution_id": execution_id,
        "status": status,
        "answer": answer,
        "tool_call_count": len(tool_calls),
        "duration_ms": duration_ms,
        "error": error,
        "metrics": metrics,
    }
    _write_json(query_directory / "result.json", result)
    print(
        f"[{query_id}] {status} in {duration_ms} ms "
        f"with {len(tool_calls)} tool call(s)",
        flush=True,
    )
    return result


def _summary(results: list[dict[str, Any]]) -> dict[str, Any]:
    completed = [item for item in results if item["status"] == "completed"]
    recalls = [
        float(item["metrics"]["required_recall"])
        for item in completed
    ]
    exact_sets = [
        bool(item["metrics"]["exact_required_set_without_hard_negative"])
        for item in completed
    ]
    answer_matches = [
        bool(item["metrics"]["normalized_answer_match"])
        for item in completed
    ]
    judge_scores = [
        float(item["metrics"]["llm_judge"]["score"])
        for item in completed
        if isinstance(item["metrics"].get("llm_judge"), dict)
        and item["metrics"]["llm_judge"].get("score") is not None
    ]
    judge_correct = [
        item["metrics"]["llm_judge"].get("verdict") == "correct"
        for item in completed
        if isinstance(item["metrics"].get("llm_judge"), dict)
        and item["metrics"]["llm_judge"].get("score") is not None
    ]
    summary: dict[str, Any] = {
        "query_count": len(results),
        "completed_count": len(completed),
        "failed_count": len(results) - len(completed),
        "average_required_recall": sum(recalls) / len(recalls) if recalls else 0.0,
        "exact_set_accuracy": (
            sum(exact_sets) / len(exact_sets) if exact_sets else 0.0
        ),
        "normalized_answer_accuracy": (
            sum(answer_matches) / len(answer_matches) if answer_matches else 0.0
        ),
    }
    if judge_scores:
        summary["judge_average_score"] = sum(judge_scores) / len(judge_scores)
        summary["judge_accuracy"] = sum(judge_correct) / len(judge_correct)
        summary["judged_count"] = len(judge_scores)
    summary["results"] = results
    return summary


async def run_benchmark(
    config: EvaluatorConfig,
    request_template: dict[str, Any],
) -> Path:
    """Run selected benchmark queries sequentially and return the run directory."""

    _validate_request_template(request_template, config)
    queries = _load_queries(config)
    metadata = _metadata(config)

    output_root = Path(config.output_directory)
    output_root.mkdir(parents=True, exist_ok=True)
    run_directory = output_root / datetime.now(timezone.utc).strftime(
        "%Y%m%d_%H%M%S_%f"
    )
    run_directory.mkdir(parents=False, exist_ok=False)
    _write_json(run_directory / "effective_config.json", asdict(config))

    results: list[dict[str, Any]] = []
    channel = _channel(config)
    try:
        stub = pb_grpc.PlaybookFlowRuntimeStub(channel)
        for benchmark_query in queries:
            result = await _run_one_query(
                stub,
                metadata,
                request_template,
                benchmark_query,
                run_directory,
                config,
            )
            results.append(result)
    finally:
        await channel.close()

    _write_json(run_directory / "summary.json", _summary(results))
    return run_directory


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run deep-search benchmark queries through PlaybookFlowRuntime.Run."
    )
    parser.add_argument(
        "--config",
        default="evaluation/config.json",
        help="Path to evaluator config JSON.",
    )
    parser.add_argument(
        "--query-id",
        action="append",
        default=[],
        help="Run only this query ID; repeat for multiple IDs.",
    )
    parser.add_argument(
        "--validate",
        action="store_true",
        help="Validate config, request template, and benchmark without calling gRPC.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv or sys.argv[1:])

    try:
        config = _load_config(args.config)
        if args.query_id:
            config = EvaluatorConfig(
                **{
                    **asdict(config),
                    "query_ids": tuple(args.query_id),
                }
            )
        request_template = _load_request_template(config.request_template_path)
        _validate_request_template(request_template, config)
        queries = _load_queries(config)
        if args.validate:
            print(
                f"Configuration valid. Selected queries: "
                f"{', '.join(str(item['id']) for item in queries)}"
            )
            return 0

        run_directory = asyncio.run(run_benchmark(config, request_template))
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("Evaluation interrupted.", file=sys.stderr)
        return 130

    print(f"Evaluation finished. Results: {run_directory}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
