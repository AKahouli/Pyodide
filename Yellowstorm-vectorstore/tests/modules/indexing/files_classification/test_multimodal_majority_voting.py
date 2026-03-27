"""
Tests unitaires pour le module multimodal_majority_voting.py
"""
import pytest
import datetime
from unittest.mock import Mock, patch, MagicMock
from typing import List, Dict, Any
from collections import Counter, defaultdict
class TestVotingWeights:
    """Tests pour la classe VotingWeights"""
    def test_voting_weights_constants(self):
        """Test les constantes de poids de vote"""
        from src.modules.indexing.files_classification.multimodal_majority_voting import VotingWeights

        assert VotingWeights.SIMPLE_VOTE_WEIGHT == 0.3
        assert VotingWeights.CONFIDENCE_WEIGHT == 0.5
        assert VotingWeights.AVERAGE_CONFIDENCE_WEIGHT == 0.2

    def test_voting_weights_sum(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import VotingWeights

        """Test que la somme des poids fait 1.0"""
        total = (VotingWeights.SIMPLE_VOTE_WEIGHT +
                VotingWeights.CONFIDENCE_WEIGHT +
                VotingWeights.AVERAGE_CONFIDENCE_WEIGHT)
        assert abs(total - 1.0) < 1e-6


class TestDefaultConfig:
    """Tests pour la classe DefaultConfig"""

    def test_default_config_constants(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DefaultConfig

        """Test les constantes de configuration par défaut"""
        assert DefaultConfig.IMG_WEIGHT == 0.4
        assert DefaultConfig.TEXT_WEIGHT == 0.6
        assert DefaultConfig.CONFIDENCE_THRESHOLD == 0.2

    def test_default_weights_sum(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DefaultConfig
        """Test que la somme des poids d'images et texte fait 1.0"""
        total = DefaultConfig.IMG_WEIGHT + DefaultConfig.TEXT_WEIGHT
        assert abs(total - 1.0) < 1e-6


class TestChunkVote:
    """Tests pour la dataclass ChunkVote"""

    def test_chunk_vote_creation(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import ChunkVote
        """Test la création d'un vote de chunk"""
        vote = ChunkVote(
            chunk_id="chunk_1",
            chunk_type="img",
            predicted_category="documents/legal",
            confidence=0.8,
            hierarchy_path=["documents", "legal"]
        )

        assert vote.chunk_id == "chunk_1"
        assert vote.chunk_type == "img"
        assert vote.predicted_category == "documents/legal"
        assert vote.confidence == 0.8
        assert vote.hierarchy_path == ["documents", "legal"]

    def test_chunk_vote_optional_hierarchy(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import ChunkVote
        """Test la création d'un vote sans chemin hiérarchique"""
        vote = ChunkVote(
            chunk_id="chunk_1",
            chunk_type="text",
            predicted_category="documents/hr",
            confidence=0.7
        )

        assert vote.chunk_id == "chunk_1"
        assert vote.hierarchy_path is None

    def test_chunk_vote_types(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import ChunkVote
        """Test les différents types de chunks"""
        img_vote = ChunkVote(
            chunk_id="chunk_img",
            chunk_type="img",
            predicted_category="images",
            confidence=0.9
        )

        text_vote = ChunkVote(
            chunk_id="chunk_text",
            chunk_type="text",
            predicted_category="documents",
            confidence=0.8
        )

        assert img_vote.chunk_type == "img"
        assert text_vote.chunk_type == "text"


class TestDocumentClassificationResult:
    """Tests pour la dataclass DocumentClassificationResult"""

    def test_document_classification_result_creation(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import ChunkVote , DocumentClassificationResult
        """Test la création d'un résultat de classification de document"""
        vote = ChunkVote(
            chunk_id="chunk_1",
            chunk_type="text",
            predicted_category="documents/legal",
            confidence=0.8
        )

        result = DocumentClassificationResult(
            document_id="doc_1",
            predicted_category="documents/legal",
            final_confidence=0.85,
            total_chunks=5,
            img_chunks_count=2,
            text_chunks_count=3,
            vote_distribution={"documents/legal": 3, "documents/hr": 2},
            confidence_by_category={"documents/legal": 0.8, "documents/hr": 0.6},
            chunk_votes=[vote],
            voting_analysis={"test": "data"},
            processing_metadata={"timestamp": "2024-01-01T00:00:00"}
        )

        assert result.document_id == "doc_1"
        assert result.predicted_category == "documents/legal"
        assert result.final_confidence == 0.85
        assert result.total_chunks == 5
        assert result.img_chunks_count == 2
        assert result.text_chunks_count == 3

    def test_document_result_attributes(self):
        """Test tous les attributs du résultat"""
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentClassificationResult
        result = DocumentClassificationResult(
            document_id="test_doc",
            predicted_category="test_category",
            final_confidence=0.7,
            total_chunks=1,
            img_chunks_count=0,
            text_chunks_count=1,
            vote_distribution={"test_category": 1},
            confidence_by_category={"test_category": 0.7},
            chunk_votes=[],
            voting_analysis={},
            processing_metadata={}
        )

        required_attrs = [
            'document_id', 'predicted_category', 'final_confidence',
            'total_chunks', 'img_chunks_count', 'text_chunks_count',
            'vote_distribution', 'confidence_by_category', 'chunk_votes',
            'voting_analysis', 'processing_metadata'
        ]

        for attr in required_attrs:
            assert hasattr(result, attr)


class TestDocumentMajorityVoter:
    """Tests pour la classe DocumentMajorityVoter"""

    def test_voter_initialization_default(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter , DefaultConfig
        """Test l'initialisation avec les paramètres par défaut"""
        voter = DocumentMajorityVoter("doc_1")

        assert voter.document_id == "doc_1"
        assert voter.img_weight == DefaultConfig.IMG_WEIGHT
        assert voter.text_weight == DefaultConfig.TEXT_WEIGHT
        assert voter.confidence_threshold == DefaultConfig.CONFIDENCE_THRESHOLD
        assert len(voter.chunk_votes) == 0
        assert len(voter.img_votes) == 0
        assert len(voter.text_votes) == 0

    def test_voter_initialization_custom(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter
        """Test l'initialisation avec des paramètres personnalisés"""
        voter = DocumentMajorityVoter(
            document_id="doc_1",
            img_weight=0.3,
            text_weight=0.7,
            confidence_threshold=0.4
        )

        assert voter.img_weight == 0.3
        assert voter.text_weight == 0.7
        assert voter.confidence_threshold == 0.4

    def test_voter_initialization_invalid_weights(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter
        """Test l'initialisation avec des poids invalides"""
        # Poids négatifs
        with pytest.raises(ValueError, match="Les poids doivent être entre 0 et 1"):
            DocumentMajorityVoter("doc_1", img_weight=-0.1, text_weight=1.1)

        # Poids > 1
        with pytest.raises(ValueError, match="Les poids doivent être entre 0 et 1"):
            DocumentMajorityVoter("doc_1", img_weight=1.5, text_weight=0.5)

        # Seuil de confiance invalide
        with pytest.raises(ValueError, match="Le seuil de confiance doit être entre 0 et 1"):
            DocumentMajorityVoter("doc_1", confidence_threshold=-0.1)

    def test_voter_initialization_weight_sum_warning(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter
        """Test l'avertissement quand la somme des poids n'est pas 1.0"""
        with patch('src.modules.indexing.files_classification.multimodal_majority_voting.logger') as mock_logger:
            voter = DocumentMajorityVoter(
                document_id="doc_1",
                img_weight=0.3,
                text_weight=0.5  # Somme = 0.8, pas 1.0
            )
            mock_logger.warning.assert_called_once()
            assert "Les poids totalisent 0.8" in mock_logger.warning.call_args[0][0]

    def test_create_chunk_vote_with_object(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter
        """Test la création d'un vote à partir d'un objet"""
        voter = DocumentMajorityVoter("doc_1")

        # Mock d'un objet de classification
        classification = Mock()
        classification.chunk_id = "chunk_1"
        classification.predicted_category = "documents/legal"
        classification.final_confidence = 0.8
        classification.hierarchy_path = ["documents", "legal"]

        vote = voter._create_chunk_vote(classification, "text")

        assert vote is not None
        assert vote.chunk_id == "chunk_1"
        assert vote.chunk_type == "text"
        assert vote.predicted_category == "documents/legal"
        assert vote.confidence == 0.8
        assert vote.hierarchy_path == ["documents", "legal"]

    def test_create_chunk_vote_invalid_object(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter
        """Test la création d'un vote avec un objet invalide"""
        voter = DocumentMajorityVoter("doc_1")

        # Objet sans chunk_id
        invalid_classification = Mock()
        delattr(invalid_classification, 'chunk_id')

        vote = voter._create_chunk_vote(invalid_classification, "text")
        assert vote is None

    def test_create_chunk_vote_from_dict(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter
        """Test la création d'un vote à partir d'un dictionnaire"""
        voter = DocumentMajorityVoter("doc_1")

        classification_dict = {
            "predicted_category": "documents/legal",
            "final_confidence": 0.8,
            "hierarchy_path": ["documents", "legal"]
        }

        vote = voter._create_chunk_vote_from_dict(classification_dict, "chunk_1", "img")

        assert vote is not None
        assert vote.chunk_id == "chunk_1"
        assert vote.chunk_type == "img"
        assert vote.predicted_category == "documents/legal"
        assert vote.confidence == 0.8
        assert vote.hierarchy_path == ["documents", "legal"]

    def test_process_classifications_list(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter
        """Test le traitement des classifications sous forme de liste"""
        voter = DocumentMajorityVoter("doc_1", confidence_threshold=0.5)

        # Mock des classifications
        classifications = []
        for i in range(3):
            classification = Mock()
            classification.chunk_id = f"chunk_{i}"
            classification.predicted_category = "documents/legal"
            classification.final_confidence = 0.6 + i * 0.1
            classification.hierarchy_path = ["documents", "legal"]
            classifications.append(classification)

        result = {
            "classifications": classifications
        }

        voter._process_classifications(result, "text")

        assert len(voter.text_votes) == 3
        assert len(voter.chunk_votes) == 3
        assert len(voter.img_votes) == 0

    def test_process_classifications_dict(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter
        """Test le traitement des classifications sous forme de dictionnaire"""
        voter = DocumentMajorityVoter("doc_1", confidence_threshold=0.5)

        # Test avec un format de dictionnaire qui contient chunk_votes (DocumentClassificationResult)
        classifications_dict = {
            "chunk_votes": [
                {
                    "chunk_id": "chunk_1",
                    "predicted_category": "documents/legal",
                    "final_confidence": 0.8,
                    "hierarchy_path": ["documents", "legal"]
                },
                {
                    "chunk_id": "chunk_2",
                    "predicted_category": "documents/hr",
                    "final_confidence": 0.7,
                    "hierarchy_path": ["documents", "hr"]
                }
            ]
        }

        result = {
            "classifications": classifications_dict
        }

        voter._process_classifications(result, "img")

        assert len(voter.img_votes) == 2
        assert len(voter.chunk_votes) == 2
        assert len(voter.text_votes) == 0

    def test_process_classifications_confidence_filtering(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter
        """Test le filtrage par seuil de confiance"""
        voter = DocumentMajorityVoter("doc_1", confidence_threshold=0.7)

        classifications = []
        confidences = [0.5, 0.7, 0.8]  # Seuls les 2 derniers passent le seuil
        for i, conf in enumerate(confidences):
            classification = Mock()
            classification.chunk_id = f"chunk_{i}"
            classification.predicted_category = "documents/legal"
            classification.final_confidence = conf
            classification.hierarchy_path = ["documents", "legal"]
            classifications.append(classification)

        result = {"classifications": classifications}
        voter._process_classifications(result, "text")

        assert len(voter.chunk_votes) == 2  # Seuls ceux avec confiance >= 0.7

    def test_add_classification_results(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter
        """Test l'ajout des résultats de classification"""
        voter = DocumentMajorityVoter("doc_1")

        # Préparer les résultats mock
        img_classification = Mock()
        img_classification.chunk_id = "img_chunk_1"
        img_classification.predicted_category = "images/photos"
        img_classification.final_confidence = 0.8
        img_classification.hierarchy_path = ["images", "photos"]

        text_classification = Mock()
        text_classification.chunk_id = "text_chunk_1"
        text_classification.predicted_category = "documents/legal"
        text_classification.final_confidence = 0.7
        text_classification.hierarchy_path = ["documents", "legal"]

        img_result = {"classifications": [img_classification]}
        text_result = {"classifications": [text_classification]}

        voter.add_classification_results(img_result, text_result)

        assert len(voter.img_votes) == 1
        assert len(voter.text_votes) == 1
        assert len(voter.chunk_votes) == 2

    def test_calculate_vote_metrics(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter , ChunkVote
        """Test le calcul des métriques de vote"""
        voter = DocumentMajorityVoter("doc_1", img_weight=0.4, text_weight=0.6)

        # Ajouter des votes
        votes = [
            ChunkVote("chunk_1", "img", "documents/legal", 0.8),
            ChunkVote("chunk_2", "text", "documents/legal", 0.7),
            ChunkVote("chunk_3", "img", "documents/hr", 0.6),
        ]
        voter.chunk_votes = votes

        metrics = voter._calculate_vote_metrics()

        assert "documents/legal" in metrics
        assert "documents/hr" in metrics

        legal_metrics = metrics["documents/legal"]
        assert legal_metrics["simple_votes"] == 2
        assert legal_metrics["img_votes"] == 1
        assert legal_metrics["text_votes"] == 1
        assert legal_metrics["vote_count"] == 2
        assert legal_metrics["total_confidence"] == 1.5  # 0.8 + 0.7

    def test_determine_winner(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter
        """Test la détermination du gagnant"""
        voter = DocumentMajorityVoter("doc_1")

        # Créer des métriques de test
        vote_metrics = {
            "documents/legal": {
                "simple_votes": 2,
                "weighted_confidence": 0.75,
                "total_confidence": 1.5,
                "vote_count": 2
            },
            "documents/hr": {
                "simple_votes": 1,
                "weighted_confidence": 0.3,
                "total_confidence": 0.6,
                "vote_count": 1
            }
        }

        voter.chunk_votes = [Mock()] * 3  # 3 votes total

        winner, confidence = voter._determine_winner(vote_metrics)

        assert winner == "documents/legal"
        assert confidence > 0

    def test_determine_winner_empty_metrics(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter
        """Test la détermination du gagnant avec des métriques vides"""
        voter = DocumentMajorityVoter("doc_1")

        winner, confidence = voter._determine_winner({})

        assert winner == "unknown"
        assert confidence == 0.0

    def test_vote_distribution_property(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter , ChunkVote
        """Test la propriété vote_distribution avec cache"""
        voter = DocumentMajorityVoter("doc_1")

        votes = [
            ChunkVote("chunk_1", "text", "documents/legal", 0.8),
            ChunkVote("chunk_2", "text", "documents/legal", 0.7),
            ChunkVote("chunk_3", "img", "documents/hr", 0.6),
        ]
        voter.chunk_votes = votes

        distribution = voter.vote_distribution

        assert distribution["documents/legal"] == 2
        assert distribution["documents/hr"] == 1

        # Test du cache
        assert voter._vote_distribution_cache == distribution

    def test_confidence_by_category_property(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter , ChunkVote
        """Test la propriété confidence_by_category avec cache"""
        voter = DocumentMajorityVoter("doc_1")

        votes = [
            ChunkVote("chunk_1", "text", "documents/legal", 0.8),
            ChunkVote("chunk_2", "text", "documents/legal", 0.6),
            ChunkVote("chunk_3", "img", "documents/hr", 0.7),
        ]
        voter.chunk_votes = votes

        confidence_by_cat = voter.confidence_by_category

        assert confidence_by_cat["documents/legal"] == 0.7  # (0.8 + 0.6) / 2
        assert confidence_by_cat["documents/hr"] == 0.7

        # Test du cache
        assert voter._confidence_by_category_cache == confidence_by_cat

    def test_invalidate_caches(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter 
        """Test l'invalidation des caches"""
        voter = DocumentMajorityVoter("doc_1")

        # Remplir les caches
        voter._vote_distribution_cache = {"test": 1}
        voter._confidence_by_category_cache = {"test": 0.5}

        voter._invalidate_caches()

        assert voter._vote_distribution_cache is None
        assert voter._confidence_by_category_cache is None

    def test_compute_majority_vote_empty(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter 
        """Test le majority voting avec aucun vote"""
        voter = DocumentMajorityVoter("doc_1")

        result = voter.compute_majority_vote()

        assert result.document_id == "doc_1"
        assert result.predicted_category == "unknown"
        assert result.final_confidence == 0.0
        assert result.total_chunks == 0

    def test_compute_majority_vote_success(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter , ChunkVote
        """Test le majority voting avec des votes valides"""
        voter = DocumentMajorityVoter("doc_1")

        votes = [
            ChunkVote("chunk_1", "text", "documents/legal", 0.8),
            ChunkVote("chunk_2", "text", "documents/legal", 0.7),
            ChunkVote("chunk_3", "img", "documents/hr", 0.6),
        ]
        voter.chunk_votes = votes
        voter.img_votes = [votes[2]]
        voter.text_votes = votes[:2]

        result = voter.compute_majority_vote()

        assert result.document_id == "doc_1"
        assert result.predicted_category in ["documents/legal", "documents/hr"]
        assert result.final_confidence > 0
        assert result.total_chunks == 3
        assert result.img_chunks_count == 1
        assert result.text_chunks_count == 2
        assert len(result.chunk_votes) == 3

    def test_create_voting_analysis(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter , ChunkVote
        """Test la création de l'analyse de vote"""
        voter = DocumentMajorityVoter("doc_1", img_weight=0.3, text_weight=0.7, confidence_threshold=0.5)

        votes = [
            ChunkVote("chunk_1", "text", "documents/legal", 0.8),
            ChunkVote("chunk_2", "img", "documents/hr", 0.6),
            ChunkVote("chunk_3", "text", "documents/legal", 0.4),  # En dessous du seuil
        ]
        voter.chunk_votes = votes
        voter.img_votes = [votes[1]]
        voter.text_votes = [votes[0], votes[2]]

        vote_metrics = {"test": {"metric": "value"}}
        analysis = voter._create_voting_analysis(vote_metrics)

        assert "vote_metrics" in analysis
        assert "weights_used" in analysis
        assert "threshold_used" in analysis
        assert "vote_breakdown" in analysis

        weights = analysis["weights_used"]
        assert weights["img_weight"] == 0.3
        assert weights["text_weight"] == 0.7

        assert analysis["threshold_used"] == 0.5

        breakdown = analysis["vote_breakdown"]
        assert breakdown["total_votes"] == 3
        assert breakdown["img_votes"] == 1
        assert breakdown["text_votes"] == 2
        assert breakdown["votes_above_threshold"] == 2

    def test_create_processing_metadata(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter , ChunkVote
        """Test la création des métadonnées de traitement"""
        voter = DocumentMajorityVoter("doc_1", img_weight=0.4, text_weight=0.6, confidence_threshold=0.3)

        votes = [ChunkVote("chunk_1", "text", "documents/legal", 0.8)]
        voter.chunk_votes = votes
        voter.text_votes = votes

        metadata = voter._create_processing_metadata()

        assert "document_id" in metadata
        assert "processing_timestamp" in metadata
        assert "voter_config" in metadata
        assert "chunks_processed" in metadata

        assert metadata["document_id"] == "doc_1"

        config = metadata["voter_config"]
        assert config["img_weight"] == 0.4
        assert config["text_weight"] == 0.6
        assert config["confidence_threshold"] == 0.3

        chunks_info = metadata["chunks_processed"]
        assert chunks_info["total"] == 1
        assert chunks_info["by_type"]["img"] == 0
        assert chunks_info["by_type"]["text"] == 1

    def test_get_result_as_dict_no_result(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter 
        """Test get_result_as_dict sans calcul préalable"""
        voter = DocumentMajorityVoter("doc_1")

        with pytest.raises(ValueError, match="Aucun résultat calculé"):
            voter.get_result_as_dict()

    def test_get_result_as_dict_success(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter , ChunkVote
        """Test get_result_as_dict avec un résultat calculé"""
        voter = DocumentMajorityVoter("doc_1")

        # Ajouter quelques votes et calculer le résultat
        votes = [ChunkVote("chunk_1", "text", "documents/legal", 0.8)]
        voter.chunk_votes = votes
        voter.text_votes = votes

        result = voter.compute_majority_vote()
        dict_result = voter.get_result_as_dict()

        assert isinstance(dict_result, dict)
        assert dict_result["document_id"] == "doc_1"


class TestGlobalMajorityVoteWithWeights:
    """Tests pour la fonction globale global_majority_vote_with_weights"""

    def test_global_majority_vote_same_document_ids(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter , global_majority_vote_with_weights
        """Test avec des IDs de document identiques"""
        img_classification = Mock()
        img_classification.chunk_id = "img_1"
        img_classification.predicted_category = "images/photos"
        img_classification.final_confidence = 0.8
        img_classification.hierarchy_path = ["images", "photos"]
        img_classification.document_id = "doc_123"

        text_classification = Mock()
        text_classification.chunk_id = "text_1"
        text_classification.predicted_category = "documents/legal"
        text_classification.final_confidence = 0.7
        text_classification.hierarchy_path = ["documents", "legal"]
        text_classification.document_id = "doc_123"

        # Créer des résultats avec le format attendu (chunk_votes dans classifications)
        img_result = {
            "classifications": {
                "chunk_votes": [
                    {
                        "chunk_id": "img_1",
                        "predicted_category": "images/photos",
                        "final_confidence": 0.8,
                        "hierarchy_path": ["images", "photos"]
                    }
                ],
                "document_id": "doc_123"
            },
            "n_tokens": 1000
        }

        text_result = {
            "classifications": {
                "chunk_votes": [
                    {
                        "chunk_id": "text_1",
                        "predicted_category": "documents/legal",
                        "final_confidence": 0.7,
                        "hierarchy_path": ["documents", "legal"]
                    }
                ],
                "document_id": "doc_123"
            },
            "n_tokens": 2000
        }

        final_result, processing_summary = global_majority_vote_with_weights(
            img_result, text_result
        )

        assert isinstance(final_result, dict)
        assert isinstance(processing_summary, dict)
        assert processing_summary["document_processed"] == "doc_123"
        assert processing_summary["total_tokens_img"] == 1000
        assert processing_summary["total_tokens_text"] == 2000

    def test_global_majority_vote_different_document_ids(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter , global_majority_vote_with_weights
        """Test avec des IDs de document différents"""
        img_classification = Mock()
        img_classification.chunk_id = "img_1"
        img_classification.predicted_category = "images/photos"
        img_classification.final_confidence = 0.9
        img_classification.hierarchy_path = ["images", "photos"]
        img_classification.document_id = "doc_img"

        text_classification = Mock()
        text_classification.chunk_id = "text_1"
        text_classification.predicted_category = "documents/legal"
        text_classification.final_confidence = 0.6
        text_classification.hierarchy_path = ["documents", "legal"]
        text_classification.document_id = "doc_text"

        img_result = {
            "classifications": {
                "chunk_votes": [
                    {
                        "chunk_id": "img_1",
                        "predicted_category": "images/photos",
                        "final_confidence": 0.9,
                        "hierarchy_path": ["images", "photos"]
                    }
                ],
                "document_id": "doc_img"
            },
            "n_tokens": 500
        }

        text_result = {
            "classifications": {
                "chunk_votes": [
                    {
                        "chunk_id": "text_1",
                        "predicted_category": "documents/legal",
                        "final_confidence": 0.6,
                        "hierarchy_path": ["documents", "legal"]
                    }
                ],
                "document_id": "doc_text"
            },
            "n_tokens": 1500
        }

        final_result, processing_summary = global_majority_vote_with_weights(
            img_result, text_result
        )

        # Le code utilise le premier document_id trouvé (img) quand ils sont différents
        assert processing_summary["document_processed"] == "doc_img"

    def test_global_majority_vote_no_document_ids(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import  global_majority_vote_with_weights
        """Test sans IDs de document"""
        img_classification = Mock()
        img_classification.chunk_id = "img_1"
        img_classification.predicted_category = "images/photos"
        img_classification.final_confidence = 0.85
        img_classification.hierarchy_path = ["images", "photos"]

        text_classification = Mock()
        text_classification.chunk_id = "text_1"
        text_classification.predicted_category = "documents/legal"
        text_classification.final_confidence = 0.75
        text_classification.hierarchy_path = ["documents", "legal"]

        img_result = {
            "classifications": {
                "chunk_votes": [
                    {
                        "chunk_id": "img_1",
                        "predicted_category": "images/photos",
                        "final_confidence": 0.85,
                        "hierarchy_path": ["images", "photos"]
                    }
                ]
            },
            "n_tokens": 0
        }

        text_result = {
            "classifications": {
                "chunk_votes": [
                    {
                        "chunk_id": "text_1",
                        "predicted_category": "documents/legal",
                        "final_confidence": 0.75,
                        "hierarchy_path": ["documents", "legal"]
                    }
                ]
            },
            "n_tokens": 0
        }

        final_result, processing_summary = global_majority_vote_with_weights(
            img_result, text_result
        )

        assert processing_summary["document_processed"] == "unknown"
        assert processing_summary["status"] == "completed"

    def test_global_majority_vote_with_real_classifications(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import  global_majority_vote_with_weights
        """Test avec des classifications réelles"""
        img_classification = type(
            "Classification",
            (),
            {
                "chunk_id": "img_1",
                "predicted_category": "images/photos",
                "final_confidence": 0.85,
                "hierarchy_path": ["images", "photos"],
                "document_id": "doc_real",
            },
        )()

        text_classification = type(
            "Classification",
            (),
            {
                "chunk_id": "text_1",
                "predicted_category": "documents/legal",
                "final_confidence": 0.75,
                "hierarchy_path": ["documents", "legal"],
                "document_id": "doc_real",
            },
        )()

        img_result = {
            "classifications": {
                "chunk_votes": [
                    {
                        "chunk_id": "img_1",
                        "predicted_category": "images/photos",
                        "final_confidence": 0.85,
                        "hierarchy_path": ["images", "photos"]
                    }
                ],
                "document_id": "doc_real"
            },
            "n_tokens": 800
        }

        text_result = {
            "classifications": {
                "chunk_votes": [
                    {
                        "chunk_id": "text_1",
                        "predicted_category": "documents/legal",
                        "final_confidence": 0.75,
                        "hierarchy_path": ["documents", "legal"]
                    }
                ],
                "document_id": "doc_real"
            },
            "n_tokens": 1200
        }

        final_result, processing_summary = global_majority_vote_with_weights(
            img_result, text_result
        )

        assert processing_summary["img_chunks"] == 1
        assert processing_summary["text_chunks"] == 1
        assert processing_summary["total_chunks_processed"] == 2
        assert "vote_distribution" in processing_summary
        assert processing_summary["status"] == "completed"


    def test_global_majority_vote_error_handling(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter , global_majority_vote_with_weights
        """Test la gestion d'erreurs dans la fonction globale"""
        # Test avec des données invalides (résultats None ou vides)
        img_result = None
        text_result = None

        # La fonction catche l'exception et retourne None au lieu de la relancer
        result = global_majority_vote_with_weights(img_result, text_result)
        assert result is None


class TestDocumentMajorityVoterEdgeCases:
    """Tests pour les cas limites du DocumentMajorityVoter"""

    def test_voter_with_mixed_confidence_levels(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter , ChunkVote
        """Test avec des niveaux de confiance mélangés"""
        voter = DocumentMajorityVoter("doc_1", confidence_threshold=0.5)

        votes = [
            ChunkVote("chunk_1", "text", "documents/legal", 0.9),
            ChunkVote("chunk_2", "img", "documents/legal", 0.6),
            ChunkVote("chunk_3", "text", "documents/hr", 0.3),  # En dessous du seuil
            ChunkVote("chunk_4", "img", "documents/hr", 0.8),
        ]

        # Simuler l'ajout des votes avec filtrage par seuil
        for vote in votes:
            if vote.confidence >= voter.confidence_threshold:
                voter.chunk_votes.append(vote)
                if vote.chunk_type == "img":
                    voter.img_votes.append(vote)
                else:
                    voter.text_votes.append(vote)

        result = voter.compute_majority_vote()

        assert result.total_chunks == 3  # Un vote filtré
        assert len(result.chunk_votes) == 3

    def test_voter_with_tie_breaking(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter , ChunkVote
        """Test avec égalité dans les votes"""
        voter = DocumentMajorityVoter("doc_1")

        votes = [
            ChunkVote("chunk_1", "text", "documents/legal", 0.7),
            ChunkVote("chunk_2", "img", "documents/hr", 0.7),
        ]
        voter.chunk_votes = votes
        voter.text_votes = [votes[0]]
        voter.img_votes = [votes[1]]

        result = voter.compute_majority_vote()

        # Vérifier qu'une catégorie est choisie même en cas d'égalité
        assert result.predicted_category in ["documents/legal", "documents/hr"]

    def test_voter_with_zero_confidence_votes(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter , ChunkVote
        """Test avec des votes de confiance zéro"""
        voter = DocumentMajorityVoter("doc_1", confidence_threshold=0.0)

        votes = [
            ChunkVote("chunk_1", "text", "documents/legal", 0.0),
            ChunkVote("chunk_2", "img", "documents/hr", 0.0),
        ]
        voter.chunk_votes = votes

        result = voter.compute_majority_vote()

        assert result.final_confidence >= 0.0

    def test_voter_exception_handling_in_compute(self):
        from src.modules.indexing.files_classification.multimodal_majority_voting import DocumentMajorityVoter , ChunkVote
        """Test la gestion d'exception dans compute_majority_vote"""
        voter = DocumentMajorityVoter("doc_1")

        # Créer une situation qui pourrait causer une exception
        votes = [ChunkVote("chunk_1", "text", "documents/legal", 0.8)]
        voter.chunk_votes = votes

        # Mock pour forcer une exception dans _calculate_vote_metrics
        with patch.object(voter, '_calculate_vote_metrics', side_effect=Exception("Test error")):
            result = voter.compute_majority_vote()

            # Devrait retourner un résultat vide en cas d'erreur
            assert result.predicted_category == "unknown"
            assert result.final_confidence == 0.0
