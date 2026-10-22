import asyncio
from contextlib import contextmanager
import threading
import unittest
from unittest.mock import patch

import src.db.session as db_session


class SyncDatabaseAdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_session_lifecycle_stays_on_worker_thread(self):
        event_loop_thread = threading.get_ident()
        lifecycle_threads = []
        session = object()

        @contextmanager
        def session_context():
            lifecycle_threads.append(("open", threading.get_ident()))
            try:
                yield session
            finally:
                lifecycle_threads.append(("close", threading.get_ident()))

        result = await db_session.run_sync_db(
            lambda current_session: (current_session, threading.get_ident()),
            session_context,
        )

        self.assertIs(result[0], session)
        self.assertNotEqual(result[1], event_loop_thread)
        self.assertEqual(
            lifecycle_threads,
            [("open", result[1]), ("close", result[1])],
        )

    async def test_cancelled_waiter_keeps_permit_until_worker_finishes(self):
        first_started = threading.Event()
        finish_first = threading.Event()
        second_started = threading.Event()

        @contextmanager
        def session_context():
            yield object()

        def first_operation(_session):
            first_started.set()
            self.assertTrue(finish_first.wait(2))

        def second_operation(_session):
            second_started.set()
            return "second"

        with patch.object(db_session.settings, "DB_SYNC_WORKER_LIMIT", 1):
            first = asyncio.create_task(
                db_session.run_sync_db(first_operation, session_context)
            )
            self.assertTrue(await asyncio.to_thread(first_started.wait, 1))

            first.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await first

            second = asyncio.create_task(
                db_session.run_sync_db(second_operation, session_context)
            )
            await asyncio.sleep(0.05)
            self.assertFalse(second_started.is_set())

            finish_first.set()
            self.assertEqual(await asyncio.wait_for(second, 1), "second")


if __name__ == "__main__":
    unittest.main()
