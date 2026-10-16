"""Internal Semantic Model attribute extraction endpoint.

The semantic-model-runtime reaches this through the back end
(/semantic-model/internal/attribute-extraction) to fill the concepts that no
spreadsheet column carries, reading them from document evidence with an LLM.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from src.authentification.get_current_user import get_current_active_user
from src.logger.logging import get_logger
from src.schema.authentification_schema import User
from src.semantic_model.attribute_extractor import AttributeExtractionAgent
from src.semantic_model.node_extractor import ExtractionPartialFailureError

router = APIRouter(prefix="/semantic-model", tags=["semantic-model"])
logger = get_logger("api.routers.semantic_model")


class ExtractAttributeValue(BaseModel):
    key: str = Field(min_length=1, max_length=80)
    label: str | None = Field(default=None, max_length=200)
    description: str = Field(default="", max_length=2000)
    type: str = Field(default="string", max_length=32)


class ExtractAttributeSection(BaseModel):
    sectionPk: str | int
    blockPk: str | int
    content: str = Field(min_length=1, max_length=20_000)


class ExtractAttributeValuesRequest(BaseModel):
    modelId: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    # Optional model override supplied by the admin-managed default agent.
    model: str | None = Field(default=None, max_length=200)
    conceptId: str = Field(min_length=1, max_length=128)
    conceptLabel: str = Field(default="", max_length=200)
    documentId: str = Field(default="", max_length=200)
    fileName: str = Field(default="", max_length=500)
    attributes: list[ExtractAttributeValue] = Field(min_length=1, max_length=50)
    sections: list[ExtractAttributeSection] = Field(min_length=1, max_length=500)
    # True when the mapping reads several records from one document (one per instance found).
    multiple: bool = False


class ExtractAttributeValueResult(BaseModel):
    key: str
    value: Any
    evidenceReferences: list[str]


class ExtractAttributeRecord(BaseModel):
    label: str = ""
    values: list[ExtractAttributeValueResult]


class ExtractAttributeValuesResponse(BaseModel):
    model: str | None = None
    extractorVersion: str
    values: list[ExtractAttributeValueResult]
    failed: list[str]
    records: list[ExtractAttributeRecord] | None = None


@router.post("/attributes/extract", response_model=ExtractAttributeValuesResponse)
def extract_attribute_values(
    request: ExtractAttributeValuesRequest,
    _current_user: Annotated[User, Depends(get_current_active_user)],
) -> ExtractAttributeValuesResponse:
    try:
        result = AttributeExtractionAgent().extract(request.model_dump())
        return ExtractAttributeValuesResponse.model_validate(result)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error
    except Exception as error:
        logger.exception("Attribute extraction failed for model %s", request.modelId)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Attribute extraction failed",
        ) from error
