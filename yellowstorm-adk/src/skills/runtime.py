"""Shared runtime helpers for AgentSkills-style activation."""

from __future__ import annotations

from typing import Any, Dict, List, Optional


def inject_skill_catalog(prompt: str, skills: Optional[List[Dict[str, Any]]]) -> str:
    """Append a compact skill catalog to an agent prompt."""
    if not skills:
        return prompt

    lines = [
        "<available_skills>",
    ]
    for skill in skills:
        if not isinstance(skill, dict):
            continue
        name = str(skill.get("name") or "").strip()
        description = str(skill.get("description") or "").strip()
        if not name or not description:
            continue
        lines.extend([
            "  <skill>",
            f"    <name>{name}</name>",
            f"    <description>{description}</description>",
            "  </skill>",
        ])
    lines.extend([
        "</available_skills>",
        "When a task matches a skill description, call activate_skill with the skill name before proceeding.",
    ])

    catalog = "\n".join(lines)
    if not catalog.strip():
        return prompt
    return f"{prompt}\n\n{catalog}" if prompt else catalog


def make_activate_skill_tool(skills: Optional[List[Dict[str, Any]]]):
    """Create a lightweight skill activation tool for ADK agents."""
    skill_map = {
        str(skill.get("name") or "").strip(): skill
        for skill in (skills or [])
        if isinstance(skill, dict) and str(skill.get("name") or "").strip()
    }

    if not skill_map:
        return None

    def activate_skill(name: str) -> str:
        """Load a skill's full instructions by name."""
        skill = skill_map.get((name or "").strip())
        if not skill:
            available = ", ".join(sorted(skill_map.keys()))
            return f"Skill '{name}' is not available. Available skills: {available}"

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
