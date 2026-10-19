import unittest
from scripts.measure_search_review import summarize_sessions


class SessionMeasurementsTests(unittest.TestCase):
    def test_counts_all_turns_without_double_counting_cached_tokens(self):
        report = summarize_sessions([
            {"session_id": "good", "success": True, "duration_ms": 200,
             "model_calls": [{"input_tokens": 100, "cached_input_tokens": 80, "output_tokens": 20},
                             {"input_tokens": 200, "output_tokens": 30}],
             "retrieval_calls": [{"duration_ms": 10}, {"duration_ms": 20}]},
            {"session_id": "failed", "success": False, "duration_ms": 1,
             "model_calls": [{"input_tokens": 1, "output_tokens": 1}]},
        ])
        self.assertEqual(report["successful_session_tokens"]["p50"], 350)
        self.assertEqual(report["successful_session_latency_ms"]["p50"], 200)
        self.assertEqual(report["retrieval_latency_ms"]["count"], 2)

    def test_missing_usage_does_not_look_like_a_free_session(self):
        report = summarize_sessions([{"session_id": "missing", "success": True,
                                      "model_calls": [{"input_tokens": 10}]}])
        self.assertIsNone(report["successful_session_tokens"])
        self.assertEqual(report["successful_sessions_missing_usage"], 1)

    def test_duplicate_sessions_are_rejected(self):
        with self.assertRaises(ValueError):
            summarize_sessions([{"session_id": "a"}, {"session_id": "a"}])
