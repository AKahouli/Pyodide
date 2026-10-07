from pathlib import Path


def _repo_root() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / "YellowStorm").exists() and (parent / "yellowstorm-adk").exists():
            return parent
    raise AssertionError("Repository root not found for proto drift test")


def _normalized_text(path: Path) -> str:
    return path.read_text(encoding="utf-8").replace("\r\n", "\n").strip()


def test_playbook_flow_proto_matches_backend_copy():
    repo_root = _repo_root()
    backend_proto = repo_root / "YellowStorm" / "back" / "src" / "modules" / "playbook-flow" / "proto" / "playbook-flow.proto"
    adk_proto = repo_root / "yellowstorm-adk" / "grpc" / "proto" / "playbook-flow.proto"

    assert _normalized_text(adk_proto) == _normalized_text(backend_proto)


def test_generated_playbook_grpc_module_imports():
    from src.grpc_generated import playbook_flow_pb2_grpc  # noqa: F401
