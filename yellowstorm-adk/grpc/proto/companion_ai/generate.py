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
OUTPUT_DIR = PROJECT_ROOT / "src" / "grpc_generated"
PROTO_FILE = PROTO_DIR / "companion_ai.proto"

GRPC_MODULE = OUTPUT_DIR / "companion_ai_pb2_grpc.py"


def _fix_imports(grpc_file: Path) -> None:
    """Rewrite the flat `import companion_ai_pb2` to a package-absolute import,
    matching how the rest of src/grpc_generated is wired."""
    if not grpc_file.exists():
        return
    text = grpc_file.read_text()
    fixed = text.replace(
        "import companion_ai_pb2 as companion__ai__pb2",
        "from src.grpc_generated import companion_ai_pb2 as companion__ai__pb2",
    )
    if fixed != text:
        grpc_file.write_text(fixed)
        print(f"fixed imports in {grpc_file.relative_to(PROJECT_ROOT)}")


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable, "-m", "grpc_tools.protoc",
        f"--proto_path={PROTO_DIR}",           # so the proto's name is just "companion_ai.proto"
        f"--python_out={OUTPUT_DIR}",
        f"--grpc_python_out={OUTPUT_DIR}",
        str(PROTO_FILE),
    ]
    print("Running:", " ".join(cmd))
    result = subprocess.run(cmd, cwd=PROJECT_ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        print("protoc failed:\n", result.stderr, file=sys.stderr)
        return result.returncode
    _fix_imports(GRPC_MODULE)
    print("OK — generated companion_ai_pb2.py + companion_ai_pb2_grpc.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
