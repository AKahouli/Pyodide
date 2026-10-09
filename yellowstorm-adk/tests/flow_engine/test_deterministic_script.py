import pytest

from src.flow_engine.nodes.deterministic_script import (
    DeterministicScriptError,
    run_deterministic_script,
    validate_script,
)

# Escapes that must never execute; each is rejected before any code runs.
ESCAPE_PAYLOADS = [
    # object-graph climb via dunder attributes
    (
        "def run(inputs):\n"
        "    return {'n': len(().__class__.__mro__[1].__subclasses__())}\n",
        "Blocked attribute",
    ),
    # format-string attribute traversal, invisible to the AST — in call position...
    (
        "def run(inputs):\n"
        "    return {'v': '{0.__class__}'.format(inputs)}\n",
        "Blocked attribute: .format",
    ),
    (
        "def run(inputs):\n"
        "    return {'v': '{x}'.format_map(inputs)}\n",
        "Blocked attribute: .format_map",
    ),
    # ...aliased as a bound method (bypasses call-position checks)...
    (
        "def run(inputs):\n"
        "    f = '{0.__class__}'.format\n"
        "    return {'v': f(inputs)}\n",
        "Blocked attribute: .format",
    ),
    # ...or passed as a callback
    (
        "def run(inputs):\n"
        "    template = 'x{0.__class__}'\n"
        "    return {'v': sorted([inputs], key=template.format)[0]}\n",
        "Blocked attribute: .format",
    ),
    # reflection builtins are not provided
    (
        "def run(inputs):\n"
        "    return {'v': getattr(inputs, '__class__')}\n",
        "Blocked call: getattr",
    ),
    # I/O builtins are not provided
    (
        "def run(inputs):\n"
        "    return {'v': open('/etc/passwd').read()}\n",
        "Blocked call: open",
    ),
    # imports outside the pure-computation allowlist
    (
        "import os\n"
        "def run(inputs):\n"
        "    return {'v': os.getcwd()}\n",
        "Blocked import",
    ),
    # typing was removed: its module attributes leak sys/operator (proven
    # exfiltration route) — the whole module is blocked now
    (
        "import typing\n"
        "def run(inputs):\n"
        "    return {'v': typing.sys.modules['os'].environ}\n",
        "Blocked import",
    ),
    # dunder name lookup (e.g. reaching the builtins dict)
    (
        "def run(inputs):\n"
        "    return {'v': list(__builtins__)}\n",
        "Blocked name",
    ),
    # classes/decorators are outside the pure-transform subset
    (
        "class P:\n"
        "    pass\n"
        "def run(inputs):\n"
        "    return {'v': 1}\n",
        "Unsupported syntax",
    ),
    (
        "@staticmethod\n"
        "def run(inputs):\n"
        "    return {'v': 1}\n",
        "Decorators are not allowed",
    ),
]


@pytest.mark.parametrize(("script", "reason"), ESCAPE_PAYLOADS)
def test_run_rejects_escape_payloads(script: str, reason: str) -> None:
    with pytest.raises(DeterministicScriptError, match=reason):
        run_deterministic_script(script, {})


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


def test_run_keeps_supporting_benign_transforms() -> None:
    script = (
        "import re\n"
        "def run(inputs: dict) -> dict:\n"
        "    text = str(inputs.get('text', ''))\n"
        "    words = [w for w in re.split(r'\\s+', text) if w]\n"
        "    try:\n"
        "        label = f'{len(words)} words'\n"
        "    except Exception:\n"
        "        label = 'words'\n"
        "    return {'count': len(words), 'label': label}\n"
    )

    assert run_deterministic_script(script, {"text": "a b  c"}) == {
        "count": 3,
        "label": "3 words",
    }


def test_run_reports_script_runtime_errors() -> None:
    script = "def run(inputs: dict) -> dict:\n    return {'v': inputs['missing'] + 1}\n"

    with pytest.raises(KeyError):
        run_deterministic_script(script, {})


def test_module_facades_hide_the_interpreter_graph() -> None:
    # re is importable, but the facade has no `enum`/`sys`/`functools` —
    # the module-graph escape routes dead-end with AttributeError
    script = (
        "import re\n"
        "def run(inputs):\n"
        "    return {'v': re.enum.sys.modules['os'].environ}\n"
    )

    with pytest.raises(AttributeError):
        run_deterministic_script(script, {})


def test_star_imports_bring_only_whitelisted_names() -> None:
    script = (
        "from re import *\n"
        "def run(inputs):\n"
        "    return {'v': enum}\n"
    )

    with pytest.raises(NameError):
        run_deterministic_script(script, {})


def test_match_object_re_attribute_is_not_the_module() -> None:
    script = (
        "import re\n"
        "def run(inputs):\n"
        "    return {'v': re.search('a', 'a').re.enum.sys.modules['os']}\n"
    )

    with pytest.raises(AttributeError):
        run_deterministic_script(script, {})


def test_run_supports_from_imports_and_exception_handlers() -> None:
    script = (
        "from json import loads\n"
        "def run(inputs: dict) -> dict:\n"
        "    try:\n"
        "        parsed = loads(inputs['payload'])\n"
        "    except ValueError as exc:\n"
        "        return {'ok': False, 'error': str(exc)}\n"
        "    return {'ok': True, 'value': parsed}\n"
    )

    assert run_deterministic_script(script, {"payload": '{"n": 2}'}) == {"ok": True, "value": {"n": 2}}
    broken = run_deterministic_script(script, {"payload": "{oops"})
    assert broken["ok"] is False


def test_run_kills_runaway_script() -> None:
    script = "def run(inputs: dict) -> dict:\n    while True:\n        pass\n    return {}\n"

    with pytest.raises(DeterministicScriptError, match="time budget"):
        run_deterministic_script(script, {}, timeout_seconds=3)


def test_run_rejects_non_positive_timeout() -> None:
    script = "def run(inputs: dict) -> dict:\n    return {}\n"

    with pytest.raises(DeterministicScriptError, match="timeout_seconds"):
        run_deterministic_script(script, {}, timeout_seconds=0)


def test_run_delivers_results_larger_than_the_pipe_buffer() -> None:
    script = "def run(inputs: dict) -> dict:\n    return {'blob': 'x' * 100_000}\n"

    result = run_deterministic_script(script, {})

    assert len(result["blob"]) == 100_000


def test_validate_script_rejects_mro_climb() -> None:
    script = "def run(inputs):\n    return {'n': len(().__class__.__mro__[1].__subclasses__())}\n"

    with pytest.raises(DeterministicScriptError, match="Blocked attribute"):
        validate_script(script)
