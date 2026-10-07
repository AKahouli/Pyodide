import asyncio

from src.flow_engine.runtime.graph_cache import CompiledGraphCache, snapshot_hash


def test_same_snapshot_compiles_once():
    cache = CompiledGraphCache()
    snapshot = {"nodes": [{"id": "node-1"}], "settings": {"mode": "fast"}}
    compile_calls = {"count": 0}

    async def compile_graph(current_snapshot):
        compile_calls["count"] += 1
        return {"compiled_from": current_snapshot}

    async def run_test():
        graph_a, key_a, hit_a = await cache.get_or_compile(snapshot, compile_graph)
        graph_b, key_b, hit_b = await cache.get_or_compile(snapshot, compile_graph)

        assert hit_a is False
        assert hit_b is True
        assert key_a == snapshot_hash(snapshot)
        assert key_b == key_a
        assert graph_a is graph_b

    asyncio.run(run_test())
    assert compile_calls["count"] == 1


def test_cache_scope_forces_recompile():
    cache = CompiledGraphCache()
    snapshot = {"nodes": [{"id": "node-1"}]}
    compile_calls = {"count": 0}

    async def compile_graph(current_snapshot):
        compile_calls["count"] += 1
        return {"compiled_from": current_snapshot, "count": compile_calls["count"]}

    async def run_test():
        graph_a, _, hit_a = await cache.get_or_compile(snapshot, compile_graph, cache_scope="cp-1")
        graph_b, _, hit_b = await cache.get_or_compile(snapshot, compile_graph, cache_scope="cp-2")

        assert hit_a is False
        assert hit_b is False
        assert graph_a != graph_b

    asyncio.run(run_test())
    assert compile_calls["count"] == 2


def test_concurrent_identical_lookups_compile_once():
    cache = CompiledGraphCache()
    snapshot = {"nodes": [{"id": "node-1"}]}
    compile_calls = {"count": 0}

    async def compile_graph(current_snapshot):
        compile_calls["count"] += 1
        await asyncio.sleep(0.01)
        return {"compiled_from": current_snapshot}

    async def run_test():
        results = await asyncio.gather(*[
            cache.get_or_compile(snapshot, compile_graph)
            for _ in range(10)
        ])

        assert len({id(graph) for graph, _, _ in results}) == 1
        assert sum(1 for _, _, hit in results if hit) == 9

    asyncio.run(run_test())
    assert compile_calls["count"] == 1


def test_ttl_expires_entries():
    cache = CompiledGraphCache(ttl_seconds=0.01)
    snapshot = {"nodes": [{"id": "node-1"}]}
    compile_calls = {"count": 0}

    async def compile_graph(current_snapshot):
        compile_calls["count"] += 1
        return {"compiled_from": current_snapshot, "count": compile_calls["count"]}

    async def run_test():
        graph_a, _, hit_a = await cache.get_or_compile(snapshot, compile_graph)
        await asyncio.sleep(0.05)
        graph_b, _, hit_b = await cache.get_or_compile(snapshot, compile_graph)

        assert hit_a is False
        assert hit_b is False
        assert graph_a != graph_b

    asyncio.run(run_test())
    assert compile_calls["count"] == 2


def test_lru_evicts_oldest_entry():
    cache = CompiledGraphCache(max_entries=2, ttl_seconds=900)

    async def compile_graph(current_snapshot):
        return {"compiled_from": current_snapshot}

    async def run_test():
        await cache.get_or_compile({"nodes": [{"id": "node-1"}]}, compile_graph)
        await cache.get_or_compile({"nodes": [{"id": "node-2"}]}, compile_graph)
        await cache.get_or_compile({"nodes": [{"id": "node-3"}]}, compile_graph)

        assert cache.size == 2
        assert snapshot_hash({"nodes": [{"id": "node-1"}]}) not in cache._entries

    asyncio.run(run_test())


def test_snapshot_hash_ignores_runtime_session_id():
    first_snapshot = {
        "nodes": [{
            "id": "node-1",
            "metadata": {
                "agent_params": {
                    "user_id": "user-1",
                    "session_id": "exec-1",
                },
            },
        }],
    }
    second_snapshot = {
        "nodes": [{
            "id": "node-1",
            "metadata": {
                "agent_params": {
                    "user_id": "user-1",
                    "session_id": "exec-2",
                },
            },
        }],
    }

    assert snapshot_hash(first_snapshot) == snapshot_hash(second_snapshot)


def test_reconfigure_clears_entries_when_policy_changes():
    cache = CompiledGraphCache(max_entries=2, ttl_seconds=10)

    async def run_test():
        await cache.get_or_compile({"nodes": [{"id": "node-1"}]}, lambda snapshot: snapshot)
        cache.reconfigure(max_entries=4, ttl_seconds=20)

    asyncio.run(run_test())
    assert cache.size == 0
    assert cache.max_entries == 4
    assert cache.ttl_seconds == 20
