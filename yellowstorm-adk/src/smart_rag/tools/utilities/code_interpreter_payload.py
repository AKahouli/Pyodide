"""Helpers for building sandbox payloads for the Python interpreter."""

from typing import Dict, List, Optional, Tuple


def _normalize_path(filepath: str) -> str:
    return str(filepath or "").strip().replace("\\", "/")


def _extract_directory(filepath: str) -> str:
    normalized = _normalize_path(filepath)
    if "://" in normalized:
        return ""
    if "/" not in normalized:
        return ""
    directory, _ = normalized.rsplit("/", 1)
    return directory.strip("/")


def _split_segments(path: str) -> List[str]:
    normalized = _normalize_path(path).strip("/")
    if not normalized or "://" in normalized:
        return []
    return [segment for segment in normalized.split("/") if segment]


def _extract_workspace_name_hint(path: str) -> str:
    segments = _split_segments(path)
    if not segments:
        return ""
    return segments[-1]


def _extract_workspace_name_from_filepath(
    filepath: str,
    workspace_id: Optional[str] = None,
    owner_user_id: Optional[str] = None,
) -> str:
    segments = _split_segments(_extract_directory(filepath))
    if not segments:
        return ""

    normalized_owner_user_id = str(owner_user_id or "").strip().strip("/")
    normalized_workspace_id = str(workspace_id or "").strip()
    if (
        normalized_owner_user_id
        and len(segments) >= 2
        and segments[0] == normalized_owner_user_id
    ):
        return segments[1]
    if normalized_workspace_id and segments[0] == normalized_workspace_id:
        return segments[0]
    return segments[0]


def _common_directory(paths: List[str]) -> str:
    directories = [
        _split_segments(path)
        for path in paths
        if _split_segments(path)
    ]
    if not directories:
        return ""

    common_segments = directories[0]
    for segments in directories[1:]:
        shared_length = 0
        for left, right in zip(common_segments, segments):
            if left != right:
                break
            shared_length += 1
        common_segments = common_segments[:shared_length]
        if not common_segments:
            break

    return "/".join(common_segments)


def build_code_interpreter_payload_context(
    files: Optional[List[Dict[str, str]]],
    fallback_workspace_name: Optional[str] = None,
    selected_workspace_id: Optional[str] = None,
    owner_user_id: Optional[str] = None,
) -> Tuple[str, List[str], List[str], List[str]]:
    normalized_files = list(files or [])
    filtered_files: List[Dict[str, str]] = []
    skipped_files: List[str] = []
    mixed_workspace_files: List[str] = []
    explicit_workspace_ids = {
        str(doc.get("workspace_id", "")).strip()
        for doc in normalized_files
        if str(doc.get("workspace_id", "")).strip()
    }

    if not selected_workspace_id and len(explicit_workspace_ids) > 1:
        return "", [], [], [
            str(doc.get("filename", "")).strip()
            for doc in normalized_files
            if str(doc.get("filename", "")).strip()
        ]

    expected_workspace_name = ""
    if selected_workspace_id:
        expected_workspace_names = {
            _extract_workspace_name_hint(str(doc.get("workspace_name", "")).strip())
            or _extract_workspace_name_from_filepath(
                str(doc.get("filepath", "")),
                workspace_id=str(doc.get("workspace_id", "")).strip(),
                owner_user_id=owner_user_id,
            )
            for doc in normalized_files
            if str(doc.get("workspace_id", "")).strip() == str(selected_workspace_id).strip()
        }
        expected_workspace_names.discard("")
        if len(expected_workspace_names) == 1:
            expected_workspace_name = next(iter(expected_workspace_names))

    for doc in normalized_files:
        filename = str(doc.get("filename", "")).strip()
        doc_workspace_id = str(doc.get("workspace_id", "")).strip()
        doc_workspace_name = _extract_workspace_name_hint(
            str(doc.get("workspace_name", "")).strip()
        ) or _extract_workspace_name_from_filepath(
            str(doc.get("filepath", "")),
            workspace_id=doc_workspace_id,
            owner_user_id=owner_user_id,
        )
        if (
            selected_workspace_id
            and doc_workspace_id
            and doc_workspace_id != str(selected_workspace_id).strip()
        ):
            if filename:
                mixed_workspace_files.append(filename)
            continue
        if (
            selected_workspace_id
            and not doc_workspace_id
            and expected_workspace_name
            and doc_workspace_name
            and doc_workspace_name != expected_workspace_name
        ):
            if filename:
                mixed_workspace_files.append(filename)
            continue
        filtered_files.append(doc)

    workspace_name = _common_directory(
        [
            _extract_workspace_name_hint(str(doc.get("workspace_name", "")).strip())
            or _extract_workspace_name_from_filepath(
                str(doc.get("filepath", "")),
                workspace_id=str(doc.get("workspace_id", "")).strip(),
                owner_user_id=owner_user_id,
            )
            for doc in filtered_files
        ]
    ) or _extract_workspace_name_hint(str(fallback_workspace_name or "").strip())
    file_names: List[str] = []
    seen_names = set()

    for doc in filtered_files:
        filepath = _normalize_path(doc.get("filepath", ""))
        filename = str(doc.get("filename", "")).strip()
        if not filename:
            continue

        if not workspace_name:
            skipped_files.append(filename)
            continue
        if filename in seen_names:
            continue

        seen_names.add(filename)
        file_names.append(filename)

    return workspace_name, file_names, skipped_files, mixed_workspace_files
