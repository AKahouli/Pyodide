"""Tests for identity-scoped MCP toolset reuse across turns."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from google.adk.tools.mcp_tool.mcp_toolset import (
    StdioConnectionParams,
    StdioServerParameters,
    StreamableHTTPConnectionParams,
)
from mcp.types import ListToolsResult, Tool

from src.smart_rag.infrastructure.external import mcp_helper, mcp_toolset_cache
from src.smart_rag.infrastructure.external.mcp_helper import MCPHelper
from src.smart_rag.infrastructure.external.mcp_toolset_cache import (
    McpToolsetCache,
    build_toolset_cache_key,
    prewarm_mcp_toolsets,
)
from src.smart_rag.infrastructure.external.purpose_aware_mcp import PurposeAwareMcpToolset

SCOPE = MCPHelper.build_cache_scope("user-1", "conv-1")


def http_params(url="https://mcp.example.com/mcp", **headers):
    return StreamableHTTPConnectionParams(url=url, headers=headers)


def key(params=None, mcp_type="mcp", tool_filter=None, scope=SCOPE):
    return build_toolset_cache_key(
        connection_params=params or http_params(user_id="user-1"),
        mcp_type=mcp_type,
        tool_filter=tool_filter,
        scope=scope,
        toolset_class=PurposeAwareMcpToolset,
    )


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class FakeToolset:
    def __init__(self):
        self.close = AsyncMock()


@pytest.fixture
def cache():
    return McpToolsetCache(max_entries=2, idle_seconds=60.0, close_grace_seconds=0.0)


@pytest.fixture
def helper_cache(cache):
    with patch.object(mcp_helper, "get_toolset_cache", return_value=cache):
        yield cache


async def drain(cache):
    await asyncio.gather(*list(cache._background))


class TestCacheKeyIsolation:
    def test_same_identity_same_key(self):
        assert key() == key()

    @pytest.mark.parametrize(
        "other",
        [
            dict(params=http_params(user_id="user-2")),
            dict(params=http_params(user_id="user-1", Authorization="Bearer a")),
            dict(params=http_params(url="https://other.example.com/mcp", user_id="user-1")),
            dict(scope=MCPHelper.build_cache_scope("user-1", "conv-2")),
            dict(scope=MCPHelper.build_cache_scope("user-2", "conv-1")),
            dict(mcp_type="vectorstore"),
            dict(tool_filter=["search"]),
        ],
    )
    def test_any_identity_difference_changes_key(self, other):
        assert key(**other) != key()

    def test_auth_header_change_changes_key_without_leaking_value(self):
        a = key(params=http_params(Authorization="Bearer secret-a"))
        b = key(params=http_params(Authorization="Bearer secret-b"))
        assert a != b
        assert "secret" not in a

    def test_tool_filter_order_is_irrelevant(self):
        assert key(tool_filter=["a", "b"]) == key(tool_filter=["b", "a"])

    def test_header_order_is_irrelevant(self):
        assert key(params=http_params(a="1", b="2")) == key(params=http_params(b="2", a="1"))

    @pytest.mark.parametrize(
        "kwargs",
        [
            dict(scope=None),
            dict(scope=""),
            dict(tool_filter=lambda tool, ctx=None: True),
            dict(params=StdioConnectionParams(server_params=StdioServerParameters(command="npx"), timeout=5)),
            dict(params=MagicMock()),
        ],
    )
    def test_uncacheable_identities_return_none(self, kwargs):
        assert key(**kwargs) is None

    def test_scope_requires_user_and_conversation(self):
        assert MCPHelper.build_cache_scope(None, "conv") is None
        assert MCPHelper.build_cache_scope("user", "") is None


class TestCacheLifecycle:
    def test_hit_reuses_instance_and_miss_builds_once(self, cache):
        factory = MagicMock(side_effect=lambda: FakeToolset())
        first = cache.get_or_create("k", factory)
        assert cache.get_or_create("k", factory) is first
        assert factory.call_count == 1

    @pytest.mark.asyncio
    async def test_lru_eviction_closes_oldest(self, cache):
        a = cache.get_or_create("a", FakeToolset)
        b = cache.get_or_create("b", FakeToolset)
        cache.get_or_create("a", FakeToolset)  # a becomes most recent
        cache.get_or_create("c", FakeToolset)  # evicts b
        await drain(cache)
        assert len(cache) == 2
        b.close.assert_awaited_once()
        a.close.assert_not_called()

    @pytest.mark.asyncio
    async def test_idle_entries_expire_and_are_closed(self):
        clock = FakeClock()
        cache = McpToolsetCache(max_entries=4, idle_seconds=60.0, clock=clock, close_grace_seconds=0.0)
        old = cache.get_or_create("a", FakeToolset)
        clock.now += 61
        fresh = cache.get_or_create("a", FakeToolset)
        await drain(cache)
        assert fresh is not old
        old.close.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_invalidate_closes_and_forces_new_instance(self, cache):
        first = cache.get_or_create("k", FakeToolset)
        assert cache.invalidate(first) is True
        await drain(cache)
        first.close.assert_awaited_once()
        assert cache.get_or_create("k", FakeToolset) is not first
        assert cache.invalidate(FakeToolset()) is False

    @pytest.mark.asyncio
    async def test_close_failure_is_reported_not_raised(self, cache):
        toolset = FakeToolset()
        toolset.close.side_effect = RuntimeError("boom")
        with patch.object(mcp_toolset_cache.logger, "warning") as warning:
            await cache._close(toolset)
        assert warning.call_args.args[0] == "dependency.request.failed"
        assert warning.call_args.kwargs["operation"] == "toolset_close"

    @pytest.mark.asyncio
    async def test_close_all_empties_cache(self, cache):
        a = cache.get_or_create("a", FakeToolset)
        await cache.close_all()
        a.close.assert_awaited_once()
        assert len(cache) == 0

    def test_eviction_without_running_loop_does_not_raise(self, cache):
        for name in "abc":
            cache.get_or_create(name, FakeToolset)
        assert len(cache) == 2

    def test_zero_entries_disables(self):
        assert McpToolsetCache(max_entries=0, idle_seconds=1.0).enabled is False


class TestHelperIntegration:
    def test_same_scope_and_headers_share_toolset(self, helper_cache):
        first = MCPHelper.create_mcp_toolset(http_params(user_id="user-1"), "mcp", cache_scope=SCOPE)
        second = MCPHelper.create_mcp_toolset(http_params(user_id="user-1"), "mcp", cache_scope=SCOPE)
        assert first is second
        assert first.mcp_type == "mcp"
        assert first._toolset_cache_managed is True

    def test_other_user_or_conversation_never_shares(self, helper_cache):
        mine = MCPHelper.create_mcp_toolset(http_params(user_id="user-1"), "mcp", cache_scope=SCOPE)
        other_user = MCPHelper.create_mcp_toolset(
            http_params(user_id="user-2"), "mcp", cache_scope=MCPHelper.build_cache_scope("user-2", "conv-1")
        )
        other_conv = MCPHelper.create_mcp_toolset(
            http_params(user_id="user-1"), "mcp", cache_scope=MCPHelper.build_cache_scope("user-1", "conv-2")
        )
        other_token = MCPHelper.create_mcp_toolset(
            http_params(user_id="user-1", Authorization="Bearer x"), "mcp", cache_scope=SCOPE
        )
        assert len({id(mine), id(other_user), id(other_conv), id(other_token)}) == 4

    def test_no_scope_builds_fresh_uncached_toolset(self, helper_cache):
        first = MCPHelper.create_mcp_toolset(http_params(user_id="user-1"), "mcp")
        second = MCPHelper.create_mcp_toolset(http_params(user_id="user-1"), "mcp")
        assert first is not second
        assert first._toolset_cache_managed is False
        assert len(helper_cache) == 0

    def test_disabled_cache_builds_fresh_toolset(self):
        disabled = McpToolsetCache(max_entries=0, idle_seconds=1.0)
        with patch.object(mcp_helper, "get_toolset_cache", return_value=disabled):
            first = MCPHelper.create_mcp_toolset(http_params(user_id="u"), "mcp", cache_scope=SCOPE)
            second = MCPHelper.create_mcp_toolset(http_params(user_id="u"), "mcp", cache_scope=SCOPE)
        assert first is not second

    def test_create_toolsets_forwards_scope(self, helper_cache):
        config = {
            "type": "mcp",
            "transport_type": "streamable_http",
            "url": "https://mcp.example.com/mcp",
            "user_id": "user-1",
            "auth_headers": {},
            "cache_scope": SCOPE,
        }
        first = MCPHelper.create_toolsets([dict(config)])
        second = MCPHelper.create_toolsets([dict(config)])
        assert first[0] is second[0]

    def test_vectorstore_toolset_is_scoped(self, helper_cache):
        settings = SimpleNamespace(
            VECTORSTORE_MCP_URL="https://vectors.example.com/mcp", MCP_TOOL_LIST_CACHE_TTL_SECONDS=60.0
        )
        with patch.object(mcp_helper, "app_settings", settings):
            a = MCPHelper.create_vectorstore_toolsets_with_deep_search(["b1"], cache_scope=SCOPE)
            b = MCPHelper.create_vectorstore_toolsets_with_deep_search(["b1"], cache_scope=SCOPE)
            other_brain = MCPHelper.create_vectorstore_toolsets_with_deep_search(["b2"], cache_scope=SCOPE)
        assert a[0] is b[0]
        assert other_brain[0] is not a[0]


def fake_session(tool_names=("search",)):
    session = MagicMock()
    session.list_tools = AsyncMock(
        return_value=ListToolsResult(
            tools=[Tool(name=name, inputSchema={"type": "object"}) for name in tool_names]
        )
    )
    return session


def wire_session(toolset, session):
    manager = toolset._mcp_session_manager
    manager.create_session = AsyncMock(return_value=session)
    manager._begin_session_use = MagicMock()
    manager._end_session_use = MagicMock()


def break_connection(toolset):
    manager = toolset._mcp_session_manager
    manager.create_session = AsyncMock(side_effect=ConnectionError("down"))
    manager._discard_session = MagicMock()


class TestToolListReuseAndReconnect:
    @pytest.mark.asyncio
    async def test_second_turn_skips_connect_and_listing(self, helper_cache):
        def turn():
            return MCPHelper.create_mcp_toolset(http_params(user_id="user-1"), "mcp", cache_scope=SCOPE)

        first = turn()
        session = fake_session()
        wire_session(first, session)
        assert [t.name for t in await first.get_tools()] == ["search"]

        second = turn()
        assert second is first
        assert [t.name for t in await second.get_tools()] == ["search"]
        assert session.list_tools.await_count == 1
        assert first._mcp_session_manager.create_session.await_count == 1

    @pytest.mark.asyncio
    async def test_uncached_turns_pay_listing_each_time(self, helper_cache):
        session = fake_session()
        for _ in range(2):
            toolset = MCPHelper.create_mcp_toolset(http_params(user_id="user-1"), "mcp")
            wire_session(toolset, session)
            await toolset.get_tools()
        assert session.list_tools.await_count == 2

    @pytest.mark.asyncio
    async def test_failed_connect_evicts_so_next_turn_reconnects(self, helper_cache):
        def turn():
            return MCPHelper.create_mcp_toolset(http_params(user_id="user-1"), "mcp", cache_scope=SCOPE)

        broken = turn()
        break_connection(broken)
        with pytest.raises(ConnectionError):
            await broken.get_tools()
        await drain(helper_cache)

        replacement = turn()
        assert replacement is not broken
        wire_session(replacement, fake_session())
        assert [t.name for t in await replacement.get_tools()] == ["search"]

    @pytest.mark.asyncio
    async def test_tool_list_is_never_shared_between_identities(self, helper_cache):
        mine = MCPHelper.create_mcp_toolset(http_params(user_id="user-1"), "mcp", cache_scope=SCOPE)
        theirs = MCPHelper.create_mcp_toolset(
            http_params(user_id="user-2"), "mcp", cache_scope=MCPHelper.build_cache_scope("user-2", "conv-1")
        )
        wire_session(mine, fake_session(("private_tool",)))
        wire_session(theirs, fake_session(("other_tool",)))
        assert [t.name for t in await mine.get_tools()] == ["private_tool"]
        assert [t.name for t in await theirs.get_tools()] == ["other_tool"]


class TestPrewarm:
    @pytest.mark.asyncio
    async def test_prewarms_only_cache_managed_toolsets(self, helper_cache):
        managed = MCPHelper.create_mcp_toolset(http_params(user_id="u"), "mcp", cache_scope=SCOPE)
        session = fake_session()
        wire_session(managed, session)
        plain = MCPHelper.create_mcp_toolset(http_params(user_id="u"), "mcp")
        plain.get_tools = AsyncMock()

        assert prewarm_mcp_toolsets([managed, plain, object()]) == 1
        await asyncio.gather(*list(mcp_toolset_cache._prewarm_tasks))

        assert session.list_tools.await_count == 1
        plain.get_tools.assert_not_called()
        # The model request that follows is served from the warmed listing.
        await managed.get_tools()
        assert session.list_tools.await_count == 1

    @pytest.mark.asyncio
    async def test_prewarm_failure_is_logged_not_raised(self, helper_cache):
        toolset = MCPHelper.create_mcp_toolset(http_params(user_id="u"), "mcp", cache_scope=SCOPE)
        break_connection(toolset)
        with patch.object(mcp_toolset_cache.logger, "warning") as warning:
            prewarm_mcp_toolsets([toolset])
            await asyncio.gather(*list(mcp_toolset_cache._prewarm_tasks))
        assert any(c.kwargs.get("operation") == "toolset_prewarm" for c in warning.call_args_list)

    def test_no_running_loop_starts_nothing(self, helper_cache):
        toolset = MCPHelper.create_mcp_toolset(http_params(user_id="u"), "mcp", cache_scope=SCOPE)
        assert prewarm_mcp_toolsets([toolset]) == 0


def _closable():
    return SimpleNamespace(close=AsyncMock())


async def _run_in_turn(conversation_id, body):
    """Run ``body`` in its own context, as the servicer's background task does."""
    async def scoped():
        turn = mcp_toolset_cache.begin_toolset_turn(conversation_id)
        return turn, await body()

    return await asyncio.create_task(scoped())


