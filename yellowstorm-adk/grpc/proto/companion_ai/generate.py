#!/usr/bin/env python3
"""Generate Python gRPC code for the CompanionAi proto.

Kept separate from grpc/generate_proto.py (the chatbot pipeline) so this feature
is self-contained. Generates flat modules into src/grpc_generated/:

    companion_ai_pb2.py        message classes
    companion_ai_pb2_grpc.py   service stubs + servicer base

Run from anywhere:  python grpc/proto/companion_ai/generate.py
Then restart the gRPC server.

Note: generate with the project's pinned grpcio-tools (see requirements.txt) so
the output matches the runtime grpc version.
"""
import subprocess
import sys
from pathlib import Path

PROTO_DIR = Path(__file__).parent                       # grpc/proto/companion_ai/
PROJECT_ROOT = PROTO_DIR.parents[2]                     # repo root
CHATBOT_PROTO_DIR = PROTO_DIR.parent                    # grpc/proto/ — where chatbot.proto lives
OUTPUT_DIR = PROJECT_ROOT / "src" / "grpc_generated"
PROTO_FILE = PROTO_DIR / "companion_ai.proto"

PB2_MODULE = OUTPUT_DIR / "companion_ai_pb2.py"
GRPC_MODULE = OUTPUT_DIR / "companion_ai_pb2_grpc.py"


def _fix_imports(py_file: Path) -> None:
    """Rewrite generated `import X_pb2` to package-absolute imports, matching
    how the rest of src/grpc_generated is wired."""
    if not py_file.exists():
        return
    text = py_file.read_text()
    fixed = text.replace(
        "import companion_ai_pb2 as companion__ai__pb2",
        "from src.grpc_generated import companion_ai_pb2 as companion__ai__pb2",
    ).replace(
        "import chatbot_pb2 as chatbot__pb2",
        "from src.grpc_generated import chatbot_pb2 as chatbot__pb2",
    )
    if fixed != text:
        py_file.write_text(fixed)
        print(f"fixed imports in {py_file.relative_to(PROJECT_ROOT)}")


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable, "-m", "grpc_tools.protoc",
        f"--proto_path={PROTO_DIR}",           # so the proto's own name is just "companion_ai.proto"
        f"--proto_path={CHATBOT_PROTO_DIR}",   # so `import "chatbot.proto"` resolves
        f"--python_out={OUTPUT_DIR}",
        f"--grpc_python_out={OUTPUT_DIR}",
        str(PROTO_FILE),
    ]
    print("Running:", " ".join(cmd))
    result = subprocess.run(cmd, cwd=PROJECT_ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        print("protoc failed:\n", result.stderr, file=sys.stderr)
        return result.returncode
    _fix_imports(PB2_MODULE)
    _fix_imports(GRPC_MODULE)
    print("OK — generated companion_ai_pb2.py + companion_ai_pb2_grpc.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
