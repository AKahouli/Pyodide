"""Source authorization, bounded evidence and executable mapping proposals."""

import json

import httpx
import pytest
from pydantic import ValidationError

from app.datasource.asset_delivery import AssetFetchError
from app.datasource.attribute_extraction import AttributeExtractionError
from app.population import document
from app.population import field_discovery as module

SOURCE = {"workspaceId": "a" * 24, "assetId": "b" * 24, "mimeType": "application/pdf",
          "originalName": "untrusted.pdf"}
REQUEST = {"actorUserId": "actor", "sources": [SOURCE],
           "concept": {"id": "contract", "label": "Contract", "description": "One record per loan contract",
                       "attributes": [{"key": "contract_number", "label": "Contract number", "type": "text"}]}}


def sections(text="Contract number: CNT-1\nAmount: 1200"):
    return [{"sectionPk": 1, "blocks": [{"blockPk": 2, "pageNumber": 3, "content": text}]}]


def proposal(**changes):
    return {"key": "contract_number", "label": "Contract number", "type": "text", "sourceField": "Contract number",
            "evidence": [{"documentId": SOURCE["assetId"], "quote": "Contract number: CNT-1"}], **changes}


@pytest.fixture(autouse=True)
def profile(monkeypatch):
    monkeypatch.setenv("SEMANTIC_AI_BASE_URL", "http://gateway.test")
    monkeypatch.setenv("SEMANTIC_AI_API_KEY", "test-secret")
    monkeypatch.setenv("SEMANTIC_AI_MODEL", "test-model")


@pytest.fixture
def indexed(monkeypatch):
    authorized = []

    async def resolve(pool, entry, actor, **kwargs):
        authorized.append((entry["source"]["assetId"], actor))
        return {"current": {**SOURCE, **entry["source"], "originalName": "authoritative.pdf"},
                "candidate": {"documentPk": 42}}

    async def whole(*args):
        return sections(), True

    monkeypatch.setattr(module, "resolve_indexed_document", resolve)
    monkeypatch.setattr(module, "_whole_document", whole)
    return authorized


@pytest.mark.asyncio
@pytest.mark.parametrize("route", ["preview", "suggestions"])
@pytest.mark.parametrize("spoof", [None, "missing", "actor", "model", "document"])
async def test_interactive_routes_require_exact_backend_metadata(monkeypatch, route, spoof):
    from copy import deepcopy
    from types import SimpleNamespace
    from fastapi import HTTPException
    from app.api.population_routes import preview_document_fields, suggest_document_fields

    source = {**SOURCE, "sizeBytes": 123, "indexingStatus": "pending"}
    body = {**REQUEST, "modelId": "model", "sources": [source]}
    body["authorizedMetadata"] = {"actorUserId": "actor", "modelId": "model", "sources": [deepcopy(source)]}
    if route == "preview":
        body.pop("concept")
        body.pop("sources")
        body["entry"] = {"source": source, "fieldMappings": [{"mode": "metadata", "targetAttribute": "name",
                                                             "sourceField": "document_name"}]}
    if spoof == "missing":
        body.pop("authorizedMetadata")
    elif spoof in {"actor", "model"}:
        body["authorizedMetadata"]["actorUserId" if spoof == "actor" else "modelId"] = "other"
    elif spoof == "document":
        body["authorizedMetadata"]["sources"][0]["assetId"] = "c" * 24

    async def capabilities(*args):
        return {"capabilities": {"structure": False}}

    async def never(*args, **kwargs):
        pytest.fail("Interactive requests must not mint task grants or fetch asset metadata")

    monkeypatch.setattr(document, "detect_capabilities", capabilities)
    monkeypatch.setattr(document, "fetch_workspace_asset_metadata", never)
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(index_pool=object())))

    async def invoke():
        if route == "preview":
            return await preview_document_fields(body, request)
        return await suggest_document_fields(module.FieldDiscoveryRequest.model_validate(body), request)

    if spoof:
        with pytest.raises(HTTPException) as error:
            await invoke()
        assert error.value.status_code == 403
    else:
        result = await invoke()
        assert (result["status"] == "index_unavailable" if route == "preview"
                else result["unread"][0]["status"] == "index_unavailable")


async def run(payload, body=None, seen=None):
    def answer(request):
        if seen is not None:
            seen.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {
            "content": json.dumps(payload)}}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(answer)) as client:
        return await module.discover_fields(object(), module.FieldDiscoveryRequest.model_validate(body or REQUEST), client=client)


