"""Reproducible CPU probes and optional receiving-agent session usage summary.

Run as python -m scripts.measure_search_review --baseline-ref 6bc9847.
No database, model API, or production source content is used by the CPU probes.
"""
import argparse
import json
import math
import os
import statistics
import subprocess
import time
import types
import uuid
from pathlib import Path

from src.mcp_server import context_navigation, evidence


def distribution(values):
    values = sorted(values)
    if not values:
        return None
    return {"count": len(values), "p50": statistics.median(values),
            "p95": values[math.ceil(len(values) * .95) - 1]}


def summarize_sessions(records):
    """Use provider-reported totals; cached tokens are a subset of input tokens.

    Each JSONL record represents one complete session (including retries).
    Missing usage is unknown, never silently counted as zero. Answer success
    must come from the receiving evaluator, not from HTTP status.
    """
    identifiers = [r["session_id"] for r in records]
    if len(set(identifiers)) != len(identifiers):
        raise ValueError("Expected one complete record per session_id")
    successful = [r for r in records if r.get("success") is True]
    tokens, missing = [], 0
    for record in successful:
        calls = record.get("model_calls")
        if not calls or any(not isinstance(c.get(k), int) or isinstance(c.get(k), bool)
                            or c[k] < 0 for c in calls for k in ("input_tokens", "output_tokens")):
            missing += 1
            continue
        tokens.append(sum(c["input_tokens"] + c["output_tokens"] for c in calls))
    return {"sessions": len(records), "successful_sessions": len(successful),
            "successful_sessions_missing_usage": missing,
            "successful_session_tokens": distribution(tokens),
            "successful_session_latency_ms": distribution([
                r["duration_ms"] for r in successful if r.get("duration_ms") is not None]),
            "retrieval_latency_ms": distribution([
                c["duration_ms"] for r in records for c in r.get("retrieval_calls", [])
                if c.get("duration_ms") is not None])}


def baseline_module(ref, filename):
    repo = Path(__file__).resolve().parents[1]
    source = subprocess.run(["git", "-c", "safe.directory=" + str(repo), "show",
                             ref + ":src/mcp_server/" + filename + ".py"],
                            cwd=repo, check=True, capture_output=True, text=True, encoding="utf-8").stdout
    module = types.ModuleType("baseline_" + filename)
    exec(compile(source, ref + "/" + filename, "exec"), module.__dict__)
    return module


def timed(operation, repeat):
    operation()  # Warm import/cache effects; these are CPU probes, not cold-start timings.
    durations = []
    for _ in range(repeat):
        start = time.perf_counter()
        result = operation()
        durations.append((time.perf_counter() - start) * 1000)
    return result, distribution(durations)


def probe(pack, paginate, repeat):
    sections = [{"section_id": n, "file_name": "policy.pdf", "workspace_id": "ws",
                 "document_id": "d", "has_more_blocks": False,
                 "blocks": [{"block_id": n * 100 + b, "content": "x" * 1000,
                             **({"selection": "adjacent"} if b != 4 else {"score": .8})}
                            for b in range(9)]} for n in range(10)]
    packed, packing_ms = timed(lambda: pack(sections, 24000), repeat)
    content = {"target_section_id": 1, "workspace_id": "ws", "content": "source \u4f8b\u5916\n" * 100000}
    page, pagination_ms = timed(lambda: paginate(content, 0, 24000), repeat)
    assert evidence.serialized_bytes(packed) <= 24000
    assert evidence.serialized_bytes(page) <= 24000
    return {"packing_ms": packing_ms, "pagination_first_page_ms": pagination_ms,
            "response_bytes": evidence.serialized_bytes(packed),
            "delivered_blocks_per_section": {s["section_id"]: len(s["blocks"])
                for doc in packed["documents"] for s in doc["sections"]},
            "sections_with_primary": sum(any(b["block_id"] == s["section_id"] * 100 + 4
                for b in s["blocks"]) for doc in packed["documents"] for s in doc["sections"]),
            "first_page_characters": len(page["content"])}


