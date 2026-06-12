"""Safe deterministic Python script execution for advisor-approved steps."""

from __future__ import annotations

import ast
import importlib
from copy import deepcopy
from typing import Any

BLOCKED_NAMES = {
    "eval", "exec", "compile", "open", "__import__", "subprocess", "socket",
    "requests", "httpx", "urllib", "shutil", "pickle", "marshal", "ctypes",
}

ALLOWED_IMPORTS = {
    "json", "re", "math", "statistics", "datetime", "decimal", "csv", "html",
    "base64", "hashlib", "itertools", "collections", "typing",
}


class DeterministicScriptError(ValueError):
    """Raised when an advisor script is unsafe or fails validation."""


def validate_script(script: str) -> None:
    tree = ast.parse(script)
    has_entrypoint = False
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "run":
            has_entrypoint = True
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = [alias.name.split(".")[0] for alias in getattr(node, "names", [])]
            module = getattr(node, "module", None)
            if module:
                names.append(str(module).split(".")[0])
            blocked = [name for name in names if name not in ALLOWED_IMPORTS]
            if blocked:
                raise DeterministicScriptError(f"Blocked import: {blocked[0]}")
        if isinstance(node, ast.Call):
            name = _call_name(node.func)
            if name in BLOCKED_NAMES or any(name.startswith(f"{blocked}.") for blocked in BLOCKED_NAMES):
                raise DeterministicScriptError(f"Blocked call: {name}")
    if not has_entrypoint:
        raise DeterministicScriptError("Script must define run(inputs: dict) -> dict")


def run_deterministic_script(script: str, inputs: dict[str, Any]) -> dict[str, Any]:
    validate_script(script)
    namespace: dict[str, Any] = {"__builtins__": _safe_builtins()}
    exec(script, namespace, namespace)
    entrypoint = namespace.get("run")
    if not callable(entrypoint):
        raise DeterministicScriptError("Script entrypoint is not callable")
    first = entrypoint(deepcopy(inputs))
    second = entrypoint(deepcopy(inputs))
    if first != second:
        raise DeterministicScriptError("Script produced non-deterministic output")
    if not isinstance(first, dict):
        raise DeterministicScriptError("Script must return a dict")
    return first


def _call_name(func: ast.AST) -> str:
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        prefix = _call_name(func.value)
        return f"{prefix}.{func.attr}" if prefix else func.attr
    return ""


def _safe_builtins() -> dict[str, Any]:
    return {
        "abs": abs,
        "all": all,
        "any": any,
        "bool": bool,
        "dict": dict,
        "enumerate": enumerate,
        "float": float,
        "int": int,
        "isinstance": isinstance,
        "len": len,
        "list": list,
        "max": max,
        "min": min,
        "range": range,
        "round": round,
        "set": set,
        "sorted": sorted,
        "str": str,
        "sum": sum,
        "tuple": tuple,
        "__import__": _safe_import,
    }


def _safe_import(name: str, globals: Any = None, locals: Any = None, fromlist: tuple[str, ...] = (), level: int = 0) -> Any:
    root = name.split(".")[0]
    if level != 0 or root not in ALLOWED_IMPORTS:
        raise DeterministicScriptError(f"Blocked import: {name}")
    return importlib.import_module(name)
