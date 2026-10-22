import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastmcp import FastMCP

from scripts import load_test_search


class SearchLoadRunnerTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_protocol_counts_payload_errors_and_completed_requests(self):
        probe = FastMCP("load-runner-test")

        @probe.tool
        def search(query: str, workspace_id: str):
            return {"error": "busy"} if query == "failure" else {"documents": []}

        args = SimpleNamespace(url="http://local.invalid/http/", requests=6, concurrency=2, timeout=3, warmup=1)
        with patch.object(load_test_search, "StreamableHttpTransport", return_value=probe):
            report = await load_test_search.run(args, [
                {"query": "success", "workspace_id": "one"},
                {"query": "failure", "workspace_id": "two"}], "test-secret")
        self.assertEqual(report["completed"], 6)
        self.assertEqual(report["successful"], 3)
        self.assertEqual(report["errors"], {"payload_error": 3})
        self.assertEqual(report["connection_errors"], {})
        self.assertIsNotNone(report["latency_ms_including_failed_calls"]["p95"])
        self.assertNotIn("test-secret", str(report))


if __name__ == "__main__":
    unittest.main()
