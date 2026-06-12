from typing import Dict, List, Tuple, Any, Optional
from collections import Counter, defaultdict
import logging
import datetime
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)


class VotingWeights:
    """Constantes pour les poids de vote"""
    SIMPLE_VOTE_WEIGHT = 0.3
    CONFIDENCE_WEIGHT = 0.5
    AVERAGE_CONFIDENCE_WEIGHT = 0.2


class DefaultConfig:
    """Configuration par défaut pour le majority voting"""
    IMG_WEIGHT = 0.4
    TEXT_WEIGHT = 0.6
    CONFIDENCE_THRESHOLD = 0.2

@dataclass
class ChunkVote:
    """Vote d'un chunk individuel"""
    chunk_id: str
    chunk_type: str  # 'img' ou 'text'
    predicted_category: str
    confidence: float
    hierarchy_path: Optional[List[str]] = None

@dataclass
class DocumentClassificationResult:
    """Résultat final de classification d'un document"""
    document_id: str
    predicted_category: str
    final_confidence: float
    total_chunks: int
    img_chunks_count: int
    text_chunks_count: int
    vote_distribution: Dict[str, int]
    confidence_by_category: Dict[str, float]
    chunk_votes: List[ChunkVote]
    voting_analysis: Dict[str, Any]
    processing_metadata: Dict[str, Any]

