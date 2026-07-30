"""Human-agent directory — looked up via the platform's public agents API
instead of a hardcoded roster.

search_human_agents() backs two tools: `find_human_agents` (discovery — given
to the planner and to any persona-assigned step, see service.py) and the
resolution step inside `delegate_to_human_agent` (service.py:_delegate_tool_for).

ponytail: one small aiohttp GET, no client class, no caching — add caching
only if this endpoint turns out to be called often enough to matter.
"""
from __future__ import annotations

import asyncio
import logging
from typing import List, Optional

import aiohttp
import numpy as np

from src.config.settings import get_settings

logger = logging.getLogger(__name__)

SEMANTIC_TOP_K = 3
# Below this cosine similarity, treat it as no match rather than forcing one.
# Only applied to role-based fallback, never to a bare name search — a bare
# name embeds too noisily to trust (an unrelated name can outscore a genuine
# role match), so a name with no hit just stays a miss (see find_human_agents).
SEMANTIC_MIN_SIMILARITY = 0.30


async def search_human_agents(*, name: Optional[str] = None, role: Optional[str] = None) -> List[dict]:
    """GET {API_URL}/api/public/agents?name=...&role=... — the platform's
    directory of human agents a plan step can be assigned/delegated to.

    Returns a list of agent dicts (at least "name"; "role"/"id" when the API
    has them) or [] on any failure — a lookup miss should never break a turn,
    it just means the step falls back to the ordinary anonymous executor.
    """
    settings = get_settings()
    base = (settings.API_URL or "").rstrip("/")
    params = {k: v for k, v in (("name", name), ("role", role)) if v}
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
            async with session.get(
                f"{base}/api/v1/public/agents",
                params=params,
                headers={"x-api-key": settings.ADK_API_KEY},
            ) as resp:
                resp.raise_for_status()
                data = await resp.json()
    except Exception as e:
        logger.warning("search_human_agents failed name=%r role=%r: %s", name, role, e)
        return []
    # Response envelope is {success, data: {data: [...], meta}, meta} — unwrap
    # both the outer success-envelope and the inner paginated wrapper.
    if isinstance(data, dict):
        data = data.get("data", data)
    if isinstance(data, dict):
        data = data.get("data", data)
    return data if isinstance(data, list) else []


def _cosine(a: List[float], b: List[float]) -> float:
    a_arr, b_arr = np.array(a), np.array(b)
    denom = np.linalg.norm(a_arr) * np.linalg.norm(b_arr)
    return float(np.dot(a_arr, b_arr) / denom) if denom else 0.0


async def _semantic_top_k(query: str, k: int = SEMANTIC_TOP_K,
                          min_similarity: float = SEMANTIC_MIN_SIMILARITY) -> List[dict]:
    """Rank the full roster by embedding similarity to `query` — used when a
    literal role filter comes up empty. role is free text with no fixed
    vocabulary a caller can reliably guess (a step asking for "portfolio
    manager" has no way to know the stored text says "Investment approver"),
    so exact/substring matching hits a dead end that semantic similarity
    doesn't. Reuses the embeddings client already wired for smart_rag rather
    than standing up a vector index — this DB is self-hosted MongoDB, not
    Atlas, so no native vector search is available here anyway.

    Candidates below min_similarity are dropped rather than force-matched,
    to avoid misdirecting real work to an unrelated real person just because
    they were the closest of an irrelevant field.
    """
    from src.smart_rag.tools.utilities.esg_helpers import get_embeddings

    candidates = await search_human_agents()
    if not candidates:
        return []
    texts = [f"{a.get('name', '')}. {a.get('role', '')}" for a in candidates]
    query_vec, *vecs = await asyncio.gather(
        asyncio.to_thread(get_embeddings, query),
        *(asyncio.to_thread(get_embeddings, t) for t in texts))
    scored = sorted(zip(vecs, candidates), key=lambda vc: _cosine(query_vec, vc[0]), reverse=True)
    return [a for v, a in scored[:k] if _cosine(query_vec, v) >= min_similarity]


def make_find_human_agents_tool():
    """Discovery tool: given to the planner (to learn who exists before
    writing a plan) and to persona-assigned steps (to find who to delegate
    to) — see service.py's PLANNER_INSTRUCTION and _build_workflow."""
    from src.smart_rag.tools.search.tools import SearchToolADK

    async def find_human_agents(name: str = "", role: str = "") -> list:
        logger.info("[worky] find_human_agents called name=%r role=%r", name, role)
        agents = await search_human_agents(name=name or None, role=role or None)
        if not agents and role:
            # A bare name is a literal identifier, not a concept — a miss
            # stays a miss. role is free text with no fixed vocabulary, so
            # only role gets the semantic fallback.
            agents = await _semantic_top_k(f"{name} {role}".strip())
        logger.info("[worky] find_human_agents → %d match(es): %s",
                    len(agents), [a.get("name") for a in agents])
        return [{"id": a.get("id"), "name": a.get("name"), "role": a.get("role")} for a in agents]

    schema = {"function": {
        "name": "find_human_agents",
        "description": (
            "Look up available human agents by name and/or role. Use this to "
            "find who a step/question should be assigned or delegated to — "
            "there is no fixed roster, always check here first."),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "filter by (partial) name, or \"\" for any"},
                "role": {"type": "string", "description": "filter by role, or \"\" for any"},
            },
            "required": [],
            "additionalProperties": False,
        },
    }}
    return SearchToolADK(find_human_agents, schema)