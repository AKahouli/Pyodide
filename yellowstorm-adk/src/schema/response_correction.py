from typing import Literal

from pydantic import BaseModel, Field

from src.schema.response_reliability import ReliabilityEvidenceItem


class CorrectionInstruction(BaseModel):
    claim: str = Field(min_length=1, max_length=2000)
    action: Literal["remove", "qualify", "replace", "repair_citation"]
    importance: Literal["critical", "major", "minor"]
    reason: str = Field(min_length=1, max_length=2000)
    allowedEvidenceIds: list[str] = Field(default_factory=list, max_length=40)


class CorrectionAnswerSegment(BaseModel):
    componentId: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=30000)


class PreviousCandidateSegment(BaseModel):
    text: str = Field(min_length=1, max_length=30000)
    evidenceIds: list[str] = Field(default_factory=list, max_length=40)


class ResponseCorrectionRequest(BaseModel):
    requestId: str = Field(min_length=1, max_length=200)
    messageId: str = Field(min_length=1, max_length=200)
    attemptNumber: int = Field(ge=1, le=3)
    question: str = Field(max_length=50000)
    originalSegments: list[CorrectionAnswerSegment] = Field(min_length=1, max_length=100)
    previousCandidateSegments: list[PreviousCandidateSegment] = Field(default_factory=list, max_length=100)
    instructions: list[CorrectionInstruction] = Field(min_length=1, max_length=100)
    evidence: list[ReliabilityEvidenceItem] = Field(min_length=1, max_length=40)
    judgeModel: str = Field(min_length=1, max_length=300)
    omitTemperature: bool = False


class CorrectedAnswerSegment(BaseModel):
    text: str = Field(min_length=1, max_length=30000)
    evidenceIds: list[str] = Field(default_factory=list, max_length=40)


class AppliedCorrection(BaseModel):
    claim: str = Field(min_length=1, max_length=2000)
    action: Literal["removed", "qualified", "replaced", "citation_repaired"]
    explanation: str = Field(min_length=1, max_length=2000)
    evidenceIds: list[str] = Field(default_factory=list, max_length=40)


class ResponseCorrectionResponse(BaseModel):
    correctedSegments: list[CorrectedAnswerSegment] = Field(min_length=1, max_length=100)
    appliedCorrections: list[AppliedCorrection] = Field(min_length=1, max_length=100)
    remainingUncertainties: list[str] = Field(default_factory=list, max_length=100)
    correctorVersion: str
    promptVersion: str