class DocumentMajorityVoter:
    """
    Classe pour effectuer le majority voting sur un document unique
    avec pondération entre chunks d'images et de texte
    """

    def __init__(
            self,
            document_id: str,
            img_weight: float = DefaultConfig.IMG_WEIGHT,
            text_weight: float = DefaultConfig.TEXT_WEIGHT,
            confidence_threshold: float = DefaultConfig.CONFIDENCE_THRESHOLD
    ):
        """
        Initialise le voteur majoritaire pour un document

        Args:
            document_id: ID du document à traiter
            img_weight: Poids accordé aux votes des chunks d'images (défaut: 0.4)
            text_weight: Poids accordé aux votes des chunks de texte (défaut: 0.6)
            confidence_threshold: Seuil minimum de confiance pour considérer un vote
        """
        # Validation des poids
        if not (0 <= img_weight <= 1 and 0 <= text_weight <= 1):
            raise ValueError("Les poids doivent être entre 0 et 1")
        if not (0 <= confidence_threshold <= 1):
            raise ValueError("Le seuil de confiance doit être entre 0 et 1")
        if abs((img_weight + text_weight) - 1.0) > 1e-6:
            logger.warning(f"Les poids totalisent {img_weight + text_weight}, pas 1.0")

        self.document_id = document_id
        self.img_weight = img_weight
        self.text_weight = text_weight
        self.confidence_threshold = confidence_threshold

        # Collections pour stocker les votes
        self.chunk_votes: List[ChunkVote] = []
        self.img_votes: List[ChunkVote] = []
        self.text_votes: List[ChunkVote] = []

        # Cache pour optimiser les performances
        self._vote_distribution_cache: Optional[Dict[str, int]] = None
        self._confidence_by_category_cache: Optional[Dict[str, float]] = None

        # Résultats calculés
        self._final_result: Optional[DocumentClassificationResult] = None

    def add_classification_results(self, img_result: Dict, text_result: Dict) -> None:
        """
        Ajoute les résultats de classification des images et du texte

        Args:
            img_result: Résultat de traitement des images
                       {"ids": [...], "n_tokens": ..., "classifications": [...]}
            text_result: Résultat de traitement du texte
                        {"ids": [...], "n_tokens": ..., "classifications": [...]}
        """
        try:
            logger.info(f"Ajout des résultats de classification pour le document {self.document_id}")

            # Traiter les classifications d'images et de texte
            self._process_classifications(img_result, "img")
            self._process_classifications(text_result, "text")

            # Invalider les caches
            self._invalidate_caches()

            logger.info(f"Votes collectés: {len(self.img_votes)} images, {len(self.text_votes)} texte")

        except Exception as e:
            logger.exception(f"Erreur lors de l'ajout des résultats: {str(e)}")
            raise

    def _process_classifications(self, result: Dict, chunk_type: str) -> None:
        """
        Traite les classifications pour n'importe quel type de chunk

        Args:
            result: Résultat contenant les classifications
            chunk_type: Type de chunk ('img' ou 'text')
        """
        votes = []
        classifications = result.get("classifications", {})
        target_list = self.img_votes if chunk_type == "img" else self.text_votes

        # Si classifications est un dictionnaire résultant de DocumentClassificationResult.to_dict()
        if isinstance(classifications, dict):
            # Vérifier si c'est un DocumentClassificationResult.to_dict()
            if 'chunk_votes' in classifications:
                # C'est un DocumentClassificationResult.to_dict(), extraire les chunk_votes
                chunk_votes = classifications.get('chunk_votes', [])
                if isinstance(chunk_votes, list):
                    votes = [self._create_chunk_vote_from_chunk_vote_dict(cv, chunk_type)
                            for cv in chunk_votes if isinstance(cv, dict)]
                else:
                    votes = []

        elif isinstance(classifications, list):
            # Format liste traditionnel
            votes = [self._create_chunk_vote(c, chunk_type) for c in classifications]
        else:
            logger.warning(f"Format de classifications non reconnu: {type(classifications)}")
            return

        # Filtrer les votes valides et au-dessus du seuil
        valid_votes = [v for v in votes if v and v.confidence >= self.confidence_threshold]

        # Ajouter aux listes appropriées
        target_list.extend(valid_votes)
        self.chunk_votes.extend(valid_votes)

    def _create_chunk_vote(self, classification: Any, chunk_type: str) -> Optional[ChunkVote]:
        """Crée un ChunkVote à partir d'un objet de classification"""
        try:
            if hasattr(classification, 'chunk_id'):
                chunk_id = classification.chunk_id
                category = getattr(classification, 'predicted_category', 'unknown')
                confidence = getattr(classification, 'final_confidence', 0.0)
                hierarchy_path = getattr(classification, 'hierarchy_path', None)
            else:
                return None

            return ChunkVote(
                chunk_id=chunk_id,
                chunk_type=chunk_type,
                predicted_category=category,
                confidence=confidence,
                hierarchy_path=hierarchy_path
            )

        except Exception as e:
            logger.warning(f"Erreur lors de la création du vote: {str(e)}")
            return None

    def _create_chunk_vote_from_dict(self, classification: Dict, chunk_id: str, chunk_type: str) -> Optional[ChunkVote]:
        """Crée un ChunkVote à partir d'un dictionnaire"""
        try:
            category = classification.get('predicted_category', 'unknown')
            confidence = classification.get('final_confidence', 0.0)
            hierarchy_path = classification.get('hierarchy_path', None)

            return ChunkVote(
                chunk_id=chunk_id,
                chunk_type=chunk_type,
                predicted_category=category,
                confidence=confidence,
                hierarchy_path=hierarchy_path
            )

        except Exception as e:
            logger.warning(f"Erreur lors de la création du vote depuis dict: {str(e)}")
            return None

    def _create_chunk_vote_from_chunk_vote_dict(self, chunk_vote_dict: Dict, chunk_type: str) -> Optional[ChunkVote]:
        """Crée un ChunkVote à partir d'un dictionnaire de chunk_vote (depuis DocumentClassificationResult.to_dict())"""
        try:
            chunk_id = chunk_vote_dict.get('chunk_id', 'unknown')
            category = chunk_vote_dict.get('predicted_category', 'unknown')
            confidence = chunk_vote_dict.get('final_confidence', 0.0)
            hierarchy_path = chunk_vote_dict.get('hierarchy_path', None)
            # Le chunk_type peut être dans le dict ou passé en paramètre
            original_chunk_type = chunk_type

            return ChunkVote(
                chunk_id=chunk_id,
                chunk_type=original_chunk_type,
                predicted_category=category,
                confidence=confidence,
                hierarchy_path=hierarchy_path
            )

        except Exception as e:
            logger.warning(f"Erreur lors de la création du vote depuis chunk_vote_dict: {str(e)}")
            return None

    def compute_majority_vote(self) -> DocumentClassificationResult:
        """
        Calcule le majority voting pondéré et retourne le résultat final

        Returns:
            DocumentClassificationResult: Résultat final de la classification
        """
        try:
            logger.info(f"Calcul du majority voting pour le document {self.document_id}")

            if not self.chunk_votes:
                return self._create_empty_result()

            # 1. Calculer les métriques de vote
            vote_metrics = self._calculate_vote_metrics()

            # 2. Déterminer la catégorie gagnante
            winning_category, final_confidence = self._determine_winner(vote_metrics)

            # 3. Analyser les votes par catégorie
            confidence_by_category = self.confidence_by_category

            # 4. Créer l'analyse détaillée
            voting_analysis = self._create_voting_analysis(vote_metrics)

            # 5. Métadonnées de traitement
            processing_metadata = self._create_processing_metadata()

            result = DocumentClassificationResult(
                document_id=self.document_id,
                predicted_category=winning_category,
                final_confidence=final_confidence,
                total_chunks=len(self.chunk_votes),
                img_chunks_count=len(self.img_votes),
                text_chunks_count=len(self.text_votes),
                vote_distribution=self.vote_distribution,
                confidence_by_category=confidence_by_category,
                chunk_votes=self.chunk_votes,
                voting_analysis=voting_analysis,
                processing_metadata=processing_metadata
            )

            self._final_result = result
            logger.info(f"Document {self.document_id} classifié: {winning_category} (confiance: {final_confidence:.3f})")

            return result

        except Exception as e:
            logger.exception(f"Erreur lors du calcul du majority voting: {str(e)}")
            return self._create_empty_result()

    def _calculate_vote_metrics(self) -> Dict[str, Dict[str, float]]:
        """Calcule les différentes métriques de vote"""
        metrics = defaultdict(lambda: {
            'simple_votes': 0,
            'weighted_confidence': 0.0,
            'img_votes': 0,
            'text_votes': 0,
            'total_confidence': 0.0,
            'vote_count': 0
        })

        for vote in self.chunk_votes:
            category = vote.predicted_category

            # Votes simples
            metrics[category]['simple_votes'] += 1
            metrics[category]['vote_count'] += 1
            metrics[category]['total_confidence'] += vote.confidence

            # Votes pondérés par type
            if vote.chunk_type == 'img':
                metrics[category]['weighted_confidence'] += vote.confidence * self.img_weight
                metrics[category]['img_votes'] += 1
            else:
                metrics[category]['weighted_confidence'] += vote.confidence * self.text_weight
                metrics[category]['text_votes'] += 1

        return dict(metrics)

    def _determine_winner(self, vote_metrics: Dict[str, Dict[str, float]]) -> Tuple[str, float]:
        """Détermine la catégorie gagnante et sa confiance finale"""
        if not vote_metrics:
            return "unknown", 0.0

        final_scores = {}
        total_votes = len(self.chunk_votes)

        for category, metrics in vote_metrics.items():
            # Score basé sur le nombre de votes
            vote_score = metrics['simple_votes'] / total_votes * VotingWeights.SIMPLE_VOTE_WEIGHT

            # Score basé sur la confiance pondérée
            confidence_score = metrics['weighted_confidence'] / total_votes * VotingWeights.CONFIDENCE_WEIGHT

            # Score basé sur la confiance moyenne
            avg_confidence = metrics['total_confidence'] / metrics['vote_count']
            avg_confidence_score = avg_confidence * VotingWeights.AVERAGE_CONFIDENCE_WEIGHT

            final_scores[category] = vote_score + confidence_score + avg_confidence_score

        winning_category = max(final_scores, key=final_scores.get)
        final_confidence = final_scores[winning_category]

        return winning_category, final_confidence

    @property
    def vote_distribution(self) -> Dict[str, int]:
        """Distribution des votes avec cache pour optimiser les performances"""
        if self._vote_distribution_cache is None:
            self._vote_distribution_cache = dict(Counter(
                vote.predicted_category for vote in self.chunk_votes
            ))
        return self._vote_distribution_cache

    @property
    def confidence_by_category(self) -> Dict[str, float]:
        """Confiance moyenne par catégorie avec cache"""
        if self._confidence_by_category_cache is None:
            confidence_by_category = defaultdict(list)

            for vote in self.chunk_votes:
                confidence_by_category[vote.predicted_category].append(vote.confidence)

            self._confidence_by_category_cache = {
                category: sum(confidences) / len(confidences)
                for category, confidences in confidence_by_category.items()
            }
        return self._confidence_by_category_cache

    def _invalidate_caches(self) -> None:
        """Invalide les caches après modification des votes"""
        self._vote_distribution_cache = None
        self._confidence_by_category_cache = None

    def _create_voting_analysis(self, vote_metrics: Dict[str, Dict[str, float]]) -> Dict[str, Any]:
        """Crée l'analyse détaillée du vote"""
        return {
            'vote_metrics': vote_metrics,
            'weights_used': {
                'img_weight': self.img_weight,
                'text_weight': self.text_weight
            },
            'threshold_used': self.confidence_threshold,
            'vote_breakdown': {
                'total_votes': len(self.chunk_votes),
                'img_votes': len(self.img_votes),
                'text_votes': len(self.text_votes),
                'votes_above_threshold': sum(1 for v in self.chunk_votes if v.confidence >= self.confidence_threshold)
            }
        }

    def _create_processing_metadata(self) -> Dict[str, Any]:
        """Crée les métadonnées de traitement"""
        return {
            'document_id': self.document_id,
            'processing_timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'voter_config': {
                'img_weight': self.img_weight,
                'text_weight': self.text_weight,
                'confidence_threshold': self.confidence_threshold
            },
            'chunks_processed': {
                'total': len(self.chunk_votes),
                'by_type': {
                    'img': len(self.img_votes),
                    'text': len(self.text_votes)
                }
            }
        }

    def _create_empty_result(self) -> DocumentClassificationResult:
        """Crée un résultat vide en cas d'absence de votes valides"""
        return DocumentClassificationResult(
            document_id=self.document_id,
            predicted_category="unknown",
            final_confidence=0.0,
            total_chunks=0,
            img_chunks_count=0,
            text_chunks_count=0,
            vote_distribution={},
            confidence_by_category={},
            chunk_votes=[],
            voting_analysis={},
            processing_metadata={"status": "no_valid_votes"}
        )

    def get_result_as_dict(self) -> Dict[str, Any]:
        """Retourne le résultat sous forme de dictionnaire"""
        if self._final_result is None:
            raise ValueError("Aucun résultat calculé. Appelez compute_majority_vote() d'abord.")

        return asdict(self._final_result)


