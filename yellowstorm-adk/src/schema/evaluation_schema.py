from typing import List, Optional

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
