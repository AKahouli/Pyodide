"""Router node implementation.

A router is a step node whose output is constrained to one of its
declared output labels.  The node uses an LLM to select a label from
outputLabels, then writes it into router_decisions[nodeId].

Max-iterations enforcement is handled by guards before the router runs.
"""

from __future__ import annotations

import json
from typing import Any

import litellm
from structlog import get_logger
from langgraph.config import get_stream_writer

from src.config.settings import get_settings
from src.flow_engine.nodes.router_conditions import (
    RouterConditionSourceUnavailableError,
    choose_deterministic_label,
)
from src.flow_engine.state import ExecutionState
from src.smart_rag.infrastructure.model_parameters import normalize_temperature_for_model

logger = get_logger(__name__)
settings = get_settings()

DEFAULT_MODEL = "azure/gpt-5.4-mini"


async def run_router(
    node_id: str,
    node_config: dict[str, Any],
    state: ExecutionState,
    node_inputs: dict[str, Any] | None = None,
) -> dict[str, Any]:
    iteration = state["iterations"].get(node_id, 0)
    router_cfg = node_config.get("router_config", {}) or {}
    output_labels = router_cfg.get("output_labels", ["continue"])
    label = str(node_config.get("label") or node_id)
    router_prompt = str(router_cfg.get("prompt") or "")
    router_mode = str(router_cfg.get("mode") or "").strip().lower()
    if router_mode not in ("ai", "deterministic"):
        router_mode = ""
    # ponytail: model reuses top-level model_id like step nodes; no separate router model field
    model = str(node_config.get("model_id") or DEFAULT_MODEL)

    logger.info("[router] Running router node", node_id=node_id, iteration=iteration, labels=output_labels)

    try:
        writer = get_stream_writer()
    except RuntimeError:
        writer = lambda _: None
    writer({
        "type": "NodeStarted",
        "node_id": node_id,
        "iteration": iteration,
        "payload": {"label": label},
    })

    preselected_label = state.get("router_decisions", {}).get(node_id)
    if preselected_label == "__error__" and preselected_label in output_labels:
        decision_payload = {"label": preselected_label, "mode": "error"}
        writer({
            "type": "RouterDecision",
            "node_id": node_id,
            "iteration": iteration,
            "payload": decision_payload,
        })
        writer({
            "type": "NodeCompleted",
            "node_id": node_id,
            "iteration": iteration,
            "payload": decision_payload,
        })
        return {
            "router_decisions": {node_id: preselected_label},
            "iterations": {node_id: iteration + 1},
        }

    chosen_label = output_labels[0]
    decision_payload: dict[str, Any] = {"label": chosen_label, "mode": "llm"}

    deterministic_decision: dict[str, Any] | None = None
    if router_mode != "ai":
        try:
            deterministic_decision = choose_deterministic_label(
                node_config,
                state,
                node_id=node_id,
                node_inputs=node_inputs,
            )
        except RouterConditionSourceUnavailableError as exc:
            writer({
                "type": "NodeFailed",
                "node_id": node_id,
                "iteration": iteration,
                "payload": {"error": str(exc)},
            })
            logger.warning(
                "[router] Deterministic routing blocked by unavailable source output",
                node_id=node_id,
                error=str(exc),
            )
            raise

    if deterministic_decision is not None:
        chosen_label = str(deterministic_decision["label"])
        decision_payload = {**deterministic_decision, "label": chosen_label}
        logger.info(
            "[router] Deterministic condition selected label",
            node_id=node_id,
            chosen=chosen_label,
            matched_condition_index=decision_payload.get("matched_condition_index"),
            used_default=decision_payload.get("used_default"),
        )

    if deterministic_decision is None and router_mode != "deterministic":
        try:
            litellm.api_base = settings.LITELLM_API_BASE_URL
            litellm.api_key = settings.LITELLM_API_SECRET_KEY
            litellm.drop_params = True

            labels_str = ", ".join(json.dumps(l) for l in output_labels)
            # The routing prompt is instructions for the model, so it belongs in the
            # system message. The user message always carries the context inputs —
            # previously a configured prompt replaced them and the model went blind.
            system_msg = (
                f"You are a routing decision engine. "
                f"Choose exactly one of the following labels: [{labels_str}]. "
                + (f"{router_prompt} " if router_prompt else "")
                + "Respond with only the label string, nothing else."
            )
            router_context = node_inputs if node_inputs is not None else state.get("inputs", {})
            user_msg = (
                f"Context: {json.dumps(router_context, default=str)}\n"
                f"Previous outputs: {json.dumps({str(k): v for k, v in state.get('task_outputs', {}).items()}, default=str)}\n"
                f"Iteration: {iteration}\n"
                f"Choose the best label from: {labels_str}"
            )

            response = await litellm.acompletion(
                model=model,
                messages=[
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": user_msg},
                ],
                temperature=normalize_temperature_for_model(model, 0.1),
                max_tokens=50,
                stream=False,
            )

            raw_choice = response.choices[0].message.content.strip().strip('"').strip("'")

            for label_candidate in output_labels:
                if raw_choice == label_candidate or label_candidate in raw_choice:
                    chosen_label = label_candidate
                    break

            decision_payload = {"label": chosen_label, "mode": "llm", "raw_choice": raw_choice}
            logger.info("[router] LLM selected label", node_id=node_id, chosen=chosen_label, raw=raw_choice)

        except Exception as exc:
            decision_payload = {"label": chosen_label, "mode": "llm-fallback", "used_default": True}
            logger.warning("[router] LLM routing failed — falling back to first label", node_id=node_id, error=str(exc))

    if deterministic_decision is None and router_mode == "deterministic":
        chosen_label = str(router_cfg.get("default_label") or output_labels[0])
        decision_payload = {"label": chosen_label, "mode": "deterministic", "used_default": True}

    writer({
        "type": "RouterDecision",
        "node_id": node_id,
        "iteration": iteration,
        "payload": decision_payload,
    })

    writer({
        "type": "NodeCompleted",
        "node_id": node_id,
        "iteration": iteration,
        "payload": decision_payload,
    })

    return {
        "router_decisions": {node_id: chosen_label},
        "iterations": {node_id: iteration + 1},
    }