@pytest.mark.asyncio
async def test_grounded_existing_field_real_rules_metadata_and_ai(indexed):
    seen = []
    result = await run({"suggestions": [proposal(key="Contract Number", label="Duplicate name"),
        proposal(key="filename", label="Filename", sourceField="", metadataField="document_name", evidence=[]),
        proposal(key="amount", label="Amount", type="number", sourceField="Amount",
                 semanticDefinition="Extract the numeric loan amount", evidence=[{
                     "documentId": SOURCE["assetId"], "quote": "Amount: 1200"}])]}, seen=seen)
    assert indexed == [(SOURCE["assetId"], "actor")]
    first, metadata, ai = result["suggestions"]
    assert first["key"] == "contract_number" and first["label"] == "Contract number"
    assert first["mapping"]["extractionStrategy"] == "deterministic"
    assert first["mapping"]["rules"]["labels"] == ["Contract number"]
    assert first["evidence"] == [{"documentId": SOURCE["assetId"], "filename": "authoritative.pdf",
                                  "quote": "Contract number: CNT-1\nAmount: 1200", "page": 3}]
    assert metadata["mapping"]["mode"] == "metadata" and metadata["evidence"][0]["quote"] == "authoritative.pdf"
    assert "extractionStrategy" not in metadata["mapping"]  # Coordinator accepts strategies only for extracted fields.
    assert ai["mapping"]["extractionStrategy"] == "ai" and "rules" not in ai["mapping"]
    assert "numeric loan amount" in ai["mapping"]["semanticDefinition"]
    assert ai["description"] == ai["mapping"]["semanticDefinition"]
    assert first["description"] == "Contract number" and metadata["description"] == "Filename"
    assert result["documentsRead"] == result["documentsRequested"] == 1 and result["truncated"] is False
    prompt = seen[0]["messages"][0]["content"]
    assert "One record per loan contract" in prompt and "untrusted DATA" in prompt


@pytest.mark.asyncio
async def test_reject_fabricated_quotes_documents_and_duplicate_reserved_fields(indexed):
    suggestions = [proposal(evidence=[{"documentId": SOURCE["assetId"], "quote": "invented"}]),
                   proposal(key="missing", evidence=[{"documentId": "other", "quote": "Contract number: CNT-1"}]),
                   proposal(key="source_documents"), proposal(), proposal()]
    result = await run({"suggestions": suggestions})
    assert [field["key"] for field in result["suggestions"]] == ["contract_number"]


@pytest.mark.asyncio
async def test_rules_must_execute_and_be_unambiguous_on_every_sample(indexed, monkeypatch):
    second = {**SOURCE, "assetId": "c" * 24}
    body = {**REQUEST, "sources": [SOURCE, second]}
    count = 0

    async def whole(*args):
        nonlocal count
        count += 1
        return sections("Contract number: CNT-1" if count == 1 else "No matching label"), True

    monkeypatch.setattr(module, "_whole_document", whole)
    result = await run({"suggestions": [proposal()]}, body)
    assert result["suggestions"][0]["mapping"]["extractionStrategy"] == "ai"
    assert result["suggestions"][0]["matchedDocuments"] == 1
    assert len(indexed) == result["documentsRead"] == 2


@pytest.mark.asyncio
async def test_revoked_asset_cannot_be_read_or_sent_to_ai(monkeypatch):
    async def revoked(source, actor):
        assert actor == "actor"
        raise AssetFetchError("workspace_forbidden")

    async def never(*args, **kwargs):
        pytest.fail("Denied document must not be read or sent to gateway")

    monkeypatch.setattr(document, "fetch_workspace_asset_metadata", revoked)
    monkeypatch.setattr(module, "_whole_document", never)
    monkeypatch.setattr(module, "_completion", never)
    result = await module.discover_fields(object(), module.FieldDiscoveryRequest.model_validate(REQUEST))
    assert result == {"documentsRead": 0, "documentsRequested": 1,
                      "unread": [{"assetId": SOURCE["assetId"], "status": "source_unavailable"}],
                      "suggestions": [], "truncated": False}


@pytest.mark.asyncio
async def test_partial_sample_and_duplicate_sources_report_honest_coverage(indexed, monkeypatch):
    async def whole(*args):
        return sections("Contract number: CNT-1\n" + "x" * 40000), False

    monkeypatch.setattr(module, "_whole_document", whole)
    result = await run({"suggestions": [proposal()]}, {**REQUEST, "sources": [SOURCE, SOURCE]})
    assert result["truncated"] is True and result["documentsRequested"] == 1
    assert len(indexed) == 1


