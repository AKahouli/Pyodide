"""Sandboxed deterministic Python script execution for advisor-approved steps.

Script text arrives over the wire (gRPC snapshot metadata), so the executing
process trusts nothing but the script content itself:

1. Deny-by-default AST allowlist — only a whitelist of pure-transform syntax is
   accepted, every attribute/name starting with ``_`` is rejected, and the
   ``str.format``/``str.format_map`` methods are banned in every position
   (their template language does attribute traversal that is invisible to the
   AST — including when the bound method is aliased or passed as a callback;
   f-strings stay allowed because their expressions are AST-visible).
2. Capability-facade imports — scripts never receive real module objects
   (whose plain attributes leak the interpreter graph: ``typing.sys``,
   ``re.enum``, ``json.decoder.re`` reach ``sys.modules['os']`` and back to
   real builtins). Imports resolve to ``_ModuleFacade`` instances exposing
   only the whitelisted callables in ``_MODULE_FACADES``, and builtins are a
   hand-picked dict.
3. Execution in a disposable spawn subprocess with a wall-clock budget — a
   rejected or runaway script can never hang or crash the API process. The
   result pipe is drained concurrently so large outputs never deadlock, and
   the child carries its own watchdog deadline in case the parent dies hard.

# ponytail: the spawned child inherits os.environ, so an unknown
# interpreter-level escape (not a name-graph one — those are closed by the
# facade) could read env secrets. Upgrade path: env-scrubbed worker, or
# delegate execution to the external sandbox runtimes
# (RUN_CODE_RUNTIME_URL / CODE_INTERPRETER_BACKEND_URL).
"""

from __future__ import annotations

import ast
import importlib
import multiprocessing
import os
import threading
from copy import deepcopy
from typing import Any

DEFAULT_TIMEOUT_SECONDS = 15.0

BLOCKED_NAMES = {
    "eval", "exec", "compile", "open", "__import__", "subprocess", "socket",
    "requests", "httpx", "urllib", "shutil", "pickle", "marshal", "ctypes",
    "getattr", "setattr", "delattr", "vars", "dir", "globals", "locals",
    "type", "super", "breakpoint", "input", "help", "memoryview", "bytearray",
}

# Capability table: the only modules a script can import, and the only names it
# can reach on them. Scripts never receive real module objects (whose plain
# attributes leak the interpreter graph: typing.sys, re.enum, json.decoder.re,
# ...) — _safe_import hands out _ModuleFacade instances instead. Adding a module
# or name here is a deliberate security decision.
_MODULE_FACADES: dict[str, set[str]] = {
    "json": {"dumps", "loads"},
    "re": {"compile", "search", "match", "fullmatch", "sub", "subn", "split",
           "findall", "finditer", "escape"},
    "math": {"ceil", "floor", "fabs", "sqrt", "pow", "log", "log2", "log10",
             "exp", "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
             "degrees", "radians", "factorial", "gcd", "lcm", "isfinite",
             "isinf", "isnan", "fsum", "prod", "dist", "tau", "pi", "e",
             "inf", "nan"},
    "statistics": {"mean", "fmean", "median", "mode", "stdev", "variance",
                   "pstdev", "pvariance", "geometric_mean", "harmonic_mean",
                   "quantiles", "correlation", "covariance"},
    "datetime": {"date", "time", "datetime", "timedelta", "timezone",
                 "MINYEAR", "MAXYEAR"},
    "decimal": {"Decimal", "getcontext", "ROUND_DOWN", "ROUND_UP",
                "ROUND_HALF_UP", "ROUND_HALF_EVEN", "InvalidOperation"},
    "csv": {"reader", "writer", "field_size_limit"},
    "html": {"escape", "unescape"},
    "base64": {"b64encode", "b64decode", "urlsafe_b64encode",
               "urlsafe_b64decode", "b16encode", "b16decode", "b85encode",
               "b85decode"},
    "hashlib": {"md5", "sha1", "sha224", "sha256", "sha384", "sha512", "new"},
    "itertools": {"chain", "combinations", "combinations_with_replacement",
                  "count", "cycle", "groupby", "islice", "permutations",
                  "product", "repeat", "starmap", "takewhile", "dropwhile",
                  "zip_longest", "accumulate"},
    "collections": {"Counter", "defaultdict", "deque", "OrderedDict",
                    "namedtuple", "ChainMap"},
}

