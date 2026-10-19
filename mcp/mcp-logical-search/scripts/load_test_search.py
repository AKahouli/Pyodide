"""Closed-loop MCP search load probe. Sends real requests; model calls may cost money.

Run with a JSON array of search argument objects. Reports timings and error
counts, never stores queries, document contents, tokens or exception messages.
"""
import argparse
import asyncio
from collections import Counter
import json
import math
import os
from pathlib import Path
import time

from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport


def percentile(values, fraction):
    ordered = sorted(values)
    return round(ordered[max(0, math.ceil(len(ordered) * fraction) - 1)], 2) if ordered else None


def has_error(value):
    if isinstance(value, dict):
        return bool(value.get("error")) or any(has_error(item) for item in value.values())
    return isinstance(value, list) and any(has_error(item) for item in value)


async def run(args, cases, key):
    workspaces = sorted({workspace for case in cases for workspace in (
        [case["workspace_id"]] if isinstance(case["workspace_id"], str) else case["workspace_id"])})
    headers = {"Authorization": f"Bearer {key}", "Workspace-Id": ",".join(workspaces)}
    pending = iter(range(args.requests))
    samples, errors, sizes = [], Counter(), []
    connections = Counter()
    ready = asyncio.Event()
    waiting = 0

    async def call(client, case):
        result = await client.call_tool_mcp("search", case, timeout=args.timeout)
        if result.isError:
            return "tool_error", 0
        for block in result.content:
            if block.type == "text":
                try:
                    if has_error(json.loads(block.text)):
                        return "payload_error", 0
                except json.JSONDecodeError:
                    pass
        return None, len(result.model_dump_json().encode("utf-8"))

    async def worker():
        nonlocal waiting
        try:
            transport = StreamableHttpTransport(args.url, headers=headers, sse_read_timeout=args.timeout)
            async with Client(transport, timeout=args.timeout, init_timeout=args.timeout) as client:
                for index in range(args.warmup):
                    await call(client, cases[index % len(cases)])
                waiting += 1
                if waiting == args.concurrency:
                    ready.set()
                await ready.wait()
                for index in pending:
                    started = time.perf_counter()
                    try:
                        error, size = await call(client, cases[index % len(cases)])
                        if error:
                            errors[error] += 1
                        else:
                            sizes.append(size)
                    except Exception as exc:
                        errors[type(exc).__name__] += 1
                    samples.append((time.perf_counter() - started) * 1000)
        except Exception as exc:
            connections[type(exc).__name__] += 1
            waiting += 1
            if waiting == args.concurrency:
                ready.set()

    started = time.perf_counter()
    await asyncio.gather(*(worker() for _ in range(args.concurrency)))
    seconds = time.perf_counter() - started
    return {"mode": "closed_loop_real_mcp_search", "concurrency": args.concurrency,
        "cases": len(cases), "workspace_count": len(workspaces), "requested": args.requests,
        "completed": len(samples), "successful": len(sizes), "errors": dict(errors),
        "connection_errors": dict(connections), "warmup_calls_per_worker": args.warmup,
        "wall_seconds_including_connections_and_warmup": round(seconds, 2),
        "successful_requests_per_wall_second": round(len(sizes) / seconds, 2),
        "latency_ms_including_failed_calls": {"p50": percentile(samples, .5),
            "p95": percentile(samples, .95), "p99": percentile(samples, .99)},
        "response_bytes_p95": percentile(sizes, .95)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="Full streamable HTTP MCP endpoint, e.g. http://localhost:8045/http/")
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--requests", type=int, default=100)
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--timeout", type=float, default=45)
    parser.add_argument("--warmup", type=int, default=1)
    parser.add_argument("--api-key-env", default="MCP_API_KEY")
    parser.add_argument("--output", type=Path, default=Path("logs/search-load-test.json"))
    args = parser.parse_args()
    if min(args.requests, args.concurrency, args.timeout) <= 0 or args.warmup < 0:
        parser.error("Request count, concurrency and timeout must be positive; warmup must be nonnegative.")
    cases = json.loads(args.cases.read_text(encoding="utf-8"))
    if not isinstance(cases, list) or not cases or any(not isinstance(case, dict) or
        not isinstance(case.get("query"), str) or not case.get("workspace_id") for case in cases):
        parser.error("Cases must be a nonempty JSON array of search arguments with query and workspace_id.")
    key = os.environ.get(args.api_key_env)
    if not key:
        parser.error(f"Set {args.api_key_env} in the environment.")
    report = asyncio.run(run(args, cases, key))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    if report["completed"] != args.requests or report["errors"] or report["connection_errors"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
