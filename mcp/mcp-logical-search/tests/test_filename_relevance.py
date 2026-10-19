import unittest
from unittest.mock import Mock, patch

from src.mcp_server.filename_relevance import filename_relevance, tokens
from src.mcp_server import db_helpers
from src.config.settings import Settings, get_settings
from pydantic import ValidationError


def documents(*names):
    return {str(index): {"file_name": name} for index, name in enumerate(names)}


class FilenameRelevanceTests(unittest.TestCase):
    def test_issuer_uses_exact_tokens_not_substrings(self):
        scores, issuers = filename_relevance("3M dividend distribution", documents(
            "3M_2022_10K.pdf", "13M_2022_10K.pdf", "3MCOMPANY_2022_10K.pdf", "COSTCO_2022_10K.pdf"))
        self.assertEqual(issuers, {"0"})
        self.assertEqual(scores, {"0": 1.0})

    def test_multiword_company_and_multiple_companies(self):
        _, issuers = filename_relevance("Compare Lockheed Martin and 3M dividends", documents(
            "LOCKHEEDMARTIN_2019_10K.pdf", "3M_2021_10K.pdf", "COSTCO_2021_10K.pdf"))
        self.assertEqual(issuers, {"0", "1"})

    def test_generic_words_only_boost_and_equal_matches_have_equal_scores(self):
        scores, issuers = filename_relevance("annual report", documents(
            "annual_report_2022.pdf", "Annual-report-2023.pdf", "other.pdf"))
        self.assertEqual(issuers, set())
        self.assertEqual(scores, {})
        scores, issuers = filename_relevance("vacation allowance", documents(
            "vacation_allowance.pdf", "vacation-rules.pdf", "other.pdf"))
        self.assertGreater(scores["0"], scores["1"])
        self.assertEqual(issuers, set())

    def test_unknown_company_does_not_narrow_scope(self):
        _, issuers = filename_relevance("UnknownCo dividends", documents("3M_2022_10K.pdf"))
        self.assertEqual(issuers, set())

    def test_unicode_case_and_form_normalization(self):
        self.assertEqual(tokens("３Ｍ_2022_10-K.pdf"), ["3m", "2022", "10k", "pdf"])
        scores, _ = filename_relevance("10-K 2022", documents("3M_2022_10K.pdf", "3M_2021_10Q.pdf"))
        self.assertEqual(scores, {"0": 1.0})

    def test_filename_match_cannot_create_sections_without_content_candidates(self):
        session = Mock()
        session.execute.return_value.all.side_effect = [
            [("a", "u", "3M_2022_10K.pdf", "ws", None, "english")], [], [], [],
        ]
        with patch.object(db_helpers, "_bm25_section_candidates", return_value=({}, {})), patch.object(
                db_helpers, "_bm25_block_candidates", return_value=({}, {})):
            self.assertEqual(db_helpers.unified_search(session, "3M dividends", [.1], workspace_id="ws"), [])

    def test_issuer_scope_applies_before_every_candidate_pool(self):
        session = Mock()
        session.execute.return_value.all.side_effect = [
            [("a", "u", "3M_2022_10K.pdf", "ws", None, "english"),
             ("b", "u", "COSTCO_2022_10K.pdf", "ws", None, "english")], [], [], [],
        ]
        with patch.object(db_helpers, "_bm25_section_candidates", return_value=({}, {})) as section_bm25, patch.object(
                db_helpers, "_bm25_block_candidates", return_value=({}, {})) as block_bm25:
            db_helpers.unified_search(session, "3M dividends", [.1], workspace_id="ws")
        for call in session.execute.call_args_list[1:]:
            self.assertIn(["a"], call.args[0].compile().params.values())
            self.assertNotIn(["a", "b"], call.args[0].compile().params.values())
        for helper in (section_bm25, block_bm25):
            self.assertEqual(set(helper.call_args.args[1]), {"a"})

    def test_original_filename_query_preserves_issuer_during_rewriting(self):
        session = Mock()
        session.execute.return_value.all.side_effect = [
            [("a", "u", "3M_2022_10K.pdf", "ws", None, "english"),
             ("b", "u", "COSTCO_2022_10K.pdf", "ws", None, "english")], [], [], [],
        ]
        with patch.object(db_helpers, "_bm25_section_candidates", return_value=({}, {})) as sections, patch.object(
                db_helpers, "_bm25_block_candidates", return_value=({}, {})):
            db_helpers.unified_search(session, "consecutive dividend increases", [.1], workspace_id="ws",
                filename_query="3M dividends")
        self.assertEqual(set(sections.call_args.args[1]), {"a"})

    def test_block_evidence_outweighs_title_only_and_filename_context(self):
        for enabled in (True, False):
            with self.subTest(filename_semantics_enabled=enabled):
                session = Mock()
                session.execute.return_value.all.side_effect = [
                    [("a", "u", "vacation.pdf", "ws", None, "english"),
                     ("b", "u", "other.pdf", "ws", None, "english")],
                    [("a", "title", .99)], [(10, "b", "content", .9)],
                    [],  # No image-vector candidates.
                    [(10, "b", "content", 1), (11, "a", "title", 1)],
                ]
                with patch.multiple(db_helpers.settings, SEARCH_BLOCK_WEIGHT=.6, SEARCH_SECTION_WEIGHT=.35,
                        SEARCH_FILENAME_WEIGHT=.05, SEARCH_FILENAME_SEMANTIC_ENABLED=enabled), patch.object(db_helpers, "_bm25_section_candidates", return_value=({}, {})), patch.object(
                        db_helpers, "_bm25_block_candidates", return_value=({}, {})), patch.object(
                        db_helpers, "_resolve_section_metadata", return_value={
                            ("a", "title"): (1, "Vacation"), ("b", "content"): (2, "Benefits")}), patch.object(
                        db_helpers, "_get_block_contents_by_internal_ids", return_value={10: "Vacation allowance."}), patch.object(
                        db_helpers, "_get_image_counts_by_section", return_value={}):
                    result = db_helpers.unified_search(session, "vacation allowance", [.1], workspace_id="ws",
                        filename_semantic_scores={"a": .5, "b": 1.})
                self.assertEqual([row["file_name"] for row in result], ["other.pdf", "vacation.pdf"])
                self.assertAlmostEqual(result[0]["score"], round(.6 * result[0]["retrieval_scores"]["block_hybrid"] + (.02 if enabled else 0), 4))
                self.assertEqual(result[1]["retrieval_scores"]["filename_text"], 1.0)
                self.assertEqual(result[1]["retrieval_scores"]["filename_semantic"], .5 if enabled else 0)
                self.assertAlmostEqual(result[1]["score"], round(.35 * result[1]["retrieval_scores"]["section_title_hybrid"] + (.03 + .01 if enabled else .05), 4))

    def test_fusion_configuration_rejects_invalid_weights(self):
        values = get_settings().model_dump()
        for weights in ((.75, .2, .1), (-.1, 1.05, .05), (float("nan"), .2, .05)):
            with self.subTest(weights=weights), self.assertRaises(ValidationError):
                Settings(**{**values, **dict(zip(
                    ("SEARCH_BLOCK_WEIGHT", "SEARCH_SECTION_WEIGHT", "SEARCH_FILENAME_WEIGHT"), weights))})


if __name__ == "__main__":
    unittest.main()