def database_probe(repeat):
    """Benchmark exact retrieval with/without request-local text reuse.

    Requires an explicitly supplied isolated TEST_DATABASE_URL. Its temporary
    schema is dropped in finally; the normal DATABASE_URL is never consulted.
    """
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import Session
    from src.db.models import Base, LogicalDocument, LogicalSection, LogicalBlock
    from src.mcp_server import db_helpers
    from src.mcp_server.section_search import search_section_evidence

    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        raise ValueError("--database requires an isolated TEST_DATABASE_URL")
    engine = create_engine(url)
    schema = "review_measure_" + uuid.uuid4().hex
    vector = [1.0] + [0.0] * (LogicalBlock.embedding.type.dim - 1)
    try:
        with engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        scoped = engine.execution_options(schema_translate_map={None: schema})
        Base.metadata.create_all(scoped)
        with Session(scoped) as session:
            session.add(LogicalDocument(id="review", workspace_id="review", user_id="test",
                                        file_name="review.pdf", total_pages=10, fts_config="simple"))
            session.flush()
            session.add_all([LogicalSection(id=s, section_id=str(s), document_id="review",
                workspace_id="review", title="Approval policy", embedding=vector) for s in range(1, 11)])
            session.flush()
            session.add_all([LogicalBlock(id=s * 100 + b, section_id=str(s), document_id="review",
                workspace_id="review", block_type="text", page_number=s, embedding=vector,
                content="Approval is required. Except in emergencies. " * 100)
                for s in range(1, 11) for b in range(1, 11)])
            session.commit()

        def retrieve(reuse):
            with Session(scoped) as session:
                cache = {}
                hits = db_helpers.unified_search(session, "approval", vector,
                    workspace_id="review", limit=5, include_lexical=False,
                    block_content_cache=cache if reuse else None)
                return search_section_evidence(session, [h["section_id"] for h in hits],
                    "review", "approval", vector, top_k=3,
                    preferred_blocks={h["section_id"]: h["matched_block"]["block_id"]
                                      for h in hits if h.get("matched_block")},
                    block_content_cache=cache if reuse else None)

        previous, previous_ms = timed(lambda: retrieve(False), repeat)
        current, current_ms = timed(lambda: retrieve(True), repeat)
        if previous != current:
            raise AssertionError("Hydration reuse changed selected evidence")
        return {"scope": "Isolated synthetic SQL retrieval, 10 sections/100 blocks; vector discovery and exact local ranking",
                "without_text_reuse_ms": previous_ms, "with_text_reuse_ms": current_ms,
                "identical_evidence": True}
    finally:
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-ref")
    parser.add_argument("--repeat", type=int, default=30)
    parser.add_argument("--sessions", type=Path, help="One normalized complete-session record per JSONL line")
    parser.add_argument("--database", action="store_true", help="Use isolated TEST_DATABASE_URL for a synthetic SQL probe")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.repeat < 1:
        parser.error("--repeat must be positive")
    report = {"scope": "Synthetic warm CPU probes; not database or production benchmarks",
              "current": probe(evidence.group_evidence, context_navigation.paginate_context, args.repeat),
              "session_measurements": None}
    if args.baseline_ref:
        old_evidence = baseline_module(args.baseline_ref, "evidence")
        old_context = baseline_module(args.baseline_ref, "context_navigation")
        report["baseline_ref"] = args.baseline_ref
        report["baseline"] = probe(old_evidence.group_evidence, old_context.paginate_context, args.repeat)
    if args.sessions:
        report["session_measurements"] = summarize_sessions([
            json.loads(line) for line in args.sessions.read_text(encoding="utf-8").splitlines() if line.strip()])
    if args.database:
        report["database_retrieval"] = database_probe(args.repeat)
    output = json.dumps(report, indent=2)
    if args.output:
        args.output.write_text(output + "\n", encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
