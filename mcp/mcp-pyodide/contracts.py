from typing import Any, Literal

from typing_extensions import NotRequired, TypedDict


class PyodideExecutionErrorV1(TypedDict):
    code: str
    message: str


class PyodideExecutionInfoV1(TypedDict):
    runtime: Literal["pyodide"]
    pythonVersion: NotRequired[str]
    pyodideVersion: NotRequired[str]
    durationMs: int
    coldStart: bool
    loadedPackages: list[str]


class PyodideExecutionResultV1(TypedDict):
    """Stable result contract shared by the MCP tool and the browser relay."""

    ok: bool
    result: NotRequired[Any]
    stdout: str
    stderr: str
    logsTruncated: NotRequired[bool]
    execution: PyodideExecutionInfoV1
    error: NotRequired[PyodideExecutionErrorV1]


def error_result(code: str, message: str) -> dict[str, Any]:
    return {
        "ok": False,
        "stdout": "",
        "stderr": "",
        "execution": {
            "runtime": "pyodide",
            "durationMs": 0,
            "coldStart": False,
            "loadedPackages": [],
        },
        "error": {"code": code, "message": message},
    }
