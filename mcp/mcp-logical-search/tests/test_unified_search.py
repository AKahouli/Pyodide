import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from src.mcp_server import db_helpers


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None


class _Session:
    def __init__(self):
        self.calls = 0
        self.statements = []

    def execute(self, statement):
        self.calls += 1
        self.statements.append(statement)
        if self.calls == 1:
            return _Rows([(1, "user", "document.pdf", "workspace", "source", None)])
        return _Rows([])


class _ExcludedSession(_Session):
    def execute(self, statement):
        self.calls += 1
        self.statements.append(statement)
        if self.calls == 1:
            return _Rows([(1, "user", "document.pdf", "workspace", "source", None)])
        if self.calls == 2:
            return _Rows([(1, "internal-section-12")])
        return _Rows([])


class _SharedBlockCandidatesSession(_Session):
    def execute(self, statement):
        self.calls += 1
        self.statements.append(statement)
        rows_by_call = {
            1: [(1, "user", "document.pdf", "workspace", "source", "english")],
            2: [],
            3: [
                (101, 1, "internal-section-1", 0.9),
                (102, 1, "internal-section-1", 0.8),
            ],
            4: [],  # No visual-vector candidates in this text-only fixture.
            5: [
                (101, 1, "internal-section-1", 3),
                (102, 1, "internal-section-1", 4),
            ],
        }
        return _Rows(rows_by_call.get(self.calls, []))


class _PerDocumentQuotaSession(_Session):
    def execute(self, statement):
        self.calls += 1
        self.statements.append(statement)
        rows_by_call = {
            1: [
                (1, "user", "one.pdf", "workspace", "one.pdf", "english"),
                (2, "user", "two.pdf", "workspace", "two.pdf", "english"),
            ],
            2: [
                (101, 1, "section-1", 0.9),
                (102, 1, "section-2", 0.8),
                (103, 1, "section-3", 0.7),
                (201, 2, "section-4", 0.6),
            ],
            3: [
                (101, 1, "section-1", "text", "first", 1),
                (102, 1, "section-2", "text", "second", 2),
                (103, 1, "section-3", "text", "third", 3),
                (201, 2, "section-4", "text", "other document", 1),
            ],
        }
        return _Rows(rows_by_call.get(self.calls, []))


