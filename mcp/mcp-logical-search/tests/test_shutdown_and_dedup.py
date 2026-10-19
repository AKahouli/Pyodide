import asyncio
import threading
import unittest
from contextlib import nullcontext
from unittest.mock import AsyncMock, Mock, patch

from src.db import session as db_session
from src.modules import operations, model_requests
from src.mcp_server import router
import src.mcp_server.logical_indexing_server as server


class ShutdownTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        operations.start_admission()

    async def asyncTearDown(self):
        await operations.drain()
        if router._shutdown_tasks:
            await asyncio.gather(*router._shutdown_tasks)
        operations.start_admission()

    async def test_shutdown_keeps_clients_open_until_thread_finishes(self):
        started, finish = threading.Event(), threading.Event()
        def work():
            started.set()
            finish.wait(2)
        task = asyncio.create_task(model_requests.run_sync_model_request(work, timeout=2))
        self.assertTrue(await asyncio.to_thread(started.wait, 1))
        try:
            with patch.object(router, "close_embeddings") as close, patch.object(
                router, "dispose_engines", AsyncMock(),
            ) as dispose, patch.object(router, "close_translation_client", AsyncMock()) as close_translation:
                await router.shutdown_resources(0.01)
                close.assert_not_called()
                close_translation.assert_not_awaited()
                dispose.assert_not_awaited()
                readiness = await router.starlette_readiness(Mock())
                self.assertEqual(readiness.status_code, 503)
                with self.assertRaisesRegex(RuntimeError, "shutting down"):
                    await model_requests.run_sync_model_request(lambda: None, timeout=1)
                finish.set()
                await task
                await asyncio.gather(*router._shutdown_tasks)
                close.assert_called_once()
                close_translation.assert_awaited_once()
                dispose.assert_awaited_once()
        finally:
            finish.set()
            await task

    async def test_timed_out_database_worker_does_not_start_next_phase(self):
        started, finish = threading.Event(), threading.Event()
        next_phase = Mock()
        def work(session):
            started.set()
            finish.wait(2)
            db_session.check_db_deadline()
            next_phase()
        try:
            with self.assertRaises(asyncio.TimeoutError):
                await db_session.run_sync_db(work, lambda: nullcontext(object()), timeout=0.02)
            self.assertTrue(started.is_set())
            finish.set()
            await operations.drain()
            next_phase.assert_not_called()
        finally:
            finish.set()


class EvidenceDedupTests(unittest.TestCase):
    def test_context_references_point_to_first_evidence_without_losing_relations(self):
        evidence = {"section_id": 7, "blocks": [{"block_id": 9, "content": "evidence"}]}
        contexts = [{"ancestors": [evidence], "descendants": []},
                    {"ancestors": [], "descendants": [evidence]}]
        server._deduplicate_context_evidence(contexts)
        self.assertEqual(contexts[0]["ancestors"][0], evidence)
        self.assertEqual(contexts[1]["descendants"], [{"section_id": 7, "shared_evidence": {
            "context_index": 0, "relation": "ancestors", "section_index": 0,
        }}])

    def test_duplicate_section_inputs_share_evidence_and_preserve_order(self):
        payload = {"section_id": 7, "blocks": [{"block_id": 9, "content": "evidence"}], "images": []}
        with patch.object(server, "_require_search_scope"), patch.object(
            server, "get_db_session_sync", lambda: nullcontext(object()),
        ), patch.object(server, "read_sections_with_blocks", return_value=[payload, None, payload]):
            result = asyncio.run(server.read_sections.fn.__wrapped__(
                section_id=["7", "missing", "7"], workspace_id="workspace",
            ))
        self.assertEqual(result["sections"][0]["blocks"][0]["block_id"], 9)
        self.assertEqual(result["sections"][1]["error"], "Section not found")
        self.assertEqual(result["sections"][2], {"section_id": 7, "shared_section_index": 0})