@pytest.mark.asyncio
async def test_cache_scope_prefers_the_turn_conversation_over_the_session_id():
    async def scopes():
        return MCPHelper.build_cache_scope("user-1", "turn_msg-1")

    _, scope = await _run_in_turn("conv-1", scopes)

    assert scope == MCPHelper.build_cache_scope("user-1", "conv-1")
    assert MCPHelper.build_cache_scope("user-1", "turn_msg-1") != scope


@pytest.mark.asyncio
async def test_evicted_toolset_leased_by_a_turn_closes_only_after_release():
    cache = McpToolsetCache(max_entries=1, idle_seconds=3600, close_grace_seconds=0)
    first = _closable()

    async def lease_first():
        return cache.get_or_create("a", lambda: first)

    turn, _ = await _run_in_turn("conv-1", lease_first)
    cache.get_or_create("b", _closable)  # evicts "a" while the turn still holds it
    await asyncio.sleep(0)
    first.close.assert_not_awaited()

    turn.release()
    await asyncio.sleep(0)
    first.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_factory_runs_outside_the_lock_and_a_lost_race_keeps_the_first_toolset():
    cache = McpToolsetCache(max_entries=4, idle_seconds=3600, close_grace_seconds=0)
    winner, loser = _closable(), _closable()

    def slow_factory():
        assert not cache._lock.locked()
        cache.get_or_create("k", lambda: winner)  # another caller stores first
        return loser

    assert cache.get_or_create("k", slow_factory) is winner
    await asyncio.sleep(0)
    loser.close.assert_awaited_once()
    winner.close.assert_not_awaited()


def test_eviction_without_an_event_loop_is_logged():
    cache = McpToolsetCache(max_entries=1, idle_seconds=3600)
    cache.get_or_create("a", _closable)

    with patch.object(mcp_toolset_cache, "logger") as logger:
        cache.get_or_create("b", _closable)

    logger.warning.assert_called_once()
    assert logger.warning.call_args.kwargs["reason"] == "no_running_event_loop"