def _return_single_result(single_result: Dict, result_type: str, document_id: str) -> Tuple[Dict, Dict]:
    """
    Retourne directement un résultat unique sans majority voting

    Args:
        single_result: Le résultat de classification unique
        result_type: Type de résultat ('img' ou 'text')
        document_id: ID du document

    Returns:
        Tuple[Dict, Dict]: (final_classification, processing_summary)
    """
    try:
        classifications = single_result.get("classifications", {})

        # Cas où c'est un résultat de classification complet (avec chunk_votes directement)
        if isinstance(classifications, dict) and 'chunk_votes' in classifications:
            predicted_category = classifications.get("predicted_category", "unknown")
            final_confidence = classifications.get("final_confidence", 0.0)
            chunk_votes = classifications.get("chunk_votes", [])
            vote_distribution = classifications.get("vote_distribution", {})
        # Cas où c'est un dictionnaire de classifications indexées
        elif isinstance(classifications, dict) and len(classifications) > 0:
            first_classification = next(iter(classifications.values()), None)

            if isinstance(first_classification, dict):
                # Si c'est un dictionnaire, extraire les informations
                predicted_category = first_classification.get("predicted_category", "unknown")
                final_confidence = first_classification.get("final_confidence", 0.0)
                chunk_votes = first_classification.get("chunk_votes", [])
                vote_distribution = first_classification.get("vote_distribution", {})
            else:
                # Si c'est un autre type d'objet, utiliser les attributs
                predicted_category = getattr(first_classification, 'predicted_category', 'unknown')
                final_confidence = getattr(first_classification, 'final_confidence', 0.0)
                chunk_votes = getattr(first_classification, 'chunk_votes', [])
                vote_distribution = getattr(first_classification, 'vote_distribution', {})
        else:
            predicted_category = "unknown"
            final_confidence = 0.0
            chunk_votes = []
            vote_distribution = {}

        # Créer le résultat final
        final_classification = {
            "document_id": document_id,
            "predicted_category": predicted_category,
            "final_confidence": final_confidence,
            "total_chunks": len(chunk_votes),
            "img_chunks_count": len(chunk_votes) if result_type == "img" else 0,
            "text_chunks_count": len(chunk_votes) if result_type == "text" else 0,
            "vote_distribution": vote_distribution,
            "confidence_by_category": {predicted_category: final_confidence} if predicted_category != "unknown" else {},
            "chunk_votes": chunk_votes,
            "voting_analysis": {
                "single_result_used": True,
                "result_type": result_type,
                "majority_voting_skipped": True
            },
            "processing_metadata": {
                "document_id": document_id,
                "processing_timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "single_result_processing": True,
                "result_type": result_type
            }
        }

        # Créer le résumé de traitement
        processing_summary = {
            "document_processed": document_id,
            "classification_result": predicted_category,
            "final_confidence": final_confidence,
            "total_chunks_processed": len(chunk_votes),
            "img_chunks": len(chunk_votes) if result_type == "img" else 0,
            "text_chunks": len(chunk_votes) if result_type == "text" else 0,
            "total_tokens_img": single_result.get("n_tokens", 0) if result_type == "img" else 0,
            "total_tokens_text": single_result.get("n_tokens", 0) if result_type == "text" else 0,
            "vote_distribution": vote_distribution,
            "status": "completed_single_result",
            "majority_voting_used": False,
            "result_type_used": result_type
        }

        return final_classification, processing_summary

    except Exception as e:
        logger.exception(f"Erreur dans _return_single_result: {str(e)}")
        raise


