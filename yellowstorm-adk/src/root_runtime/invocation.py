"""Native invocation input and lifecycle at the shared presenter boundary."""
from dataclasses import dataclass, field
import json
import re
import math
from typing import Any

from google.genai import types

from src.root_runtime.contracts import ExecutionEventV1, ExecutionScopeV1, InvocationLifecycleState

INPUT_FUNCTIONS = frozenset({"adk_request_input", "adk_request_confirmation"})


def _input_schema(raw, depth=0, budget=None):
    budget = budget if budget is not None else [0]
    if not isinstance(raw, dict) or depth > 5:
        return None
    data_keys = {"type", "properties", "required", "items", "enum", "additionalProperties",
                 "minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum"}
    annotations = {"title", "description", "default", "examples", "$schema", "deprecated", "readOnly", "writeOnly"}
    if set(raw) - data_keys - annotations:
        return None
    if "additionalProperties" in raw and not isinstance(raw["additionalProperties"], bool):
        return None
    kind = raw.get("type")
    if not isinstance(kind, str) or kind not in {"object", "array", "string", "number", "integer", "boolean"}:
        return None
    result = {"type": kind}
    for key in ("minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum"):
        if key not in raw:
            continue
        bound = raw[key]
        if type(bound) not in (int, float) or type(bound) is int and abs(bound) > 2**53 - 1 or not math.isfinite(bound):
            return None
        if key not in {"minimum", "maximum"} and (type(bound) is not int or bound < 0):
            return None
        result[key] = bound
    if "enum" in raw:
        options = raw["enum"]
        if not isinstance(options, list) or len(options) > 20 or any(
            not isinstance(item, (str, int, float, bool)) or isinstance(item, str) and len(item) > 1000
            or isinstance(item, float) and not math.isfinite(item)
            for item in options
        ):
            return None
        result["enum"] = options
    if kind == "object":
        properties = raw.get("properties")
        if not isinstance(properties, dict):
            return None
        result["properties"] = {}
        for key, value in properties.items():
            budget[0] += 1
            if (budget[0] > 64 or not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_ -]{1,100}", key)
                or key in {"__proto__", "constructor", "prototype"}):
                return None
            child = _input_schema(value, depth + 1, budget)
            if child is None:
                return None
            result["properties"][key] = child
        required = raw.get("required")
        if "required" in raw and (not isinstance(required, list) or any(not isinstance(key, str) or key not in properties for key in required)
            or len(set(required)) != len(required)):
            return None
        result["required"] = [key for key in required if isinstance(key, str) and key in properties] if isinstance(required, list) else []
    if kind == "array":
        child = _input_schema(raw.get("items"), depth + 1, budget)
        if child is None:
            return None
        result["items"] = child
    return result


def native_run_options(scope, content, responses=None):
    if scope is None or not scope.is_set:
        if responses:
            raise ValueError("Native input responses require a trusted execution scope")
        return {"new_message": content}
    if scope.resume_intent == "start":
        if scope.native_invocation_id or responses:
            raise ValueError("A fresh invocation cannot carry a resume identity or response")
        return {"new_message": content}
    if scope.resume_intent != "resume" or not scope.native_invocation_id or not scope.native_session_id:
        raise ValueError("Native resume requires an existing session and invocation")
    parts = []
    seen = set()
    for response in responses or []:
        input_id = response.get("input_id")
        name = response.get("function_name")
        if not input_id or name not in INPUT_FUNCTIONS or input_id in seen:
            raise ValueError("Invalid or duplicate native input response")
        seen.add(input_id)
        parts.append(types.Part(function_response=types.FunctionResponse(
            name=name, id=input_id, response=response.get("response") or {},
        )))
    # Original user input must never be appended again on native replay.
    return {"invocation_id": scope.native_invocation_id,
            "new_message": types.Content(role="user", parts=parts) if parts else None}


