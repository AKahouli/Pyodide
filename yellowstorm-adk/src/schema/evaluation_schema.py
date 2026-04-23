from typing import List, Optional, Dict

from pydantic import BaseModel, Field


class SemanticMatchRequest(BaseModel):
    baseline_output: str = Field(..., min_length=1, description="Validated baseline output text.")
    current_output: str = Field(..., min_length=1, description="Newly generated task output text.")
    task_title: Optional[str] = Field(default=None, description="Task title for evaluation context.")
    task_description: Optional[str] = Field(default=None, description="Task description for evaluation context.")
    baseline_tool_summaries: List[str] = Field(default_factory=list, description="Optional baseline tool summaries.")
    current_tool_summaries: List[str] = Field(default_factory=list, description="Optional current tool summaries.")


class SemanticMatchResponse(BaseModel):
    match_score: int = Field(..., ge=0, le=100)
    semantic_similarity_score: int = Field(..., ge=0, le=100)
    evidence_consistency_score: int = Field(..., ge=0, le=100)
    judge_score: int = Field(..., ge=0, le=100)
    reason: str = Field(default="")
    missing_points: List[str] = Field(default_factory=list)
    changed_points: List[str] = Field(default_factory=list)
    model: str = Field(default="")
    judge_used: bool = Field(default=False)


from src.schema.chatbot_schema import AgentSuggestion


class EvaluationItem(BaseModel):
    question: str = Field(..., min_length=1)
    reference_answer: str = Field(..., min_length=1)


class EvaluationBatchRequest(BaseModel):
    agent_id: str = Field(..., description="ID of the agent to evaluate")
    agent_config: AgentSuggestion = Field(..., description="Full configuration of the agent")
    dataset: List[EvaluationItem] = Field(..., min_length=1)
    num_runs: int = Field(default=1, ge=1, le=10)
    mode: str = Field(default="non_strict", pattern="^(strict|non_strict)$")
    scenario_name: Optional[str] = Field(default="Default Scenario")
    judge_model: Optional[Dict[str, str]] = None


class MetricResult(BaseModel):
    score: float = Field(default=0.0)
    reasoning: Optional[str] = Field(default=None)


class EvaluationIterationResult(BaseModel):
    iteration_index: int = Field(..., alias="iterationIndex")
    response_match_score: MetricResult = Field(..., alias="responseMatchScore")
    final_response_match_v2: MetricResult = Field(..., alias="finalResponseMatchV2")
    hallucinations_v1: MetricResult = Field(..., alias="hallucinationsV1")
    timestamp: str

    class Config:
        populate_by_name = True


class EvaluationBatchResponse(BaseModel):
    evaluation_id: str
    status: str = Field(default="queued")
