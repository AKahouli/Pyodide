"""
Modèles Pydantic pour les résultats d'évaluation d'agents.

Ce module définit les structures de données typées pour les résultats
des évaluations d'agents avec Google ADK.
"""
from typing import Optional, Dict, Any
from pydantic import BaseModel, Field


class EvaluationScore(BaseModel):
    """Résultat d'une évaluation individuelle."""
    status: str = Field(..., description="Statut de l'évaluation (success, failed, error)")
    score: Optional[float] = Field(None, description="Score de l'évaluation (0.0 à 1.0)")
    reasoning: Optional[str] = Field(None, description="Raisonnement du LLM judge")
    comment: Optional[str] = Field(None, description="Commentaire de l'évaluateur")
    error: Optional[str] = Field(None, description="Message d'erreur si applicable")
    full_result: Optional[Dict[str, Any]] = Field(None, description="Résultat complet de l'évaluateur")


class TestCaseEvaluations(BaseModel):
    """Évaluations complètes d'un test case."""
    trajectory_match: EvaluationScore
    llm_judge: EvaluationScore


class TestResult(BaseModel):
    """Résultat détaillé d'un test case."""
    test_number: int = Field(..., description="Numéro du test")
    question: str = Field(..., description="Question posée à l'agent")
    reference_answer: str = Field(..., description="Réponse de référence attendue")
    agent_answer: Optional[str] = Field(None, description="Réponse de l'agent")
    expected: Optional[str] = Field(None, description="Alias pour reference_answer")
    actual: Optional[str] = Field(None, description="Alias pour agent_answer")
    expectedAnswer: Optional[str] = Field(None, description="Alias camelCase pour reference_answer")
    agentAnswer: Optional[str] = Field(None, description="Alias camelCase pour agent_answer")
    evaluations: Optional[TestCaseEvaluations] = Field(None, description="Résultats des évaluations")
    status: str = Field(..., description="Statut global du test (success, failed, error)")
    result: str = Field(..., description="Alias de status pour le frontend")
    id: str = Field(..., description="ID unique pour React key")
    run_index: int = Field(1, description="Index de l'itération (run)")
    runIndex: int = Field(1, description="Alias camelCase pour run_index")
    # Scores ADK (snake_case pour calculs et DB)
    semantic_score: Optional[float] = Field(0.0, description="Score sémantique global du test (0.0 à 100.0)")
    coherence_score: Optional[float] = Field(0.0, description="Score de cohérence (0.0 à 1.0)")
    hallucination_score: Optional[float] = Field(0.0, description="Score d'hallucination ADK (0.0 à 1.0)")
    response_match_score: Optional[float] = Field(0.0, description="Score de correspondance de réponse ADK (0.0 à 1.0)")
    # Alias camelCase pour le frontend (React)
    semanticScore: Optional[float] = Field(0.0, description="Alias camelCase")
    coherenceScore: Optional[float] = Field(0.0, description="Alias camelCase")
    hallucinationScore: Optional[float] = Field(0.0, description="Alias camelCase")
    responseMatchScore: Optional[float] = Field(0.0, description="Alias camelCase")
    error: Optional[str] = Field(None, description="Message d'erreur si le test a échoué")


class EvaluationSummaryMetrics(BaseModel):
    """Métriques de résumé pour une catégorie d'évaluation."""
    success_tests: int = Field(0, description="Nombre de tests réussis")
    failed_tests: int = Field(0, description="Nombre de tests échoués")
    error_tests: int = Field(0, description="Nombre de tests en erreur")
    total_tests: int = Field(0, description="Nombre total de tests")
    success_rate: float = Field(0.0, description="Taux de réussite en pourcentage")
    average_semantic_score: float = Field(0.0, description="Score sémantique moyen en pourcentage")
    average_coherence_score: float = Field(0.0, description="Score de cohérence moyen en pourcentage")
    average_hallucination_score: float = Field(0.0, description="Score d'hallucination moyen")
    average_response_match_score: float = Field(0.0, description="Score de correspondance moyen")


class TrajectoryMatchSummary(BaseModel):
    """Résumé des résultats Trajectory Match."""
    passed_tests: int = Field(0, description="Nombre de tests réussis")
    failed_tests: int = Field(0, description="Nombre de tests échoués")
    total_tests: int = Field(0, description="Nombre total de tests")
    success_rate: float = Field(0.0, description="Taux de réussite en pourcentage")
    mode: str = Field(..., description="Mode de comparaison utilisé")


class LLMJudgeSummary(BaseModel):
    """Résumé des résultats LLM-as-Judge."""
    passed_tests: int = Field(0, description="Nombre de tests réussis")
    failed_tests: int = Field(0, description="Nombre de tests échoués")
    total_tests: int = Field(0, description="Nombre total de tests")
    success_rate: float = Field(0.0, description="Taux de réussite en pourcentage")
    average_score: float = Field(0.0, description="Score moyen")
    model: str = Field(..., description="Modèle utilisé pour le jugement")
    threshold: float = Field(..., description="Seuil de réussite")


class EvaluationSummary(BaseModel):
    """Résumé complet de l'évaluation."""
    overall: EvaluationSummaryMetrics
    trajectory_match: TrajectoryMatchSummary
    llm_judge: LLMJudgeSummary


class EvaluationResult(BaseModel):
    """Résultat complet d'une évaluation d'agent."""
    success: bool = Field(..., description="Indique si l'évaluation s'est terminée avec succès")
    agent_name: str = Field(..., description="Nom de l'agent évalué")
    total_tests: int = Field(..., description="Nombre total de tests")
    score: float = Field(0.0, description="Score global (généralement le success rate)")
    summary: Optional[EvaluationSummary] = Field(None, description="Résumé des résultats")
    detailed_results: Optional[list[TestResult]] = Field(None, description="Deprecated: use details instead")
    details: list[TestResult] = Field(..., description="Résultats détaillés par test case")
    evaluation_id: Optional[str] = Field(None, description="ID de l'évaluation sauvegardée")
    error: Optional[str] = Field(None, description="Message d'erreur global si applicable")