@pytest.mark.asyncio
async def test_duplicate_label_outside_sample_cannot_produce_deterministic_mapping(indexed, monkeypatch):
    async def whole(*args):
        # The reader sees the first match; the conflicting value falls beyond the block sample cap.
        return sections("Contract number: CNT-1\n" + "x" * 3000 + "\nContract number: CNT-2"), True

    monkeypatch.setattr(module, "_whole_document", whole)
    result = await run({"suggestions": [proposal()]})
    assert result["truncated"] is True
    mapping = result["suggestions"][0]["mapping"]
    assert mapping["extractionStrategy"] == "ai" and "rules" not in mapping


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", [{"suggestions": "wrong"}, {"suggestions": [proposal(type="code")]},
    {"suggestions": [proposal(rules={"pattern": "arbitrary"})]}, {"suggestions": [None]}])
async def test_malformed_model_output_fails_closed(indexed, payload):
    with pytest.raises(AttributeExtractionError, match="invalid_attribute_extraction_response"):
        await run(payload)


def test_sampling_budget_and_model_input_limits():
    many = [{"sectionPk": index, "blocks": [{"blockPk": index, "pageNumber": index,
             "content": "x" * 4000}]} for index in range(100)]
    sampled, cut = module._sample(many)
    assert cut and len(sampled) <= module.MAX_BLOCKS
    assert sum(len(block["content"]) for block, _ in document._usable_blocks(sampled)) <= module.MAX_DOCUMENT_CHARS
    for changes in ({"sources": [SOURCE] * 6}, {"sources": [{**SOURCE, "assetId": "invalid"}]},
                    {"concept": {**REQUEST["concept"], "attributes": REQUEST["concept"]["attributes"] * 51}}):
        with pytest.raises(ValidationError):
            module.FieldDiscoveryRequest.model_validate({**REQUEST, **changes})


@pytest.mark.asyncio
async def test_route_requires_service_key_and_validated_request(monkeypatch):
    from app.main import create_app

    monkeypatch.setenv("SEMANTIC_RUNTIME_SERVICE_KEY", "service-test")
    app = create_app()
    app.state.index_pool = object()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://runtime") as client:
        route = "/v1/semantic-model-population/document-field-suggestions"
        assert (await client.post(route, json=REQUEST)).status_code == 401
        response = await client.post(route, json={**REQUEST, "sources": [SOURCE] * 6},
                                     headers={"X-Semantic-Service-Key": "service-test"})
        assert response.status_code == 422


@pytest.mark.asyncio
async def test_authenticated_interactive_reads_use_authorized_metadata_without_task(monkeypatch):
    from app.main import create_app
    from app.datasource import asset_delivery

    monkeypatch.setenv("SEMANTIC_RUNTIME_SERVICE_KEY", "service-test")
    monkeypatch.setenv("YELLOWSTORM_BACKEND_URL", "http://backend.test")
    source = {**SOURCE, "sizeBytes": 123, "indexingStatus": "ready"}
    authority = {"actorUserId": "actor", "modelId": "model", "sources": [source]}
    common = {"actorUserId": "actor", "modelId": "model", "authorizedMetadata": authority}
    preview = {**common, "entry": {"source": source, "fieldMappings": [
        {"mode": "metadata", "sourceField": "document_name", "targetAttribute": "name"}]}}
    suggestions = {**REQUEST, **common, "sources": [source]}

    async def capabilities(*args):
        return {"capabilities": {"structure": True}}

    async def candidates(*args, **kwargs):
        return {"resolution": "resolved", "candidates": [{"documentPk": 42}]}

    async def whole(*args):
        return sections(), True

    async def completion(*args, **kwargs):
        return {"suggestions": []}

    monkeypatch.setattr(document, "detect_capabilities", capabilities)
    monkeypatch.setattr(document, "resolve_document_candidates", candidates)
    monkeypatch.setattr(module, "_whole_document", whole)
    monkeypatch.setattr(module, "_completion", completion)
    app = create_app()
    app.state.index_pool = object()
    assert asset_delivery._execution.get() is None
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://runtime") as client:
        for path, body in (("document-preview", preview), ("document-field-suggestions", suggestions)):
            url = f"/v1/semantic-model-population/{path}"
            assert (await client.post(url, json=body)).status_code == 401
            response = await client.post(url, json=body, headers={"X-Semantic-Service-Key": "service-test"})
            assert response.status_code == 200, response.text
            assert (response.json()["status"] == "read" if path == "document-preview"
                    else response.json()["documentsRead"] == 1)
    # Interactive authority never becomes ambient background-job authority.
    assert asset_delivery._execution.get() is None
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: pytest.fail("No network allowed"))) as client:
        monkeypatch.setenv("YELLOWSTORM_BACKEND_URL", "http://backend.test")
        with pytest.raises(RuntimeError, match="asset_execution_authority_missing"):
            await asset_delivery.fetch_workspace_asset_metadata(source, "actor", client=client)
