import math
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from src.modules.embeddings import prepare_embedding


class EmbeddingReductionTests(unittest.TestCase):
    def test_matches_ingestion_prefix_and_normalization(self):
        settings = SimpleNamespace(EMBEDDING_DIMENSION=3072, EMBEDDING_MATRYOSHKA=True)
        vector = [1.0] * 3072 + [100.0] * 1024
        with patch("src.modules.embeddings.get_settings", return_value=settings):
            result = prepare_embedding(vector)
        self.assertEqual(len(result), 3072)
        self.assertAlmostEqual(result[0], 1 / math.sqrt(3072))
        self.assertAlmostEqual(math.hypot(*result), 1.0)
        self.assertEqual(len(vector), 4096)

    def test_rejects_incompatible_or_invalid_vectors(self):
        for enabled, vector in ((False, [1.0] * 4096), (True, [1.0] * 2048),
                                (True, [0.0] * 4096), (True, [float("nan")] * 4096)):
            settings = SimpleNamespace(EMBEDDING_DIMENSION=3072, EMBEDDING_MATRYOSHKA=enabled)
            with self.subTest(enabled=enabled, size=len(vector)), patch(
                "src.modules.embeddings.get_settings", return_value=settings
            ), self.assertRaises(ValueError):
                prepare_embedding(vector)
