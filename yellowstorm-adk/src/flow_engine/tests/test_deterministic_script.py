import pytest

from src.flow_engine.nodes.deterministic_script import (
    DeterministicScriptError,
    run_deterministic_script,
)


def test_run_deterministic_script_returns_dict() -> None:
    script = "def run(inputs: dict) -> dict:\n    return {'value': inputs.get('value', 0) + 1}\n"

    assert run_deterministic_script(script, {"value": 2}) == {"value": 3}


def test_run_deterministic_script_blocks_unsafe_import() -> None:
    script = "import os\ndef run(inputs: dict) -> dict:\n    return inputs\n"

    with pytest.raises(DeterministicScriptError, match="Blocked import"):
        run_deterministic_script(script, {})


def test_run_deterministic_script_requires_dict_output() -> None:
    script = "def run(inputs: dict) -> dict:\n    return 'bad'\n"

    with pytest.raises(DeterministicScriptError, match="return a dict"):
        run_deterministic_script(script, {})
