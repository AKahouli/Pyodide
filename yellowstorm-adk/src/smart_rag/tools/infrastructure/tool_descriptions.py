from typing import List, Union, Dict, Any

from src.smart_rag.engines.multi_agent.config import TOOL_DESCRIPTIONS
from src.smart_rag.tools.utilities.tool_utils import extract_tool_names


class ToolDescriptionProvider:
    """Provides formatted tool descriptions for agents."""

    @staticmethod
    def get_tools_description(tools: Union[List[Union[str, Dict]], List[Dict[str, Any]]]) -> str:
        """Get formatted tool descriptions for inclusion in agent prompts.

        Uses custom descriptions from tool configs if provided, otherwise falls back to defaults.
        """
        if not tools:
            return ""

        descriptions = []

        for tool in tools:
            if isinstance(tool, str):
                # Simple string format - use default description
                if tool in TOOL_DESCRIPTIONS:
                    descriptions.append(TOOL_DESCRIPTIONS[tool])
            elif isinstance(tool, dict):
                # Dictionary format - use custom description if provided
                tool_name = tool.get('name', 'unknown')
                custom_description = tool.get('description')

                if custom_description:
                    # Use custom description with additional info from tool config
                    formatted_desc = f"**{tool_name}**: {custom_description}"

                    # Add configuration details if available
                    config_details = []
                    if 'top_k' in tool and tool['top_k'] != 4:  # Only show if different from default
                        config_details.append(f"top_k: {tool['top_k']}")
                    if 'prompt' in tool and tool['prompt']:
                        config_details.append(f"Additional instructions: {tool['prompt']}")

                    if config_details:
                        formatted_desc += f" ({', '.join(config_details)})"

                    descriptions.append(formatted_desc)

                elif tool_name in TOOL_DESCRIPTIONS:
                    # Use default description but add config info
                    default_desc = TOOL_DESCRIPTIONS[tool_name]

                    # Add configuration details if available
                    config_details = []
                    if 'top_k' in tool and tool['top_k'] != 4:
                        config_details.append(f"configured with top_k: {tool['top_k']}")
                    if 'prompt' in tool and tool['prompt']:
                        config_details.append(f"additional instructions: {tool['prompt']}")

                    if config_details:
                        default_desc += f"\n({', '.join(config_details).capitalize()})"

                    descriptions.append(default_desc)

        if descriptions:
            return (f"\n\n## Available Tools\n"
                    f"You have access to the following tools to help complete your tasks:\n\n"
                    + "\n\n".join(descriptions))
        return ""

    @staticmethod
    def get_source_citation_requirements(tools: Union[List[str], List[Dict[str, Any]]]) -> str:
        """Get source citation requirements based on available tools."""
        if not tools:
            return ""

        # Extract tool names for compatibility checks
        tool_names = extract_tool_names(tools) if tools else []

        requirements = []


        # Document search source requirements
        if "search" in tool_names or "in_memory" in tool_names:
            requirements.append("""
# Document Source Citation Requirements
If you're getting information from document chunks, you **must** indicate in which chunk you found each piece of information in terms of order, and give its respective page number present in the markup <page> using the format "information §text n, page k§"

For example:
Il semblerait que l'évolution en 2019 montre une augmentation de 157% par rapport à 2018, avec un chiffre de 385 869 §text 2, page 3§ (document name, page number)

If you're getting information from images, you **must** indicate in which image you found each piece of information using the filename associated with each image, using the format "information §image imagename§"

For example:
Selon les éléments trouvés, l'évolution en 2019 pourrait montrer une augmentation de 157% par rapport à 2018, avec un chiffre de 385 869 §image 123123b231_148_sub_image_1.png§

- When there are multiple pages "p1-p2", you Must always print two source tags, one for the first page and another for the second page: §text 1, page 1§ (document name, page number), §text 1, page 2§ (document name, page number)
- The source tags must be placed correctly in the answer to be used as a context reference.
- Tu dois placer la source tag à l'endroit exact du texte où le contexte de cette source a servi à générer la réponse.""")

        # Web search source requirements
        if "search_web" in tool_names:
            requirements.append("""
# Web Source Citation Requirements
For web sources: 
Tu dois TOUJOURS indiquer l'URL source utilisée pour chaque recherche en utilisant le format suivant:
🔎 <a href="[URL_COMPLETE]" target="_blank" rel="noopener">[TITRE_DESCRIPTIF]</a>

Bonnes pratiques pour les liens:
* Utiliser un titre descriptif et pertinent pour le lien
* toujours Inclure target="_blank" pour ouvrir dans un nouvel onglet
* Inclure rel="noopener" pour la sécurité
* Placer la source immédiatement après l'information citée""")

        return "\n".join(requirements) if requirements else ""

    @staticmethod
    def get_source_reference_requirements_for_reports() -> str:
        """Get source reference requirements specifically for report writer agents when search agents exist in team."""
        return """
# Citation and Source References:
  Tu dois TOUJOURS indiquer l'URL source utilisée pour chaque recherche en utilisant le format suivant:
🔎 <a href="[URL_COMPLETE]" target="_blank" rel="noopener">[TITRE_DESCRIPTIF]</a>
Bonnes pratiques pour les liens:
*Utiliser un titre descriptif et pertinent pour le lien
*toujours Inclure target="_blank" pour ouvrir dans un nouvel onglet
*Inclure rel="noopener" pour la sécurité
*Placer la source immédiatement après l'information citée

- IMPORTANT: 
  - These citations must be preserved exactly as they appear in the agent's responses
  - Every piece of information from search results must maintain its original citation
  - Place each citation immediately after the specific information it supports
  - Do not change, abbreviate, or reformat any citations
  - NEVER omit the task prefix for text citations - it is required for proper source tracking
  - NEVER use page ranges (e.g., "page 5-6") - use single page numbers only
  - For web sources, always preserve the exact "🔎 [URL]" format with icon and spacing
  - The citation tags must be placed correctly in the answer to be used as a context reference, no need to follow the tag with a return carrier \n.
  - you Must always print two tags one for the first page and another for the second page When there is multiple pages "p1-p2" as following :  §task_<number>§text <text_number>, page 1§, §task_<number>§text <text_number>, page p2§
  - Tu dois placer la source tag à l'endroit exact du texte où le contexte de cette source a servi à générer la réponse."""
