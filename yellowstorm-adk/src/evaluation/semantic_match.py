"""Semantic match evaluation helpers shared by HTTP and gRPC execution paths."""

import json
import math
from typing import List

import litellm

from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.similarity_search.embeddings import get_embeddings

logger = get_logger(__name__)
settings = get_settings()


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _normalize_similarity_to_score(similarity: float) -> int:
    normalized = max(0.0, min(1.0, (similarity + 1.0) / 2.0))
    return int(round(normalized * 100))


def _coerce_score(value: object, fallback: int) -> int:
    try:
        score = int(round(float(value)))
    except (TypeError, ValueError):
        return fallback
    return max(0, min(100, score))


def _build_evidence_text(tool_summaries: List[str] | None) -> str:
    cleaned = [summary.strip() for summary in (tool_summaries or []) if summary and summary.strip()]
    return "\n\n".join(cleaned)


async def _judge_semantic_match(
    *,
    baseline_output: str,
    current_output: str,
    task_title: str = "",
    task_description: str = "",
    prompt_trace: List[dict] | None = None,
    baseline_tool_summaries: List[str] | None = None,
    current_tool_summaries: List[str] | None = None,
) -> dict:
    judge_model = settings.EVALUATION_MODEL or settings.MEMORY_MODEL
    if not judge_model:
        raise RuntimeError("Semantic evaluation model is not configured")
    prompt = (
        "You compare a validated baseline output with a newly generated output for the same task.\n"
        "Focus on semantic equivalence, not wording. Return strict JSON only.\n\n"
        f"Task title: {task_title}\n"
        f"Task description: {task_description}\n\n"
        f"Validated baseline output:\n{baseline_output}\n\n"
        f"Current output:\n{current_output}\n\n"
        f"Validated baseline tool summaries:\n{json.dumps(baseline_tool_summaries or [], ensure_ascii=True)}\n\n"
        f"Current tool summaries:\n{json.dumps(current_tool_summaries or [], ensure_ascii=True)}\n\n"
        "Return a JSON object with keys:\n"
        "- semantic_match_score: integer 0..100\n"
        "- reason: short string\n"
        "- missing_points: array of short strings\n"
        "- changed_points: array of short strings\n"
    )

    if prompt_trace is not None:
        prompt_trace.append({
            "stage": "semantic_evaluation_judge",
            "model": judge_model,
            "prompt": "[SYSTEM]\nYou are a strict semantic evaluator. Output JSON only.\n\n"
            f"[USER]\n{prompt}",
        })

    response = await litellm.acompletion(
        model=judge_model,
        messages=[
            {"role": "system", "content": "You are a strict semantic evaluator. Output JSON only."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.1,
        response_format={"type": "json_object"},
        api_base=settings.LITELLM_API_BASE_URL,
        api_key=settings.LITELLM_API_SECRET_KEY,
    )
    content = response.choices[0].message.content if response.choices else "{}"
    parsed = json.loads(content or "{}")
    parsed["_model"] = judge_model
    return parsed


async def evaluate_semantic_match(
    *,
    baseline_output: str,
    current_output: str,
    user_id: str = "unknown",
    task_title: str = "",
    task_description: str = "",
    prompt_trace: List[dict] | None = None,
    baseline_tool_summaries: List[str] | None = None,
    current_tool_summaries: List[str] | None = None,
) -> dict | None:
    if not baseline_output.strip() or not current_output.strip():
        return None

    logger.info(
        "Semantic evaluation request user_id=%s task_title=%s baseline_length=%s current_length=%s",
        user_id,
        task_title,
        len(baseline_output),
        len(current_output),
    )

    embeddings = get_embeddings(user_id=user_id)
    baseline_vector = embeddings.embed_query(baseline_output)
    current_vector = embeddings.embed_query(current_output)
    similarity = _cosine_similarity(baseline_vector, current_vector)
    semantic_similarity_score = _normalize_similarity_to_score(similarity)

    baseline_evidence_text = _build_evidence_text(baseline_tool_summaries)
    current_evidence_text = _build_evidence_text(current_tool_summaries)
    if baseline_evidence_text and current_evidence_text:
        baseline_evidence_vector = embeddings.embed_query(baseline_evidence_text)
        current_evidence_vector = embeddings.embed_query(current_evidence_text)
        evidence_similarity = _cosine_similarity(baseline_evidence_vector, current_evidence_vector)
        evidence_consistency_score = _normalize_similarity_to_score(evidence_similarity)
    else:
        evidence_consistency_score = semantic_similarity_score

    judge_used = False
    judge_score = semantic_similarity_score
    reason = ""
    missing_points: List[str] = []
    changed_points: List[str] = []
    judge_model = ""

    try:
        judge_result = await _judge_semantic_match(
            baseline_output=baseline_output,
            current_output=current_output,
            task_title=task_title,
            task_description=task_description,
            prompt_trace=prompt_trace,
            baseline_tool_summaries=baseline_tool_summaries,
            current_tool_summaries=current_tool_summaries,
        )
        judge_used = True
        judge_score = _coerce_score(judge_result.get("semantic_match_score"), semantic_similarity_score)
        reason = str(judge_result.get("reason") or "")
        missing_points = [str(item) for item in (judge_result.get("missing_points") or [])][:10]
        changed_points = [str(item) for item in (judge_result.get("changed_points") or [])][:10]
        judge_model = str(judge_result.get("_model") or "")
    except Exception as exc:
        logger.warning(
            "Semantic evaluation judge failed, using embedding-only score user_id=%s error=%s",
            user_id,
            str(exc),
        )
        reason = "Embedding-only score used because semantic judge failed."

    final_score = _coerce_score(
        (semantic_similarity_score * 0.5) + (evidence_consistency_score * 0.25) + (judge_score * 0.25),
        semantic_similarity_score,
    )

    return {
        "match_score": final_score,
        "semantic_similarity_score": semantic_similarity_score,
        "evidence_consistency_score": evidence_consistency_score,
        "judge_score": judge_score,
        "reason": reason,
        "missing_points": missing_points,
        "changed_points": changed_points,
        "model": judge_model,
        "judge_used": judge_used,
    }
