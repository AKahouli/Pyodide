#!/usr/bin/env python3
"""
Script to generate Python code from protobuf schema.

This script uses grpc_tools.protoc to generate:
  - chatbot_pb2.py: Protobuf message classes
  - chatbot_pb2_grpc.py: gRPC service stubs and servicers

Usage:
    python scripts/generate_proto.py

The generated files will be placed in src/grpc_generated/
"""

import os
import sys
import subprocess
from pathlib import Path

# Get project root directory
SCRIPT_DIR = Path(__file__).parent  # grpc/ folder
PROJECT_ROOT = SCRIPT_DIR.parent      # project root

# Define paths
PROTO_DIR = SCRIPT_DIR / "proto"  # grpc/proto/
OUTPUT_DIR = PROJECT_ROOT / "src" / "grpc_generated"
PROTO_FILE = PROTO_DIR / "chatbot.proto"
# A2A admin management RPCs (imports chatbot.proto for the Agent message).
A2A_ADMIN_PROTO = PROTO_DIR / "a2a_admin.proto"


def main():
    """Generate Python code from protobuf schema."""
    print("=" * 60)
    print("Protobuf Code Generation")
    print("=" * 60)

    # Verify proto file exists
    if not PROTO_FILE.exists():
        print(f"ERROR: Proto file not found: {PROTO_FILE}")
        print("   Please create the proto file first.")
        sys.exit(1)

    print(f"Found proto file: {PROTO_FILE}")

    # Create output directory if it doesn't exist
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Output directory: {OUTPUT_DIR}")

    # Build protoc command
    cmd = [
        sys.executable,
        "-m",
        "grpc_tools.protoc",
        f"--proto_path={PROTO_DIR}",
        f"--python_out={OUTPUT_DIR}",
        f"--grpc_python_out={OUTPUT_DIR}",
        str(PROTO_FILE),
        str(A2A_ADMIN_PROTO),
    ]

    print("\n" + "=" * 60)
    print("Running protoc...")
    print("=" * 60)
    print(f"Command: {' '.join(cmd)}\n")

    try:
        # Run protoc
        result = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
            cwd=PROJECT_ROOT
        )

        print("Protobuf code generation successful!")

        # List generated files
        generated_files = [
            OUTPUT_DIR / "chatbot_pb2.py",
            OUTPUT_DIR / "chatbot_pb2_grpc.py"
        ]

        print("\n" + "=" * 60)
        print("Generated Files:")
        print("=" * 60)
        for file in generated_files:
            if file.exists():
                size = file.stat().st_size
                print(f"OK {file.relative_to(PROJECT_ROOT)} ({size:,} bytes)")
            else:
                print(f"MISSING {file.relative_to(PROJECT_ROOT)}")

        # Fix imports in generated files
        print("\n" + "=" * 60)
        print("Fixing imports in generated files...")
        print("=" * 60)
        fix_imports(OUTPUT_DIR / "chatbot_pb2_grpc.py")
        fix_imports(OUTPUT_DIR / "playbook_flow_pb2_grpc.py")
        fix_imports(OUTPUT_DIR / "a2a_admin_pb2_grpc.py")
        # a2a_admin_pb2.py imports chatbot_pb2 (cross-proto, aliased) — fix it too.
        fix_cross_import(
            OUTPUT_DIR / "a2a_admin_pb2.py",
            "import chatbot_pb2 as chatbot__pb2",
            "from src.grpc_generated import chatbot_pb2 as chatbot__pb2",
        )

        print("\n" + "=" * 60)
        print("All done! gRPC code is ready to use.")
        print("=" * 60)
        print("\nNext steps:")
        print("  1. Install dependencies: pip install -r requirements.txt")
        print("  2. Start the server: python main.py")
        print("  3. gRPC will be available on port 50051")

    except subprocess.CalledProcessError as e:
        print("ERROR: Protoc command failed!")
        print(f"   Return code: {e.returncode}")
        if e.stdout:
            print(f"   stdout: {e.stdout}")
        if e.stderr:
            print(f"   stderr: {e.stderr}")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: {str(e)}")
        sys.exit(1)


def _safe_resolve(pb2_file: Path) -> Path | None:
    """Resolve pb2_file and ensure it lives inside OUTPUT_DIR (prevents path traversal)."""
    resolved = pb2_file.resolve()
    output_root = OUTPUT_DIR.resolve()
    try:
        resolved.relative_to(output_root)
    except ValueError:
        print(f"Warning: Refusing to touch path outside {output_root}: {resolved}")
        return None
    return resolved


def fix_cross_import(pb2_file: Path, old_import: str, new_import: str):
    """Rewrite an aliased cross-proto import in a generated *_pb2.py file."""
    safe_path = _safe_resolve(pb2_file)
    if safe_path is None or not safe_path.exists():
        print(f"Warning: File not found: {pb2_file}")
        return
    content = safe_path.read_text()
    if new_import in content:
        print(f"No import fixes needed in {safe_path.name}")
    elif old_import in content:
        safe_path.write_text(content.replace(old_import, new_import))
        print(f"Fixed cross-proto import in {safe_path.name}")
    else:
        print(f"No import fixes needed in {safe_path.name}")


def fix_imports(grpc_file: Path):
    """
    Fix import statements in generated gRPC file.

    The generated *_pb2_grpc.py has: import foo_pb2
    We need to change it to: from src.grpc_generated import foo_pb2

    Args:
        grpc_file: Path to the generated gRPC file
    """
    safe_path = _safe_resolve(grpc_file)
    if safe_path is None or not safe_path.exists():
        print(f"Warning: File not found: {grpc_file}")
        return

    try:
        content = safe_path.read_text()
        stem = safe_path.stem.replace("_pb2_grpc", "_pb2")
        old_import = f"import {stem}"
        new_import = f"from src.grpc_generated import {stem}"

        if new_import in content:
            print(f"No import fixes needed in {safe_path.name}")
        elif old_import in content:
            content = content.replace(old_import, new_import)
            safe_path.write_text(content)
            print(f"Fixed imports in {safe_path.name}")
        else:
            print(f"No import fixes needed in {safe_path.name}")

    except Exception as e:
        print(f"Warning: Could not fix imports in {grpc_file}: {e}")


if __name__ == "__main__":
    main()
