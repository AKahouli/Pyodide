from typing import Literal

from pydantic import BaseModel, Field


class ReliabilityEvidenceItem(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    type: Literal["document", "calculation"]
    parentComponentId: str | None = None
    source: str | None = None
    page: str | None = None
    content: str = Field(min_length=1, max_length=6000)
    workspaceId: str | None = None
    reference: str | None = None


class ReliabilityAnswerSegment(BaseModel):
    componentId: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=30000)
    evidence: list[ReliabilityEvidenceItem] = Field(default_factory=list, max_length=40)


class ResponseReliabilityRequest(BaseModel):
    requestId: str = Field(min_length=1, max_length=200)
    messageId: str = Field(min_length=1, max_length=200)
    question: str = Field(max_length=50000)
    segments: list[ReliabilityAnswerSegment] = Field(min_length=1, max_length=100)
    globalEvidence: list[ReliabilityEvidenceItem] = Field(default_factory=list, max_length=40)
    judgeModel: str = Field(min_length=1, max_length=300)
    maxFindings: int = Field(default=5, ge=1)
    omitTemperature: bool = False


class ReliabilityClaimResult(BaseModel):
    claim: str = Field(min_length=1, max_length=2000)
    status: Literal[
        "supported",
        "partially_supported",
        "unsupported",
        "contradicted",
    ]
    importance: Literal["critical", "major", "minor"]
    explanation: str = Field(min_length=1, max_length=2000)
    evidenceIds: list[str] = Field(default_factory=list, max_length=40)


class ResponseReliabilityResponse(BaseModel):
    applicability: Literal["evaluated", "not_applicable"]
    claims: list[ReliabilityClaimResult] = Field(default_factory=list, max_length=100)
    evaluatorVersion: str
    promptVersion: str