ALLOWED_IMPORTS = set(_MODULE_FACADES)

# Attribute loads banned outright: dunders escape the sandbox object graph,
# format templates do getattr/[] traversal hidden inside a string constant.
_BANNED_ATTRIBUTES = {"format", "format_map"}

# Deny-by-default: a script may only use the syntax below. Anything else must be
# added here deliberately after a security look.
_ALLOWED_NODES: tuple[type[ast.AST], ...] = (
    ast.Module, ast.TypeIgnore,
    ast.FunctionDef, ast.arguments, ast.arg, ast.keyword, ast.alias,
    ast.Return, ast.Assign, ast.AugAssign, ast.AnnAssign, ast.Delete,
    ast.Expr, ast.If, ast.For, ast.While, ast.Break, ast.Continue, ast.Pass,
    ast.Try, ast.ExceptHandler, ast.With, ast.withitem, ast.Assert,
    ast.Import, ast.ImportFrom,
    ast.BoolOp, ast.NamedExpr, ast.BinOp, ast.UnaryOp, ast.Lambda, ast.IfExp,
    ast.Dict, ast.Set, ast.ListComp, ast.SetComp, ast.DictComp,
    ast.GeneratorExp, ast.comprehension, ast.Compare, ast.Call,
    ast.FormattedValue, ast.JoinedStr, ast.Constant,
    ast.Attribute, ast.Subscript, ast.Slice, ast.Starred, ast.Name,
    ast.List, ast.Tuple,
    ast.Load, ast.Store, ast.Del,
    ast.And, ast.Or, ast.Not,
    ast.Add, ast.Sub, ast.Mult, ast.MatMult, ast.Div, ast.FloorDiv, ast.Mod,
    ast.Pow, ast.LShift, ast.RShift, ast.BitOr, ast.BitXor, ast.BitAnd,
    ast.Invert, ast.UAdd, ast.USub,
    ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.Is, ast.IsNot,
    ast.In, ast.NotIn,
)


class DeterministicScriptError(ValueError):
    """Raised when an advisor script is unsafe or fails validation."""


def validate_script(script: str) -> None:
    tree = ast.parse(script)
    has_entrypoint = False
    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_NODES):
            raise DeterministicScriptError(f"Unsupported syntax: {type(node).__name__}")
        if isinstance(node, ast.FunctionDef):
            if node.decorator_list:
                raise DeterministicScriptError("Decorators are not allowed")
            if node.name == "run":
                has_entrypoint = True
        if isinstance(node, ast.Name) and node.id.startswith("__"):
            raise DeterministicScriptError(f"Blocked name: {node.id}")
        if isinstance(node, ast.Attribute) and (
            node.attr.startswith("_") or node.attr in _BANNED_ATTRIBUTES
        ):
            raise DeterministicScriptError(f"Blocked attribute: .{node.attr}")
        if isinstance(node, ast.Call):
            name = _call_name(node.func)
            if name in BLOCKED_NAMES or any(name.startswith(f"{blocked}.") for blocked in BLOCKED_NAMES):
                raise DeterministicScriptError(f"Blocked call: {name}")
        if isinstance(node, ast.Import):
            blocked = [
                alias.name.split(".")[0]
                for alias in node.names
                if alias.name.split(".")[0] not in _MODULE_FACADES
            ]
            if blocked:
                raise DeterministicScriptError(f"Blocked import: {blocked[0]}")
        elif isinstance(node, ast.ImportFrom):
            # imported names resolve through the module facade, so only the
            # module root must be allowlisted; relative imports have no facade
            module_root = str(node.module or "").split(".")[0]
            if node.level != 0 or module_root not in _MODULE_FACADES:
                raise DeterministicScriptError(f"Blocked import: {module_root or '.' * (node.level or 1)}")
    if not has_entrypoint:
        raise DeterministicScriptError("Script must define run(inputs: dict) -> dict")


