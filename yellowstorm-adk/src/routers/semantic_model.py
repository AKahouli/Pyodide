"""Internal Semantic Model ontology generation endpoint."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from src.authentification.get_current_user import get_current_active_user
from src.logger.logging import get_logger
from src.schema.authentification_schema import User
from src.semantic_model.ontology_agent import SemanticModelOntologyAgent
from src.semantic_model.mapping_agent import SemanticModelMappingAgent
from src.semantic_model.graph_builder import SemanticModelGraphBuilder
from src.semantic_model.attribute_extractor import AttributeExtractionAgent
from src.semantic_model.node_extractor import ExtractionPartialFailureError

router = APIRouter(prefix="/semantic-model", tags=["semantic-model"])
logger = get_logger("api.routers.semantic_model")


class GenerateOntologyRequest(BaseModel):
    modelId: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    businessRequirements: list[dict[str, Any]] = Field(default=[], max_length=50)
    graphDesignerCanvas: dict[str, Any]


class GenerateOntologyResponse(BaseModel):
    ontologyDefinition: dict[str, Any]
    ontologyTtl: str


class GenerateMappingPlanRequest(BaseModel):
    modelId: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    graphDesignerCanvas: dict[str, Any]
    searchTasks: list[dict[str, Any]] = Field(max_length=500)
    existingEntities: list[dict[str, Any]] = Field(default=[], max_length=10_000)
    manualInstances: list[dict[str, Any]] = Field(default=[], max_length=100)


class GenerateMappingPlanResponse(BaseModel):
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    mergeGroups: list[dict[str, Any]]


class BuildGraphRequest(BaseModel):
    modelId: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    graphDesignerCanvas: dict[str, Any]
    plan: dict[str, Any]


class BuildGraphResponse(BaseModel):
    graph: dict[str, Any]
    exportPath: str | None = None


@router.post("/ontologies/generate", response_model=GenerateOntologyResponse)
def generate_ontology(
    request: GenerateOntologyRequest,
    _current_user: Annotated[User, Depends(get_current_active_user)],
) -> GenerateOntologyResponse:
    try:
        result = SemanticModelOntologyAgent().generate(request.model_dump())
        return GenerateOntologyResponse.model_validate(result)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error
    except Exception as error:
        logger.exception("Semantic ontology generation failed for model %s", request.modelId)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Semantic ontology generation failed",
        ) from error


@router.post("/graphs/build", response_model=BuildGraphResponse)
def build_graph(
    request: BuildGraphRequest,
    _current_user: Annotated[User, Depends(get_current_active_user)],
) -> BuildGraphResponse:
    try:
        result = SemanticModelGraphBuilder().build(request.model_dump())
        return BuildGraphResponse.model_validate(result)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error
    except Exception as error:
        logger.exception("Semantic graph build failed for model %s", request.modelId)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Semantic graph build failed",
        ) from error


@router.post("/mappings/generate", response_model=GenerateMappingPlanResponse)
def generate_mapping_plan(
    request: GenerateMappingPlanRequest,
    _current_user: Annotated[User, Depends(get_current_active_user)],
) -> GenerateMappingPlanResponse:
    try:
        result = SemanticModelMappingAgent().generate(request.model_dump())
        return GenerateMappingPlanResponse.model_validate(result)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error
    except ExtractionPartialFailureError as error:
        logger.error("Partial extraction failure for model %s: %s", request.modelId, error)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"EXTRACTION_PARTIAL_FAILURE: {error}",
        ) from error
    except Exception as error:
        logger.exception("Semantic mapping generation failed for model %s", request.modelId)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Semantic mapping generation failed",
        ) from error


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
