"""
Fonctions utilitaires pour l'évaluation d'agents.

Ce module contient les fonctions de validation, transformation et calcul
pour l'évaluation d'agents avec Google ADK.
"""
from typing import Dict, Any, List
import numpy as np
from src.schema.chatbot_schema import AgentSuggestion
from src.schema.evaluation_results import (
    EvaluationScore,
    TestCaseEvaluations,
    TestResult,
    EvaluationSummaryMetrics,
    TrajectoryMatchSummary,
    LLMJudgeSummary,
    EvaluationSummary
)
from src.logger.logging import get_logger

logger = get_logger("api.evaluation.utils")


def validate_agent_config(agent_config: Dict[str, Any]) -> None:
    """
    Valide la configuration d'un agent.

    Args:
        agent_config: Configuration de l'agent à valider

    Raises:
        ValueError: Si des champs requis sont manquants
    """
    # Reconstruct chatbot_name if missing but chatbot is present (NestJS format)
    if not agent_config.get("chatbot_name") and agent_config.get("chatbot"):
        cb = agent_config["chatbot"]
        if isinstance(cb, dict) and cb.get("model"):
            agent_config["chatbot_name"] = {"provider": "", "model": cb["model"]}

    # Reconstruct chatbot_name if missing but model is present
    if not agent_config.get("chatbot_name") and agent_config.get("model"):
        m = agent_config["model"]
        if "/" in m:
            p, n = m.split("/", 1)
            agent_config["chatbot_name"] = {"provider": p, "model": n}
        else:
            agent_config["chatbot_name"] = {"provider": "", "model": m}
    
    # Reconstruct prompt if missing but instruction is present
    if not agent_config.get("prompt") and agent_config.get("instruction"):
        agent_config["prompt"] = agent_config["instruction"]

    # Champs strictement requis (ne peuvent pas être None ou vides)
    required_fields = {
        "id": "Agent ID is required",
        "name": "Agent name is required",
        "chatbot_name": "Agent chatbot_name is required",
        "agent_type": "Agent agent_type is required",
        "description": "Agent description is required",
        "prompt": "Agent prompt is required",
        "session_id": "session_id is required in agent_config",
        "user_id": "user_id is required in agent_config"
    }

    for field, error_msg in required_fields.items():
        if field not in agent_config or not agent_config[field]:
            raise ValueError(error_msg)


def convert_agent_suggestion_to_dict(agent: AgentSuggestion) -> Dict[str, Any]:
    """
    Convertit un AgentSuggestion en dictionnaire pour ADKAgentEvaluator.

    Args:
        agent: L'agent sous forme AgentSuggestion

    Returns:
        Dict avec la configuration de l'agent

    Raises:
        ValueError: Si des champs requis sont manquants
    """
    # Map compatibility aliases
    chatbot_name = agent.chatbot_name
    
    # Support NestJS 'chatbot' field mapping
    if not chatbot_name and agent.chatbot:
        model_val = agent.chatbot.get("model", "")
        if model_val:
            chatbot_name = {"provider": "", "model": model_val}

    if not chatbot_name and agent.model:
        if "/" in agent.model:
            p, m = agent.model.split("/", 1)
            chatbot_name = {"provider": p, "model": m}
        else:
            chatbot_name = {"provider": "", "model": agent.model}
            
    prompt = agent.prompt
    if not prompt and agent.instruction:
        prompt = agent.instruction

    # Valider les champs requis
    if not agent.id:
        raise ValueError("Agent ID is required")
    if not agent.name:
        raise ValueError("Agent name is required")
    if not chatbot_name:
        # Final fallback check
        raise ValueError("Agent chatbot_name is required")
    if not agent.agent_type:
        raise ValueError("Agent agent_type is required")
    if not prompt:
        raise ValueError("Agent prompt is required")

    return {
        "id": agent.id,
        "name": agent.name,
        "description": agent.description,
        "prompt": prompt,
        "tools": agent.tools,
        "html": agent.html,
        "vectorstore_name": agent.vectorstore_name,
        "brain_ids": agent.brain_ids,
        "brain_documents": agent.brain_documents,
        "brain_relations": agent.brain_relations,
        "chatbot_name": chatbot_name,
        "agent_params": agent.agent_params,
        "agent_type": agent.agent_type,
        "save_memory": agent.save_memory
    }

