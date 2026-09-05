"""Latency benchmark for the RunSingleAgent gRPC RPC (mono flow).

Scenario per ADK-upgrade baseline: simple agent, no tools, no documents,
"hi" query, same model for every run. Each run carries a LatencyTraceContext
so the server emits ``conversation_latency_diag.*`` structured logs tagged
with the request id (grep the server log for those ids).

Usage:
    python scripts/bench_single_agent.py <model> [runs] [new|existing]

The model is mandatory: framework comparisons must not silently fall back to
a default and end up comparing ADK A + model X against ADK B + model Y.
Prints one JSON object per run on stdout; aggregate percentiles on stderr.
"""

import json
import sys
import time
import uuid

import grpc

from src.grpc_generated import chatbot_pb2, chatbot_pb2_grpc

if len(sys.argv) < 2:
    raise SystemExit("Usage: bench_single_agent.py <model> [runs] [new|existing]")

MODEL = sys.argv[1]
RUNS = int(sys.argv[2]) if len(sys.argv) > 2 else 10
MODE = sys.argv[3] if len(sys.argv) > 3 else "new"
SHARED_CONV = f"bench-shared-{uuid.uuid4().hex[:8]}"


def run_once(stub, i):
    if MODE == "existing":
        conv_id = SHARED_CONV
    else:
        conv_id = f"bench-new-{uuid.uuid4().hex[:12]}"
    request_id = f"bench-req-{uuid.uuid4().hex[:12]}"
    request = chatbot_pb2.RunSingleAgentRequest(
        user_context=chatbot_pb2.UserContext(user_id="bench-user", username="bencher"),
        conversation_id=conv_id,
        query="hi",
        agent=chatbot_pb2.Agent(
            id="agent-1",
            name="SoloAgent",
            description="A standalone assistant",
            prompt="You are SoloAgent, a concise helpful assistant. Answer directly.",
            chatbot=chatbot_pb2.Chatbot(model=MODEL),
        ),
        latency_trace_context=chatbot_pb2.LatencyTraceContext(
            schema_version=1,
            request_id=request_id,
            assistant_message_id=f"bench-msg-{uuid.uuid4().hex[:12]}",
            backend_received_epoch_ms=time.time() * 1000,
        ),
    )

    t0 = time.perf_counter()
    ttft_ms = None
    chunks = 0
    text_chars = 0
    for chunk in stub.RunSingleAgent(request, timeout=180):
        chunks += 1
        ctype = chunk.component.WhichOneof("data")
        if ctype == "text":
            if ttft_ms is None:
                ttft_ms = (time.perf_counter() - t0) * 1000
            text_chars += len(chunk.component.text.content)
    total_ms = (time.perf_counter() - t0) * 1000
    return {
        "run": i,
        "mode": MODE,
        "model": MODEL,
        "conversation_id": conv_id,
        "request_id": request_id,
        "ttft_ms": round(ttft_ms, 1) if ttft_ms is not None else None,
        "total_ms": round(total_ms, 1),
        "chunks": chunks,
        "text_chars": text_chars,
    }


def _percentiles(values):
    """p50/p90/p95 of a list; None entries (no token seen) are dropped."""
    ordered = sorted(v for v in values if v is not None)
    if not ordered:
        return {}

    def pct(p):
        idx = min(int(round((p / 100) * (len(ordered) - 1))), len(ordered) - 1)
        return round(ordered[idx], 1)

    return {"p50": pct(50), "p90": pct(90), "p95": pct(95)}


def main():
    channel = grpc.insecure_channel("127.0.0.1:50051")
    stub = chatbot_pb2_grpc.ChatbotServiceStub(channel)

    # Warm-up run (excluded): loads models/caches after a fresh server start.
    run_once(stub, 0)
    print("[bench] warm-up done", file=sys.stderr, flush=True)

    results = []
    for i in range(1, RUNS + 1):
        row = run_once(stub, i)
        results.append(row)
        print(json.dumps(row), flush=True)

    ttfts = [r["ttft_ms"] for r in results]
    totals = [r["total_ms"] for r in results]
    print(
        json.dumps(
            {
                "runs": RUNS,
                "mode": MODE,
                "model": MODEL,
                "ttft_ms": _percentiles(ttfts),
                "total_ms": _percentiles(totals),
            }
        ),
        file=sys.stderr,
        flush=True,
    )


if __name__ == "__main__":
    main()
