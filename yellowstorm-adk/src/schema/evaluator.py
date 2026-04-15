from pydantic import BaseModel, Field
from src.schema.chatbot_schema import AgentSuggestion
from typing import Union, Optional, List, Dict, Any


class ADKTestCase(BaseModel):
    """Schema for an ADK test case."""

    input: Dict[str, Any] = Field(
        ...,
        description="Test input with messages",
        json_schema_extra={
            "example": {
                "messages": [
                    {
                        "role": "user",
                        "content": "What is the capital of France?"
                    }
                ]
            }
        }
    )
    reference_output: Dict[str, Any] = Field(
        ...,
        description="Expected reference output",
        json_schema_extra={
            "example": {
                "messages": [
                    {
                        "role": "assistant",
                        "content": "The capital of France is Paris."
                    }
                ]
            }
        }
    )


class RunADKEvalRequest(BaseModel):
    """Schema for the ADK evaluation request."""

    agent: AgentSuggestion = Field(
        ...,
        description="Agent configuration to evaluate"
    )
    test_cases: List[ADKTestCase] = Field(
        ...,
        description="Test dataset to use for evaluation"
    )
    trajectory_match_mode: Optional[str] = Field(
        "strict",
        description="Matching mode for Trajectory Match (strict, unordered, subset, superset)"
    )
    session_id: str = Field(
        ...,
        description="Session ID for agent evaluation"
    )
    user_id: str = Field(
        ...,
        description="User ID for agent evaluation"
    )
    threshold: float = Field(
        0.7,
        description="Success threshold (0.0 to 1.0)"
    )
    judge_model: Optional[Dict[str, str]] = Field(
        None,
        description="Model configuration to use as judge (ex: {'name': 'gpt-4', 'provider': 'azure/gpt-4o'})"
    )
    num_runs: int = Field(
        1,
        description="Number of evaluation runs to perform"
    )


class EvaluationScore(BaseModel):
    """Result of an individual evaluation metric."""
    status: str = Field(..., description="Evaluation status (success, failed, error)")
    score: Optional[float] = Field(None, description="Metric score (0.0 to 1.0)")
    reasoning: Optional[str] = Field(None, description="LLM judge reasoning")
    comment: Optional[str] = Field(None, description="Evaluator comment")
    error: Optional[str] = Field(None, description="Error message if applicable")
    full_result: Optional[Dict[str, Any]] = Field(None, description="Full evaluator result")


class TestCaseEvaluations(BaseModel):
    """Complete evaluations for a test case."""
    trajectory_match: EvaluationScore
    llm_judge: EvaluationScore


class TestResult(BaseModel):
    """Detailed result for a test case."""
    test_number: int = Field(..., description="Test number")
    run_index: int = Field(1, description="Run index for multi-run evaluations")
    question: str = Field(..., description="Question asked to the agent")
    reference_answer: str = Field(..., description="Expected reference answer")
    agent_answer: Optional[str] = Field(None, description="Agent response")
    evaluations: Optional[TestCaseEvaluations] = Field(None, description="Evaluation results")
    status: str = Field(..., description="Overall test status (success, failed, error)")
    result: str = Field(..., description="Alias of status for frontend")
    id: str = Field(..., description="Unique ID for React key")
    
    # Internal scores (snake_case)
    semantic_score: Optional[float] = Field(0.0, description="Overall semantic score (0.0 to 100.0)")
    coherence_score: Optional[float] = Field(0.0, description="Coherence score (0.0 to 1.0)")
    hallucination_score: Optional[float] = Field(0.0, description="ADK Hallucination score (0.0 to 1.0)")
    response_match_score: Optional[float] = Field(0.0, description="ADK Response Match score (0.0 to 1.0)")
    
    # Frontend aliases (camelCase)
    semanticScore: Optional[float] = Field(0.0)
    coherenceScore: Optional[float] = Field(0.0)
    hallucinationScore: Optional[float] = Field(0.0)
    responseMatchScore: Optional[float] = Field(0.0)
    error: Optional[str] = Field(None, description="Error message if test failed")


class EvaluationSummaryMetrics(BaseModel):
    """Summary metrics for an evaluation category."""
    success_tests: int = 0
    failed_tests: int = 0
    error_tests: int = 0
    total_tests: int = 0
    success_rate: float = 0.0
    average_semantic_score: float = 0.0
    average_coherence_score: float = 0.0
    average_hallucination_score: float = 0.0
    average_response_match_score: float = 0.0


class TrajectoryMatchSummary(BaseModel):
    passed_tests: int = 0
    failed_tests: int = 0
    total_tests: int = 0
    success_rate: float = 0.0
    mode: str


class LLMJudgeSummary(BaseModel):
    passed_tests: int = 0
    failed_tests: int = 0
    total_tests: int = 0
    success_rate: float = 0.0
    average_score: float = 0.0
    model: str
    threshold: float


class EvaluationSummary(BaseModel):
    overall: EvaluationSummaryMetrics
    trajectory_match: TrajectoryMatchSummary
    llm_judge: LLMJudgeSummary


class EvaluationResult(BaseModel):
    """Complete result of an agent evaluation session."""
    success: bool
    agent_name: str
    total_tests: int
    score: float = 0.0
    summary: Optional[EvaluationSummary] = None
    details: List[TestResult]
    evaluation_id: Optional[str] = None
    error: Optional[str] = None