def compute_overall_status(trajectory_status: str, llm_judge_status: str) -> str:
    """
    Calcule le statut global d'un test case.

    Logique:
    - Si l'un des deux est en erreur -> "error"
    - Si les deux sont success -> "success"
    - Sinon -> "failed"

    Args:
        trajectory_status: Statut trajectory match ("success", "failed", "error")
        llm_judge_status: Statut LLM judge ("success", "failed", "error")

    Returns:
        str: Statut global ("success", "failed", "error")
    """
    if trajectory_status == "error" or llm_judge_status == "error":
        return "error"
    if trajectory_status == "success" and llm_judge_status == "success":
        return "success"
    return "failed"


def create_evaluation_score(
    status: str,
    score: float = None,
    reasoning: str = None,
    full_result: Dict[str, Any] = None,
    error: str = None
) -> EvaluationScore:
    """
    Crée un EvaluationScore structuré.

    Args:
        status: Statut de l'évaluation
        score: Score optionnel
        reasoning: Raisonnement optionnel
        full_result: Résultat complet optionnel
        error: Message d'erreur optionnel

    Returns:
        EvaluationScore: Score d'évaluation structuré
    """
    comment = full_result.get("comment") if full_result else None
    return EvaluationScore(
        status=status,
        score=score,
        reasoning=reasoning,
        comment=comment,
        error=error,
        full_result=full_result
    )


def calculate_cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    """
    Calcule la similarité cosinus entre deux vecteurs.

    Args:
        vec1: Premier vecteur
        vec2: Second vecteur

    Returns:
        float: Similarité cosinus (entre -1.0 et 1.0, ramené à 0.0-1.0 pour les scores)
    """
    a = np.array(vec1)
    b = np.array(vec2)
    
    # Calculer le produit scalaire
    dot_product = np.dot(a, b)
    
    # Calculer les normes
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    
    if norm_a == 0 or norm_b == 0:
        return 0.0
        
    return float(dot_product / (norm_a * norm_b))


