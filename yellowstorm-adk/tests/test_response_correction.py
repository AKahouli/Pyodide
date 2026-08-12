import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from src.evaluation.response_corrector import ResponseCorrector
from src.schema.response_correction import ResponseCorrectionRequest


def request_fixture(**updates) -> ResponseCorrectionRequest:
    data = {
        "requestId": "request-1",
        "messageId": "message-1",
        "attemptNumber": 1,
        "question": "What is revenue?",
        "originalSegments": [{"componentId": "text-1", "text": "Revenue was 20."}],
        "instructions": [{
            "claim": "Revenue was 20.", "action": "replace", "importance": "critical",
            "reason": "Evidence conflicts", "allowedEvidenceIds": ["evidence-0"],
        }],
        "evidence": [{"id": "evidence-0", "type": "document", "content": "Revenue was 10."}],
        "judgeModel": "judge-model",
    }
    data.update(updates)
    return ResponseCorrectionRequest(**data)


def completion_response(content: str) -> AsyncMock:
    response = AsyncMock()
    response.choices = [AsyncMock()]
    response.choices[0].message.content = content
    return response


VALID = {
    "correctedSegments": [{"text": "Revenue was 10.", "evidenceIds": ["evidence-0"]}],
    "appliedCorrections": [{
        "claim": "Revenue was 20.", "action": "replaced",
        "explanation": "Aligned with evidence.", "evidenceIds": ["evidence-0"],
    }],
    "remainingUncertainties": [],
}


@pytest.mark.asyncio
async def test_returns_valid_correction_without_score():
    with patch("src.evaluation.response_corrector.get_settings", return_value=SimpleNamespace(
        LITELLM_API_BASE_URL="http://litellm-proxy",
        LITELLM_API_SECRET_KEY="proxy-key",
    )), patch("src.evaluation.response_corrector.acompletion", new=AsyncMock(return_value=completion_response(json.dumps(VALID)))) as completion:
        result = await ResponseCorrector().correct(request_fixture())
    assert result.correctorVersion == "response-corrector-v1"
    assert not hasattr(result, "score")
    assert completion.await_args.kwargs["temperature"] == 0
    assert completion.await_args.kwargs["api_base"] == "http://litellm-proxy"
    assert completion.await_args.kwargs["api_key"] == "proxy-key"
    assert '"removed | qualified | replaced | citation_repaired"' in completion.await_args.kwargs["messages"][0]["content"]


@pytest.mark.asyncio
async def test_normalizes_instruction_action_alias_without_repair():
    aliased = {
        **VALID,
        "appliedCorrections": [{**VALID["appliedCorrections"][0], "action": "replace"}],
    }
    completion = AsyncMock(return_value=completion_response(json.dumps(aliased)))
    with patch("src.evaluation.response_corrector.acompletion", new=completion):
        result = await ResponseCorrector().correct(request_fixture())
    assert result.appliedCorrections[0].action == "replaced"
    assert completion.await_count == 1


@pytest.mark.asyncio
async def test_rejects_unknown_evidence_id():
    invalid = {**VALID, "correctedSegments": [{"text": "Revenue was 10.", "evidenceIds": ["unknown"]}]}
    with patch("src.evaluation.response_corrector.acompletion", new=AsyncMock(return_value=completion_response(json.dumps(invalid)))) as completion:
        with pytest.raises(ValueError, match="unknown_evidence_id"):
            await ResponseCorrector().correct(request_fixture())
    assert completion.await_count == 2


@pytest.mark.asyncio
async def test_repairs_semantically_invalid_output_once():
    invalid = {**VALID, "correctedSegments": [{"text": "Revenue was 10.", "evidenceIds": ["unknown"]}]}
    completion = AsyncMock(side_effect=[completion_response(json.dumps(invalid)), completion_response(json.dumps(VALID))])
    with patch("src.evaluation.response_corrector.acompletion", new=completion):
        result = await ResponseCorrector().correct(request_fixture())
    assert result.correctedSegments[0].text == "Revenue was 10."
    assert "unknown_evidence_id" in completion.await_args_list[1].kwargs["messages"][-1]["content"]


@pytest.mark.asyncio
async def test_repairs_malformed_json_once_and_fails_second_malformed_response():
    completion = AsyncMock(side_effect=[completion_response("bad"), completion_response(json.dumps(VALID))])
    with patch("src.evaluation.response_corrector.acompletion", new=completion):
        await ResponseCorrector().correct(request_fixture())
    assert completion.await_count == 2

    completion = AsyncMock(side_effect=[completion_response("bad"), completion_response("still bad")])
    with patch("src.evaluation.response_corrector.acompletion", new=completion):
        with pytest.raises(ValueError):
            await ResponseCorrector().correct(request_fixture())


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid_root", [[], "text", None])
async def test_repairs_non_object_json_roots_once(invalid_root):
    completion = AsyncMock(return_value=completion_response(json.dumps(invalid_root)))
    with patch("src.evaluation.response_corrector.acompletion", new=completion):
        with pytest.raises(ValueError, match="invalid_schema"):
            await ResponseCorrector().correct(request_fixture())
    assert completion.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid_corrections", [None, 5])
async def test_repairs_invalid_applied_corrections_type_once(invalid_corrections):
    invalid = {**VALID, "appliedCorrections": invalid_corrections}
    completion = AsyncMock(return_value=completion_response(json.dumps(invalid)))
    with patch("src.evaluation.response_corrector.acompletion", new=completion):
        with pytest.raises(ValueError, match="invalid_schema"):
            await ResponseCorrector().correct(request_fixture())
    assert completion.await_count == 2


@pytest.mark.asyncio
async def test_omit_temperature_applies_to_correction_and_repair():
    completion = AsyncMock(side_effect=[completion_response("bad"), completion_response(json.dumps(VALID))])
    with patch("src.evaluation.response_corrector.acompletion", new=completion):
        await ResponseCorrector().correct(request_fixture(omitTemperature=True))
    assert all("temperature" not in call.kwargs for call in completion.await_args_list)
