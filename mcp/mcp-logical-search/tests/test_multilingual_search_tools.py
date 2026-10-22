import asyncio
from contextlib import nullcontext
import unittest
from unittest.mock import AsyncMock, Mock, patch

import src.mcp_server.logical_indexing_server as server


def _call(tool, **kwargs):
    return asyncio.run(tool.fn.__wrapped__(**kwargs))


class MultilingualSearchToolTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(server.settings, "SEARCH_SCALABLE_SCOPE_ENABLED", False)
        patcher.start()
        self.addCleanup(patcher.stop)

        filename_patch = patch.object(server, "_prepare_filename_semantic_scores", AsyncMock(return_value={}))
        filename_patch.start()
        self.addCleanup(filename_patch.stop)
        scope_patch = patch.object(server, "_require_search_scope", lambda **_: None)
        session_patch = patch.object(
            server,
            "get_db_session_sync",
            lambda: nullcontext(object()),
        )
        scope_patch.start()
        session_patch.start()
        ancestors_patch = patch.object(server, "attach_search_ancestors")
        ancestors_patch.start()
        self.addCleanup(ancestors_patch.stop)
        self.addCleanup(scope_patch.stop)
        self.addCleanup(session_patch.stop)

    def test_all_search_tools_forward_scoped_query_variants(self):
        variants = {
            "english": ["quantity"],
            "french": ["quantité", "quantity"],
        }
        cases = [
            (server.search, "unified_search", {}),
        ]

        for tool, helper_name, extra_args in cases:
            with self.subTest(tool=tool.name), patch.object(
                server,
                "_prepare_hybrid_search",
                AsyncMock(return_value=([0.1, 0.2], variants)),
            ) as prepare, patch.object(server, helper_name, Mock(return_value=[])) as helper:
                _call(
                    tool,
                    query="quantity",
                    workspace_id="workspace",
                    document_id=["doc-en", "doc-fr"],
                    **extra_args,
                )

                prepare.assert_awaited_once()
                self.assertEqual(
                    prepare.await_args.args[1:3],
                    ("workspace", None),
                )
                self.assertEqual(prepare.await_args.kwargs["document_id"], ["doc-en", "doc-fr"])
                self.assertEqual(
                    helper.call_args.kwargs["fts_query_variants"],
                    variants,
                )
                self.assertEqual(
                    helper.call_args.kwargs["document_id"],
                    ["doc-en", "doc-fr"],
                )




if __name__ == "__main__":
    unittest.main()
