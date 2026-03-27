"""
Custom tools for  agents.

This module provides custom tool definitions that can be used by  agents
for specific UI generation and interactive functionality.
"""

from typing import List, Dict, Any
from src.logger.logging import get_logger

logger = get_logger("api.smart_rag.manager_tools")


async def generate_form_viz(title: str, button_texts: List[str]) -> Dict[str, Any]:
    """
    Generate an interactive React form with selectable buttons.

    This tool creates an interactive UI with styled buttons that users can select,
    and a submit button that is only enabled when a selection is made. Returns a UI resource
    that can be rendered in the frontend using MCP UI format.

    Args:
        title: The heading text to display at the top of the form
        button_texts: List of text labels for the selectable buttons

    Returns:
        Dict[str, Any]: MCP UI response with React code for rendering

    Example:
        ```python
        ui_response = await generate_form_viz(
            title="Choose your preferred option",
            button_texts=["Option A", "Option B", "Option C"]
        )
        ```
    """

    # Build button elements using React.createElement
    buttons_elements = []
    for i, text in enumerate(button_texts, start=1):
        buttons_elements.append(f"""
    React.createElement(UI.Button, {{
      onClick: () => setSelected({i}),
      variant: selected === {i} ? 'primary' : 'secondary',
      style: {{
        background: selected === {i} ? "#1e293b" : "#334155",
        color: "#f8fafc",
      }}
    }}, '{text}')""")

    buttons_code = ",\n".join(buttons_elements)

    # Generate React code using React.createElement
    react_code = f"""
const [selected, setSelected] = React.useState(null);

return React.createElement(UI.Form, {{
  style: {{ background: "#0f172a", color: "#f8fafc", padding: 24 }}
}},
  React.createElement(UI.Stack, {{ direction: 'column', gap: 20 }},
    React.createElement(UI.Text, {{
      style: {{ color: "#f8fafc", fontSize: 18, marginBottom: 8 }}
    }}, '{title}'),
    {buttons_code},
    React.createElement(UI.Button, {{
      onClick: () => props.onAction(JSON.stringify({{ selected, title: '{title}' }})),
      variant: 'primary',
      style: {{
        background: "#2563eb",
        color: "#f8fafc",
        marginTop: 16,
        opacity: selected ? 1 : 0.5,
        cursor: selected ? "pointer" : "not-allowed"
      }},
      disabled: !selected
    }}, 'Submit')
  )
);
""".strip()

    logger.debug(f"[FORMVIZ] Generated {len(react_code)} bytes of React code")

    try:
        # Generate URI with hash
        uri = f"ui://ui-generator/{hash(title)}"

        # Build resource structure
        resource = {
            '_meta': None,
            'mimeType': 'application/vnd.mcp-ui.remote-dom+javascript; framework=react',
            'text': react_code,
            'uri': uri
        }

        # Build complete MCP UI response structure
        response = {
            'content': [
                {
                    'resource': resource,
                    'type': 'resource'
                }
            ],
            'isError': False,
            'structuredContent': {
                'result': [
                    {
                        '_meta': None,
                        'annotations': None,
                        'resource': resource,
                        'type': 'resource'
                    }
                ]
            }
        }

        return response

    except Exception as e:
        logger.error(f"[FORMVIZ] Error creating MCP UI response: {e}", exc_info=True)
        return {
            'content': [],
            'isError': True,
            'structuredContent': {'result': []}
        }