def global_majority_vote_with_weights(img_result: Dict, text_result: Dict) -> Tuple[Dict, Dict]:
    """
    Fonction principale utilisant la classe DocumentMajorityVoter

    Args:
        img_result: Résultat de traitement des images
        text_result: Résultat de traitement du texte

    Returns:
        Tuple[Dict, Dict]: (final_classification, processing_summary)
    """
    try:
        logger.info("Début du majority voting global avec pondération")

        # Fonction helper pour vérifier si un résultat est valide
        def _is_valid_result(result):
            if result is None:
                return False
            classifications = result.get("classifications", {})

            # Vérifier si la structure contient des données valides
            if isinstance(classifications, dict):
                # Cas où c'est un résultat de classification complet avec chunk_votes
                if 'chunk_votes' in classifications:
                    chunk_votes = classifications.get('chunk_votes', [])
                    return isinstance(chunk_votes, list) and len(chunk_votes) > 0
                # Cas où c'est un dictionnaire non-vide (autre structure)
                elif len(classifications) > 0:
                    return True

            return False

        # Vérifier la validité des résultats
        img_valid = _is_valid_result(img_result)
        text_valid = _is_valid_result(text_result)

        logger.info(f"Résultats valides - Image: {img_valid}, Texte: {text_valid}")

        # Cas où les deux résultats sont invalides
        if not img_valid and not text_valid:
            logger.warning("Aucun résultat de classification valide disponible")
            raise ValueError("Aucun résultat de classification valide disponible")

        # Extraire ou générer l'ID du document
        img_classifications = img_result.get("classifications", {}) if img_result else {}
        text_classifications = text_result.get("classifications", {}) if text_result else {}

        document_id_img_src = None
        if img_classifications:
            # Cas où c'est un résultat de classification complet
            if 'document_id' in img_classifications:
                document_id_img_src = img_classifications.get('document_id')
            # Cas où c'est un dictionnaire de classifications indexées
            elif len(img_classifications) > 0:
                first_img_classification = next(iter(img_classifications.values()), None)
                if first_img_classification and hasattr(first_img_classification, 'document_id'):
                    document_id_img_src = first_img_classification.document_id

        document_id_txt_src = None
        if text_classifications:
            if 'document_id' in text_classifications:
                document_id_txt_src = text_classifications.get('document_id')
            elif len(text_classifications) > 0:
                first_text_classification = next(iter(text_classifications.values()), None)
                if first_text_classification and hasattr(first_text_classification, 'document_id'):
                    document_id_txt_src = first_text_classification.document_id

        if document_id_img_src and document_id_txt_src and document_id_img_src == document_id_txt_src:
            document_id = document_id_txt_src
        elif document_id_img_src:
            document_id = document_id_img_src
        elif document_id_txt_src:
            document_id = document_id_txt_src
        else:
            document_id = "unknown"

        # Cas où un seul résultat est valide - retourner directement ce résultat
        if img_valid and not text_valid:
            logger.info("Seul le résultat image est valide, retour direct sans majority voting")
            return _return_single_result(img_result, "img", document_id)
        elif text_valid and not img_valid:
            logger.info("Seul le résultat texte est valide, retour direct sans majority voting")
            return _return_single_result(text_result, "text", document_id)

        # Cas où les deux résultats sont valides - faire le majority voting
        logger.info("Les deux résultats sont valides, exécution du majority voting")

        # Créer le voteur avec configuration par défaut
        voter = DocumentMajorityVoter(
            document_id=document_id,
            img_weight=DefaultConfig.IMG_WEIGHT,
            text_weight=DefaultConfig.TEXT_WEIGHT,
            confidence_threshold=DefaultConfig.CONFIDENCE_THRESHOLD
        )

        # Ajouter les résultats de classification
        voter.add_classification_results(img_result, text_result)

        # Calculer le majority voting
        final_result = voter.compute_majority_vote()

        # Créer le résumé de traitement
        processing_summary = {
            "document_processed": document_id,
            "classification_result": final_result.predicted_category,
            "final_confidence": final_result.final_confidence,
            "total_chunks_processed": final_result.total_chunks,
            "img_chunks": final_result.img_chunks_count,
            "text_chunks": final_result.text_chunks_count,
            "total_tokens_img": img_result.get("n_tokens", 0) if img_result else 0,
            "total_tokens_text": text_result.get("n_tokens", 0) if text_result else 0,
            "vote_distribution": final_result.vote_distribution,
            "status": "completed"
        }

        return voter.get_result_as_dict(), processing_summary

    except Exception as e:
        logger.exception(f"Erreur dans global_majority_vote_with_weights: {str(e)}")
