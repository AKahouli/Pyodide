from typing import Any

from google.adk.tools import ToolContext

from src.config.settings import get_settings
from src.infrastructure.run_code.client import RunCodeClient
from src.infrastructure.run_code.context import parse_run_code_context


RUN_CODE_CODE_DESCRIPTION = (
    "JavaScript async function body executed in QuickJS. Top-level await is allowed. "
    "QuickJS has no module loader or Node APIs. Do not use import, import(), require, or "
    "node:* modules. For workspace "
    "files, use only the injected async fs methods: list, stat, readText, readJson, "
    "writeText, and writeJson. Discover authorized absolute mount paths with "
    "await fs.list('/workspace'); source mounts under /workspace/sources/... are read-only "
    "and /workspace/run is writable. Do not guess a bare filename. You must explicitly "
    "return a JSON-compatible value, for example: return { result, expression }; "
    "A final expression such as ({ result, expression }); is not returned."
)

RUN_CODE_TOOL_DESCRIPTION = (
    "Run bounded JavaScript for small JSON/text transformations, calculations, and small "
    "UTF-8 text/JSON workspace files. QuickJS has no module loader or Node APIs: do not "
    "use import, import(), require, or node:* modules. Use the injected async fs methods "
    "list, stat, readText, readJson, writeText, and writeJson. Start file discovery with "
    "await fs.list('/workspace'), then use the returned absolute paths; source mounts "
    "under /workspace/sources/... are read-only and /workspace/run is writable. Code is "
    "an async function body and must explicitly return a JSON-compatible value. Use "
    "mcp-manus for Python, shell commands, packages, large or binary files, and "
    "resource-heavy work."
)

RUN_CODE_PROMPT_GUIDANCE = """Use run_code for small JavaScript-based JSON/text transformations, control flow,
calculations, and small UTF-8 text/JSON workspace files.

The code argument is an async JavaScript function body. Top-level await is allowed, but
you must explicitly return a JSON-compatible value. Use
`return Object.fromEntries([['result', result], ['expression', expression]]);`, not a
bare final expression such as `result;`.

QuickJS has no module loader or Node APIs. Never use `import`, `import()`, `require`, or
`node:*` modules. Workspace access is provided only through the injected async `fs` object:
`fs.list`, `fs.stat`, `fs.readText`, `fs.readJson`, `fs.writeText`, and `fs.writeJson`.
Discover authorized mounts with `const roots = await fs.list('/workspace');`. The read-only
source mounts are returned under `/workspace/sources/...`; use the absolute paths returned
by `fs.list` instead of guessing a bare attachment filename. `/workspace/run` is writable.

Example for a file at the root of the first source mount:
`const roots = await fs.list('/workspace'); const source = roots.find(e =>
e.path.startsWith('/workspace/sources/')); const files = await fs.list(source.path);
const text = await fs.readText(files.find(e => e.type === 'file').path);
return Object.fromEntries([['text', text]]);`

Use mcp-manus for Python, shell commands, packages, large files, Excel/Parquet,
charts, media, binary files, or resource-heavy work.

If run_code returns a size or resource boundary error, explain that the task needs
mcp-manus. Do not retry run_code with attempts to bypass its limits."""


def run_code_globally_enabled() -> bool:
    settings = get_settings()
    return bool(
        settings.RUN_CODE_ENABLED
        and settings.RUN_CODE_RUNTIME_URL
        and settings.RUN_CODE_RUNTIME_API_KEY
    )


def create_run_code_tool(runtime_context: dict[str, Any]):
    context = parse_run_code_context(runtime_context)
    if not run_code_globally_enabled() or context is None:
        return None
    client = RunCodeClient()

    async def run_code(
        code: str,
        input: Any = None,
        tool_context: ToolContext = None,
    ) -> dict[str, Any]:
        """Run bounded QuickJS JavaScript. There is no module loader or Node APIs: never
        use import, import(), require, or node:*. Use injected async fs methods list, stat,
        readText, readJson, writeText, and writeJson. Discover mounts with
        ``fs.list('/workspace')`` and use returned absolute paths, not a bare attachment
        filename. ``/workspace/sources/...`` is read-only; ``/workspace/run`` is writable.
        Explicitly return JSON. Use mcp-manus for Python, shell, packages, large/binary, or
        resource-heavy work."""
        result = await client.execute(
            code=code,
            input_value=input,
            context=context,
        )
        files = result.get("written_files")
        if tool_context is not None and isinstance(files, list) and files:
            existing = tool_context.state.get("_run_code_written_files", [])
            tool_context.state["_run_code_written_files"] = [*existing, *files]
        return result

    return run_code