class UnifiedSearchTests(unittest.TestCase):
    def test_single_document_uses_requested_limit_and_multiple_documents_keep_quota(self):
        for document_count, expected in [(1, 4), (2, 2)]:
            with self.subTest(document_count=document_count):
                session = Mock()
                keys = [(1 if i < 3 or document_count == 1 else 2, "s" + str(i)) for i in range(4)]
                session.execute.side_effect = [_Rows(rows) for rows in [
                    [(d, "u", str(d) + ".pdf", "ws", "source", "english")
                     for d in range(1, document_count + 1)],
                    [],
                    [(i + 10, d, s, .99 - i * .01) for i, (d, s) in enumerate(keys)],
                    [],  # Image vectors.
                    [(i + 10, d, s, 1) for i, (d, s) in enumerate(keys)],
                ]]
                cache = {}
                with patch.object(db_helpers, "_bm25_section_candidates", return_value=({}, {})), patch.object(
                    db_helpers, "_bm25_block_candidates", return_value=({}, {})), patch.object(
                    db_helpers, "_resolve_section_metadata", return_value={key: (i + 100, "Policy") for i, key in enumerate(keys)}), patch.object(
                    db_helpers, "_get_block_contents_by_internal_ids", return_value={i + 10: "source" for i in range(4)}), patch.object(
                    db_helpers, "_get_image_counts_by_section", return_value={}):
                    results = db_helpers.unified_search(session, "policy", [.1], workspace_id="ws",
                        limit=10, per_document_limit=1, block_content_cache=cache)
                self.assertEqual(len(results), expected)
                # The mocked loader supplies no database row versions, so no
                # unverifiable text is admitted to the hydration cache.
                self.assertEqual(cache, {})

    def test_numeric_section_reference_only_matches_public_id(self):
        session = Mock()
        section = SimpleNamespace(id=101, section_id="sec_1")
        session.execute.return_value = _Rows([(section, "doc-a")])

        resolved = db_helpers._resolve_section(session, "101", ["doc-a", "doc-b"])

        statement = session.execute.call_args.args[0]
        where = str(statement.whereclause)
        self.assertIn("logical_sections.id =", where)
        self.assertNotIn("logical_sections.section_id =", where)
        self.assertIn("logical_sections.document_id IN", where)
        self.assertEqual(resolved, (section, "doc-a"))

    def test_legacy_section_reference_rejects_ambiguous_matches(self):
        session = Mock()
        section = SimpleNamespace(section_id="sec_1")
        session.execute.return_value = _Rows([
            (section, "doc-a"), (section, "doc-b"),
        ])

        with self.assertRaisesRegex(ValueError, "Ambiguous section reference"):
            db_helpers._resolve_section(session, "sec_1", ["doc-a", "doc-b"])

    def test_legacy_section_reference_preserves_unique_match(self):
        session = Mock()
        section = SimpleNamespace(section_id="sec_1")
        session.execute.return_value = _Rows([(section, "doc-a")])

        self.assertEqual(
            db_helpers._resolve_section(session, "sec_1", ["doc-a"]),
            (section, "doc-a"),
        )

    def test_unresolved_section_never_runs_candidate_search(self):
        session = Mock()
        session.execute.side_effect = [_Rows(rows) for rows in [
            [("doc-a", "user", "a.pdf", "workspace", "source", "english")],
            [],
        ]]

        self.assertEqual(db_helpers.search_blocks_hybrid(
            session, "query", [0.1], workspace_id="workspace", section_id="999",
        ), [])
        self.assertEqual(session.execute.call_count, 2)
        resolution = session.execute.call_args.args[0].compile()
        self.assertIn(["doc-a"], resolution.params.values())

    def test_section_block_search_scopes_both_channels_to_owning_document(self):
        session = Mock()
        section = SimpleNamespace(id=101, section_id="sec_1")
        session.execute.side_effect = [_Rows(rows) for rows in [
            [
                ("doc-a", "user", "a.pdf", "workspace", "source", "english"),
                ("doc-b", "user", "b.pdf", "workspace", "source", "english"),
            ],
            [(section, "doc-a")],
            [],  # No vector hits in the requested section.
            [],  # No lexical hits in the requested section.
        ]]

        results = db_helpers.search_blocks_hybrid(
            session, "query", [0.1], workspace_id="workspace", section_id="101",
            include_section_context=False,
        )

        self.assertEqual(results, [])
        candidates = session.execute.call_args_list[2:]
        self.assertEqual(len(candidates), 2)
        for call in candidates:
            compiled = call.args[0].compile()
            self.assertIn("logical_blocks.document_id IN", str(compiled))
            self.assertIn(["doc-a"], compiled.params.values())
            self.assertNotIn(["doc-a", "doc-b"], compiled.params.values())
            self.assertIn("logical_blocks.workspace_id IN", str(compiled))
            self.assertIn(["workspace"], compiled.params.values())
            self.assertIn("logical_blocks.section_id =", str(compiled))
            self.assertIn("sec_1", compiled.params.values())

    def test_block_search_applies_document_quota_before_final_limit(self):
        session = _PerDocumentQuotaSession()
        with patch.object(
            db_helpers,
            "_bm25_block_candidates",
            return_value=({}, {}),
        ):
            results = db_helpers.search_blocks_hybrid(
                session,
                "query",
                [0.1],
                workspace_id="workspace",
                limit=3,
                per_document_limit=1,
                include_section_context=False,
                include_document_id=True,
            )

        self.assertEqual([result["block_id"] for result in results], [101, 201])
        self.assertEqual([result["document_id"] for result in results], [1, 2])

    def test_block_search_returns_complete_content_and_section_without_followup_args(self):
        session = _PerDocumentQuotaSession()
        section_ids = {
            (1, "section-1"): 11,
            (1, "section-2"): 12,
            (1, "section-3"): 13,
            (2, "section-4"): 14,
        }
        with (
            patch.object(db_helpers, "_bm25_block_candidates", return_value=({}, {})),
            patch.object(db_helpers, "_get_image_counts_by_section", return_value={}),
            patch.object(db_helpers, "_resolve_section_public_ids", return_value=section_ids),
        ):
            results = db_helpers.search_blocks_hybrid(
                session,
                "query",
                [0.1],
                workspace_id="workspace",
                limit=1,
            )

        self.assertEqual(results[0]["content"], "first")
        self.assertEqual(results[0]["section_id"], 11)
        self.assertIn("image_count", results[0])
        self.assertNotIn("required_followup_args", results[0])

    def test_scoped_configs_apply_workspace_and_file_filters_first(self):
        session = _Session()
        session.calls = 1

        configs = db_helpers.get_scoped_document_fts_configs(
            session,
            "quantity",
            workspace_id="workspace",
            file_name=["english.pdf", "french.pdf"],
        )

        self.assertEqual(configs, [])
        params = session.statements[0].compile().params.values()
        self.assertIn(["workspace"], params)
        self.assertIn(["english.pdf", "french.pdf"], params)

    def test_scoped_configs_apply_document_id_filter(self):
        session = _Session()
        session.calls = 1

        configs = db_helpers.get_scoped_document_fts_configs(
            session,
            "quantity",
            workspace_id="workspace",
            document_id=["507f1f77bcf86cd799439011", "507f191e810c19729de860ea"],
        )

        self.assertEqual(configs, [])
        self.assertIn(
            ["507f1f77bcf86cd799439011", "507f191e810c19729de860ea"],
            session.statements[0].compile().params.values(),
        )

    def test_single_document_id_is_not_split_into_characters(self):
        document_id = "507f1f77bcf86cd799439011"
        statement = db_helpers._apply_document_filters(
            db_helpers.select(db_helpers.LogicalDocument.id),
            document_id=document_id,
        )

        self.assertIn([document_id], statement.compile().params.values())

    def test_explicit_empty_document_scopes_select_nothing(self):
        for scope_name in ("workspace_id", "file_name", "document_id"):
            with self.subTest(scope_name=scope_name):
                statement = db_helpers._apply_document_filters(
                    db_helpers.select(db_helpers.LogicalDocument.id),
                    **{scope_name: []},
                )

                compiled = statement.compile()
                self.assertIn([], compiled.params.values())

    def test_uses_query_language_when_document_config_is_missing(self):
        session = _Session()

        with patch.object(
            db_helpers,
            "get_pg_ts_config",
            return_value="english",
        ) as get_config:
            result = db_helpers.unified_search(
                session,
                "annual revenue",
                [0.1, 0.2],
                workspace_id="workspace",
            )

        self.assertEqual(result, [])
        self.assertIn("fts_config", session.statements[0].selected_columns.keys())
        get_config.assert_called_once_with("annual revenue")

    def test_lexical_only_search_does_not_build_vector_queries(self):
        session = _Session()

        with patch.object(
            db_helpers,
            "_bm25_section_candidates",
            return_value=({}, {}),
        ) as section_bm25, patch.object(
            db_helpers,
            "_bm25_block_candidates",
            return_value=({}, {}),
        ) as block_bm25, patch.object(
            db_helpers,
            "get_pg_ts_config",
            return_value="english",
        ):
            result = db_helpers.unified_search(
                session,
                "annual revenue",
                None,
                workspace_id="workspace",
            )

        self.assertEqual(result, [])
        self.assertEqual(session.calls, 1)
        section_bm25.assert_called_once()
        block_bm25.assert_called_once()

    def test_rejects_search_with_no_enabled_channel(self):
        with self.assertRaisesRegex(ValueError, "at least one retrieval channel"):
            db_helpers.unified_search(
                _Session(),
                "annual revenue",
                None,
                include_lexical=False,
            )

    def test_groups_documents_by_their_indexed_fts_config(self):
        doc_map = {
            1: {"fts_config": "french"},
            2: {"fts_config": "english"},
            3: {"fts_config": "french"},
        }

        with patch.object(db_helpers, "get_pg_ts_config") as get_config:
            groups = db_helpers._document_fts_groups(doc_map, "english query")

        self.assertEqual(dict(groups), {
            "french": [1, 3],
            "english": [2],
        })
        get_config.assert_not_called()

    def test_normalizes_language_code_fts_configs(self):
        groups = db_helpers._document_fts_groups({
            1: {"fts_config": "fr"},
            2: {"fts_config": "EN"},
        }, "query")

        self.assertEqual(dict(groups), {
            "french": [1],
            "english": [2],
        })

    def test_fts_expression_combines_original_and_translated_queries(self):
        expression = db_helpers._fts_query_expression(
            "french",
            "quantity",
            {"french": ["quantité", "quantity"]},
        )

        compiled = expression.compile()
        self.assertIn("||", str(compiled))
        self.assertEqual(set(compiled.params.values()), {
            "french",
            "quantité",
            "quantity",
        })


    def test_rrf_keeps_bm25_only_results(self):
        self.assertGreater(db_helpers._rrf_score(None, 1), 0.0)

    def test_rrf_rewards_results_found_by_both_algorithms(self):
        combined = db_helpers._rrf_score(1, 1)

        self.assertGreater(combined, db_helpers._rrf_score(1, None))
        self.assertGreater(combined, db_helpers._rrf_score(None, 1))

    def test_excluded_sections_are_filtered_from_all_candidate_pools(self):
        session = _ExcludedSession()

        with patch.object(db_helpers, "get_pg_ts_config", return_value="english"):
            result = db_helpers.unified_search(
                session,
                "annual revenue",
                [0.1, 0.2],
                workspace_id="workspace",
                exclude_section_ids=[12],
            )

        self.assertEqual(result, [])
        # 0 scopes documents and 1 resolves public section ids. The remaining
        # statements cover section vector/BM25 and the shared block vector/BM25
        # pools (content and block fusion reuse the same vector candidates).
        candidate_statements = session.statements[2:7]
        self.assertEqual(len(candidate_statements), 5)
        for statement in candidate_statements:
            self.assertIn("NOT IN", str(statement.compile()))

        sql = " ".join(str(statement.compile()) for statement in candidate_statements)
        self.assertNotIn("logical_sections.title,", sql)
        self.assertNotIn("logical_blocks.content,", sql)

    def test_shared_block_vector_candidates_preserve_both_retrieval_signals(self):
        session = _SharedBlockCandidatesSession()

        with (
            patch.object(db_helpers, "_bm25_section_candidates", return_value=({}, {})),
            patch.object(db_helpers, "_bm25_block_candidates", return_value=({}, {})),
            patch.object(
                db_helpers,
                "_resolve_section_metadata",
                return_value={(1, "internal-section-1"): (12, "Revenue")},
            ),
            patch.object(
                db_helpers,
                "_get_block_contents_by_internal_ids",
                return_value={101: "Revenue increased.", 102: "Growth continued."},
            ),
            patch.object(db_helpers, "_get_image_counts_by_section", return_value={}),
        ):
            result = db_helpers.unified_search(
                session,
                "annual revenue",
                [0.1, 0.2],
                workspace_id="workspace",
            )

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["retrieval_scores"]["content_vector"], 0.9)
        self.assertEqual(
            result[0]["retrieval_scores"]["block_hybrid"],
            round(db_helpers._rrf_score(1, None), 4),
        )
        self.assertEqual(result[0]["preview_section"], "Revenue increased. Growth continued.")
        self.assertNotIn("required_followup_args", result[0])
        self.assertEqual(result[0]["matched_block"]["block_id"], 101)
        self.assertEqual(result[0]["matched_block"]["content"], "Revenue increased.")
        self.assertNotIn("next_action", result[0])

        # Documents, section vectors, shared block vectors, image vectors, and winners.
        self.assertEqual(session.calls, 5)
        block_vector_sql = str(session.statements[2].compile())
        self.assertIn("logical_blocks.section_id IS NOT NULL", block_vector_sql)
        self.assertIn("LIMIT", block_vector_sql)
        for statement in session.statements[1:]:
            sql = str(statement.compile())
            if "FROM logical_images" in sql:
                # Images inherit workspace scope through the already scoped document IDs.
                self.assertIn("logical_images.document_id IN", sql)
                self.assertIn([1], statement.compile().params.values())
            else:
                self.assertIn("workspace_id IN", sql)

    def test_section_search_uses_structured_followup_without_next_action(self):
        session = _SharedBlockCandidatesSession()
        with (
            patch.object(db_helpers, "_bm25_section_candidates", return_value=({}, {})),
            patch.object(db_helpers, "_bm25_block_candidates", return_value=({}, {})),
            patch.object(
                db_helpers,
                "_resolve_section_metadata",
                return_value={(1, "internal-section-1"): (12, "Revenue")},
            ),
            patch.object(
                db_helpers,
                "_get_block_contents_by_internal_ids",
                return_value={101: "Revenue increased.", 102: "Growth continued."},
            ),
            patch.object(db_helpers, "_get_page_ranges_for_section_keys", return_value={}),
            patch.object(db_helpers, "_get_image_counts_by_section", return_value={}),
        ):
            result = db_helpers.search_sections_hybrid(
                session,
                "annual revenue",
                [0.1, 0.2],
                workspace_id="workspace",
            )

        self.assertNotIn("required_followup_args", result[0])
        self.assertNotIn("next_action", result[0])

    def test_preview_uses_ranked_hit_content(self):
        preview = db_helpers._get_section_preview([
            "Most relevant matching block.",
            None,
            "Second matching block.",
        ])

        self.assertEqual(
            preview,
            "Most relevant matching block. Second matching block.",
        )


if __name__ == "__main__":
    unittest.main()