@dataclass
class NativeInvocationProjection:
    scope: ExecutionScopeV1 | None
    session_id: str
    agent_id: str
    invocation_id: str = ""
    pending: dict[str, str] = field(default_factory=dict)
    input_details: dict[str, dict] = field(default_factory=dict)
    input_versions: dict[str, int] = field(default_factory=dict)
    input_events: set[tuple[str, str]] = field(default_factory=set)
    started: bool = False

    def __post_init__(self):
        if self.scope is not None:
            self.invocation_id = self.scope.native_invocation_id or ""

    async def restore_pending(self, session_service, user_id, responses):
        if self.scope is None or self.scope.resume_intent != "resume":
            return
        from src.root_runtime.background_sessions import native_app_name
        session = await session_service.get_session(
            app_name=native_app_name(session_service), user_id=user_id, session_id=self.session_id,
        )
        if session is None:
            raise ValueError("The native session to resume does not exist")
        for event in session.events:
            if event.invocation_id != self.invocation_id:
                continue
            for part in getattr(event.content, "parts", None) or []:
                if part.function_call and part.function_call.name in INPUT_FUNCTIONS:
                    self.pending[part.function_call.id] = part.function_call.name
                    self.capture_input_details(part.function_call, getattr(event, 'id', ''))
                if part.function_response:
                    self.pending.pop(part.function_response.id, None)
                    self.input_details.pop(part.function_response.id, None)
        for response in responses or []:
            self.pending.pop(response["input_id"], None)
            self.input_details.pop(response["input_id"], None)

    def capture_input_details(self, call, event_id=''):
        identity = (event_id, call.id)
        if identity in self.input_events:
            return
        self.input_events.add(identity)
        version = self.input_versions.get(call.id, 0) + 1
        self.input_versions[call.id] = version
        # Confirmation arguments include the original tool call and may contain
        # credentials. Its UI uses a generic prompt; never project those args.
        if call.name != "adk_request_input":
            self.input_details[call.id] = {"input_version": version}
            return
        args = call.args or {}
        details = {"input_version": version}
        message = args.get("message")
        if isinstance(message, str):
            from src.flow_engine.observability.redaction import redact_string
            details["message"] = redact_string(message, 2000)
        raw_schema = args.get("response_schema")
        if raw_schema is None:
            details["response_schema_absent"] = True
        schema = _input_schema(raw_schema)
        if raw_schema is not None and schema is None:
            details["response_schema_unsupported"] = True
        if schema is not None:
            encoded = json.dumps(schema)
            if len(encoded.encode()) <= 8192:
                details["response_schema_json"] = encoded
            else:
                details["response_schema_unsupported"] = True
        self.input_details[call.id] = details

    async def emit(self, queue, lifecycle, source_event_id=None):
        if self.scope is None or not self.scope.is_set or queue is None:
            return
        trace = ExecutionEventV1(
            execution_id=self.scope.execution_id, producer_role=self.scope.role,
            lifecycle=lifecycle, work_group_id=self.scope.work_group_id,
            parent_execution_id=self.scope.parent_execution_id,
            producer_agent_id=self.agent_id, source_event_id=source_event_id,
            native_invocation_id=self.invocation_id,
        ).to_wire_dict()
        trace.update(native_session_id=self.session_id,
                     pending_inputs=[{"input_id": key, "function_name": name,
                                      **self.input_details.get(key, {})}
                                     for key, name in self.pending.items()])
        await queue.put({"action": "update", "metadata": {"message_id": self.session_id},
                         "execution_trace": trace})

    async def observe(self, event: Any, queue):
        if self.scope is None or not self.scope.is_set:
            return
        self.invocation_id = str(getattr(event, "invocation_id", "") or self.invocation_id)
        if not self.started:
            self.started = True
            await self.emit(queue, InvocationLifecycleState.STARTED, getattr(event, "id", None))
        changed = False
        for part in getattr(getattr(event, "content", None), "parts", None) or []:
            call = part.function_call
            if call and call.name in INPUT_FUNCTIONS and call.id:
                self.pending[call.id] = call.name
                self.capture_input_details(call, getattr(event, 'id', ''))
                changed = True
            response = part.function_response
            if response and response.id:
                self.pending.pop(response.id, None)
                self.input_details.pop(response.id, None)
        if changed:
            await self.emit(queue, InvocationLifecycleState.WAITING, getattr(event, "id", None))

    async def finish(self, queue, abort_signal, has_result):
        if abort_signal is not None and abort_signal.is_set():
            lifecycle = InvocationLifecycleState.CANCELLED
        elif self.pending:
            lifecycle = InvocationLifecycleState.WAITING
        else:
            lifecycle = InvocationLifecycleState.COMPLETED if has_result else InvocationLifecycleState.FAILED
        await self.emit(queue, lifecycle)
        return lifecycle