class EvaluationStatisticsCalculator:
    """Classe utilitaire pour calculer les statistiques d'évaluation."""

    @staticmethod
    def calculate_summary(
        detailed_results: List[TestResult],
        trajectory_match_mode: str,
        eval_model: str,
        llm_success_threshold: float
    ) -> EvaluationSummary:
        """
        Calcule le résumé complet des résultats d'évaluation.

        Args:
            detailed_results: Liste des résultats détaillés
            trajectory_match_mode: Mode de trajectory match utilisé
            eval_model: Modèle d'évaluation utilisé
            llm_success_threshold: Seuil de succès pour LLM judge

        Returns:
            EvaluationSummary: Résumé structuré
        """
        total_tests = len(detailed_results)

        # Calculer les statistiques Trajectory Match
        trajectory_summary = EvaluationStatisticsCalculator._calculate_trajectory_stats(
            detailed_results, total_tests, trajectory_match_mode
        )

        # Calculer les statistiques LLM Judge
        llm_judge_summary = EvaluationStatisticsCalculator._calculate_llm_judge_stats(
            detailed_results, total_tests, eval_model, llm_success_threshold
        )

        # Calculer les statistiques globales
        overall_summary = EvaluationStatisticsCalculator._calculate_overall_stats(
            detailed_results, total_tests
        )

        return EvaluationSummary(
            overall=overall_summary,
            trajectory_match=trajectory_summary,
            llm_judge=llm_judge_summary
        )

    @staticmethod
    def _calculate_trajectory_stats(
        detailed_results: List[TestResult],
        total_tests: int,
        mode: str
    ) -> TrajectoryMatchSummary:
        """Calcule les statistiques Trajectory Match."""
        passed_tests = sum(
            1 for r in detailed_results
            if r.evaluations
            and r.evaluations.trajectory_match.status == "success"
        )
        failed_tests = total_tests - passed_tests
        success_rate = (passed_tests / total_tests * 100) if total_tests > 0 else 0.0

        return TrajectoryMatchSummary(
            passed_tests=passed_tests,
            failed_tests=failed_tests,
            total_tests=total_tests,
            success_rate=success_rate,
            mode=mode
        )

    @staticmethod
    def _calculate_llm_judge_stats(
        detailed_results: List[TestResult],
        total_tests: int,
        model: str,
        threshold: float
    ) -> LLMJudgeSummary:
        """Calcule les statistiques LLM Judge."""
        # Récupérer tous les scores valides (déjà en 0-100% dans TestResult)
        llm_scores = [
            r.evaluations.llm_judge.score
            for r in detailed_results
            if r.evaluations
            and r.evaluations.llm_judge.score is not None
        ]

        avg_score = sum(llm_scores) / len(llm_scores) if llm_scores else 0.0

        passed_tests = sum(
            1 for r in detailed_results
            if r.evaluations
            and r.evaluations.llm_judge.status == "success"
        )
        failed_tests = total_tests - passed_tests
        success_rate = (passed_tests / total_tests * 100) if total_tests > 0 else 0.0

        return LLMJudgeSummary(
            passed_tests=passed_tests,
            failed_tests=failed_tests,
            total_tests=total_tests,
            success_rate=success_rate,
            average_score=avg_score,
            model=model,
            threshold=threshold
        )

    @staticmethod
    def _calculate_overall_stats(
        detailed_results: List[TestResult],
        total_tests: int
    ) -> EvaluationSummaryMetrics:
        """Calcule les statistiques globales."""
        success_tests = sum(1 for r in detailed_results if r.status == "success")
        failed_tests = sum(1 for r in detailed_results if r.status == "failed")
        error_tests = sum(1 for r in detailed_results if r.status == "error")
        success_rate = (success_tests / total_tests * 100) if total_tests > 0 else 0.0

        # Calculer le score sémantique moyen
        semantic_scores = [
            r.semantic_score
            for r in detailed_results
            if r.semantic_score is not None
        ]
        avg_semantic_score = sum(semantic_scores) / len(semantic_scores) if semantic_scores else 0.0

        # Calculer le score de cohérence moyen
        coherence_scores = [
            r.coherence_score
            for r in detailed_results
            if r.coherence_score is not None
        ]
        avg_coherence_score = sum(coherence_scores) / len(coherence_scores) if coherence_scores else 0.0

        # Calculer le score d'hallucination moyen (ADK)
        hallucination_scores = [
            r.hallucination_score
            for r in detailed_results
            if r.hallucination_score is not None
        ]
        avg_hallucination_score = sum(hallucination_scores) / len(hallucination_scores) if hallucination_scores else 0.0

        # Calculer le score de réponse match moyen (ADK)
        response_match_scores = [
            r.response_match_score
            for r in detailed_results
            if r.response_match_score is not None
        ]
        avg_response_match_score = sum(response_match_scores) / len(response_match_scores) if response_match_scores else 0.0

        return EvaluationSummaryMetrics(
            success_tests=success_tests,
            failed_tests=failed_tests,
            error_tests=error_tests,
            total_tests=total_tests,
            success_rate=success_rate,
            average_semantic_score=avg_semantic_score,
            average_coherence_score=avg_coherence_score,
            average_hallucination_score=avg_hallucination_score,
            average_response_match_score=avg_response_match_score
        )