def run_deterministic_script(
    script: str,
    inputs: dict[str, Any],
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    if timeout_seconds <= 0:
        raise DeterministicScriptError("timeout_seconds must be positive")
    validate_script(script)  # fast-fail before paying process startup
    status, payload = _run_isolated(script, inputs, timeout_seconds)
    if status == "error":
        raise payload
    return payload


def _run_isolated(
    script: str,
    inputs: dict[str, Any],
    timeout_seconds: float,
) -> tuple[str, Any]:
    context = multiprocessing.get_context("spawn")
    recv_conn, send_conn = context.Pipe(duplex=False)
    # Child watchdog gets a grace margin so the parent's budget always decides.
    process = context.Process(
        target=_child_entry,
        args=(script, inputs, send_conn, timeout_seconds + 5),
        daemon=True,
    )
    process.start()
    send_conn.close()  # the parent keeps only the read end
    received: list[tuple[str, Any]] = []
    reader = threading.Thread(target=_drain, args=(recv_conn, received), daemon=True)
    reader.start()
    try:
        process.join(timeout_seconds)
        timed_out = process.is_alive()
        if timed_out:
            _kill(process)
        reader.join(5)  # the child is gone, so draining finishes promptly
        if timed_out:
            raise DeterministicScriptError("Deterministic script exceeded its time budget")
        if not received:
            raise DeterministicScriptError(
                f"Deterministic script crashed (exit code {process.exitcode})"
            )
    finally:
        recv_conn.close()
    return received[0]


def _drain(conn: Any, received: list[tuple[str, Any]]) -> None:
    try:
        received.append(conn.recv())
    except (EOFError, OSError):
        pass


def _kill(process: multiprocessing.Process) -> None:
    process.terminate()
    process.join(1)
    if process.is_alive():
        process.kill()
        process.join(1)


def _child_entry(
    script: str,
    inputs: dict[str, Any],
    send_conn: Any,
    deadline_seconds: float,
) -> None:
    watchdog = threading.Timer(deadline_seconds, os._exit, args=(1,))
    watchdog.daemon = True
    watchdog.start()
    try:
        send_conn.send(("ok", _execute(script, inputs)))
    except BaseException as exc:  # sandbox boundary: report the failure, keep the protocol
        send_conn.send(("error", exc))
    finally:
        watchdog.cancel()
        send_conn.close()


def _execute(script: str, inputs: dict[str, Any]) -> dict[str, Any]:
    validate_script(script)
    namespace: dict[str, Any] = {"__builtins__": _safe_builtins()}
    exec(script, namespace, namespace)  # noqa: S102 - allowlist-validated, disposable subprocess
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
        "bytes": bytes,
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
        # exception classes for try/except handlers (raise is not in the DSL)
        "Exception": Exception,
        "ArithmeticError": ArithmeticError,
        "AttributeError": AttributeError,
        "IndexError": IndexError,
        "KeyError": KeyError,
        "LookupError": LookupError,
        "NameError": NameError,
        "RuntimeError": RuntimeError,
        "StopIteration": StopIteration,
        "TypeError": TypeError,
        "ValueError": ValueError,
        "ZeroDivisionError": ZeroDivisionError,
        "__import__": _safe_import,
    }


class _ModuleFacade:
    """Capability-limited stand-in for a stdlib module.

    Exposes exactly the whitelisted names; no module graph, no transitive
    imports, nothing to climb toward sys/os/builtins.
    """

    def __init__(self, name: str, capabilities: dict[str, Any]) -> None:
        self._name = name
        for attr, value in capabilities.items():
            setattr(self, attr, value)


def _safe_import(name: str, globals: Any = None, locals: Any = None, fromlist: tuple[str, ...] = (), level: int = 0) -> Any:
    root = name.split(".")[0]
    if level != 0 or root not in _MODULE_FACADES:
        raise DeterministicScriptError(f"Blocked import: {name}")
    module = importlib.import_module(root)
    return _ModuleFacade(
        root,
        {attr: getattr(module, attr) for attr in sorted(_MODULE_FACADES[root])},
    )
