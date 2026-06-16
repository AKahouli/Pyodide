"""Shared runtime helpers for AgentSkills-style activation."""

from __future__ import annotations

from html import escape
from typing import Any, Dict, List, Optional

from src.logger.logging import get_logger


logger = get_logger("api.skills.runtime")


def _skill_name(skill: Dict[str, Any]) -> str:
    return str(skill.get("name") or "").strip()


def _skill_to_dict(skill: Any) -> Optional[Dict[str, Any]]:
    """Normalize a skill object or mapping to a plain dictionary."""
    if skill is None:
        return None
    if isinstance(skill, dict):
        return skill
    if hasattr(skill, "model_dump"):
        return skill.model_dump()
    if hasattr(skill, "dict"):
        return skill.dict()

    attrs = {}
    for key in ("id", "name", "description", "instructions", "license", "compatibility", "metadata", "allowed_tools", "files"):
        if hasattr(skill, key):
            attrs[key] = getattr(skill, key)
    return attrs or None


def normalize_skills(skills: Optional[List[Any]]) -> List[Dict[str, Any]]:
    """Return a list of normalized skill dictionaries."""
    normalized: List[Dict[str, Any]] = []
    for skill in skills or []:
        skill_dict = _skill_to_dict(skill)
        if skill_dict:
            normalized.append(skill_dict)
    logger.info(
        "Normalized runtime skills: count=%s names=%s",
        len(normalized),
        [_skill_name(skill) or "<missing-name>" for skill in normalized],
    )
    return normalized


def inject_skill_catalog(prompt: str, skills: Optional[List[Any]]) -> str:
    """Append a compact skill catalog to an agent prompt."""
    normalized_skills = normalize_skills(skills)
    if not normalized_skills:
        logger.info("No runtime skills available for prompt catalog injection")
        return prompt

    lines = [
        "<available_skills>",
    ]
    catalog_skill_names = []
    for skill in normalized_skills:
        name = _skill_name(skill)
        description = str(skill.get("description") or "").strip()
        if not name or not description:
            logger.warning(
                "Skipping runtime skill in catalog: id=%s name=%s reason=%s",
                skill.get("id"),
                name or "<missing-name>",
                "missing_name" if not name else "missing_description",
            )
            continue
        catalog_skill_names.append(name)
        lines.extend([
            "  <skill>",
            f"    <name>{escape(name)}</name>",
            f"    <description>{escape(description)}</description>",
            "  </skill>",
        ])
    lines.extend([
        "</available_skills>",
        "When a task matches a skill description, call activate_skill with the skill name before proceeding.",
    ])

    catalog = "\n".join(lines)
    if not catalog.strip():
        return prompt
    logger.info(
        "Injected runtime skill catalog: count=%s names=%s",
        len(catalog_skill_names),
        catalog_skill_names,
    )
    return f"{prompt}\n\n{catalog}" if prompt else catalog


def make_activate_skill_tool(skills: Optional[List[Any]]):
    """Create a lightweight skill activation tool for ADK agents."""
    skill_map = {
        _skill_name(skill): skill
        for skill in normalize_skills(skills)
        if _skill_name(skill)
    }

    if not skill_map:
        logger.info("No runtime skills available for activate_skill tool")
        return None
    logger.info(
        "Created activate_skill tool: count=%s names=%s",
        len(skill_map),
        sorted(skill_map.keys()),
    )

    def activate_skill(name: str) -> str:
        """Load a skill's full instructions by name."""
        skill = skill_map.get((name or "").strip())
        if not skill:
            available = ", ".join(sorted(skill_map.keys()))
            logger.warning(
                "Runtime skill activation failed: requested=%s available=%s",
                name,
                sorted(skill_map.keys()),
            )
            return f"Skill '{name}' is not available. Available skills: {available}"
        logger.info("Runtime skill activated: name=%s id=%s", skill.get("name"), skill.get("id"))

        instructions = str(skill.get("instructions") or "").strip()
        compatibility = str(skill.get("compatibility") or "").strip()
        allowed_tools = skill.get("allowed_tools") or []
        files = skill.get("files") or []

        file_lines = [f"  <file>{file.get('path')}</file>" for file in files if isinstance(file, dict) and file.get("path")]
        file_block = ""
        if file_lines:
            file_block = "\n<skill_resources>\n" + "\n".join(file_lines) + "\n</skill_resources>"

        compatibility_block = f"\nCompatibility: {compatibility}" if compatibility else ""
        tools_block = f"\nAllowed tools: {' '.join(allowed_tools)}" if allowed_tools else ""
        return (
            f"<skill_content name=\"{skill['name']}\">\n"
            f"{instructions}{compatibility_block}{tools_block}{file_block}\n"
            f"</skill_content>"
        )

    activate_skill.__name__ = "activate_skill"
    return activate_skill
