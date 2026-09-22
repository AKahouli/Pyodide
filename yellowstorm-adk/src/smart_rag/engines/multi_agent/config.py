"""
Configuration module for the agentic RAG system.

Includes constants, tool descriptions, and the AgentTeamConfig dataclass.

"""


from dataclasses import dataclass
from typing import Optional, List, Dict

# Constants
DEFAULT_AGENT_NAME = "agent"
DELEGATE_FUNCTION_PREFIX = "delegate_to_"
MANAGER_AGENT_NAME = "manager_agent"
SYSTEM_AGENT_NAME = "system"
SUGGESTIONS_CONTENT_TYPE = "suggestions"
FINAL_RESPONSE_CONTENT_TYPE = "final_response"
ERROR_MESSAGE_TYPE = "error"
NO_STREAMING_MESSAGE_TYPE = "no-streaming"
END_OF_MESSAGE = "end_of_message"
MAX_CONTEXT_ITEMS = 10
FUNCTION_NAME_PATTERN = r'[^a-zA-Z0-9_.-]'
AGENT_MENTION_PATTERN = r"(?:^|\s)@([a-zA-Z_][a-zA-Z0-9_-]*)"

# Tool descriptions
TOOL_DESCRIPTIONS = {
    "calculator": """
**Calculator Tool**: Use for mathematical calculations, arithmetic operations, and numerical analysis.
- Supports: +, -, *, /, **, %, sqrt(), and basic expressions
- When to use: Any time you need to perform calculations, analyze numbers, or compute mathematical results
- Example: calculator(expression="2 + 2 * 3")""",

    "search": """
**Document Search Tool**: Search through the user's uploaded documents and knowledge base.
- Searches internal documents, files, and personal knowledge base
- When to use: When you need information from the user's documents or uploaded content
- Use descriptive queries, avoid file names or specific references
- Example: search(query="quarterly sales data")""",

    "search_web": """
**Web Search Tool**: Search the internet for current information and external resources.
- Access to real-time data, news, current events, and external information
- When to use: When you need current information not available in user documents
- For external research, fact-checking, or up-to-date information
- Example: search_web(query="latest market trends 2024")""",

    "in_memory": """
**In-Memory Document Tool**: Extract specific content from uploaded files when precise information is needed.
- Direct access to specific files and documents
- When to use: When you need exact content from specific documents
- For precise extraction and detailed document analysis
- Example: extract_from_document(file="report.pdf", query="financial summary")""",

    "html_visualization": """
**HTML Diagram Tool**: Create interactive HTML diagrams and visualizations.
- Generates clean, responsive HTML/CSS diagrams
- When to use: For creating flowcharts, process diagrams, organizational charts
- Example: Create a flowchart showing the user authentication process""",

    "render_chart": """
**Chart Rendering Tool**: Create visual charts for data analysis.
- Supports: line, bar, area, pie, scatter, composed charts
- When to use: When displaying data trends, comparisons, or distributions
- Example: render_chart(kind="line", xAxisKey="month", data=[{"month": "Jan", "sales": 100}])"""
}


@dataclass
class AgentTeamConfig:
    """
    Configuration dataclass for agent team setup and execution.

    This class holds all necessary configuration parameters for initializing
    and managing a team of AI agents, including session details, document
    trees, and search parameters.

    Attributes:
        session_id (str): Unique identifier for the agent team session
        user_id (str): Unique identifier for the user requesting the agent team
        chatbot_name (dict): Configuration dictionary specifying the chatbot/LLM provider
        doc_tree (Optional[List]): Hierarchical structure of available documents, defaults to None
        brain_tree (Optional[List]): Tree structure representing knowledge relationships, defaults to None
        brain_ids (Optional[List[str]]): Compatibility alias for workspace_names
        workspace_names (Optional[List[str]]): Workspace names to search, defaults to None
        brain_documents (Optional[List[dict]]): Raw workspace documents with filenames and workspace IDs
        top_k (int): Number of top results to retrieve from searches, defaults to 10
        vectorstore_name (str): Name of the vector database to use, defaults to "default"
        attached_files (Optional[List[dict]]): Documents attached in this turn (being indexed)
        previous_attached_files (Optional[List[dict]]): Already-indexed files from previous turns
        connector_repo (Optional[Dict[str, str]]): Conversation-level repo binding from connector picker
        skills (Optional[List[dict]]): Conversation-level skills selected by the user (applied to every agent)
    """
    session_id: str
    user_id: str
    chatbot_name: dict
    doc_tree: Optional[List] = None
    brain_tree: Optional[List] = None
    brain_ids: Optional[List[str]] = None
    workspace_names: Optional[List[str]] = None
    brain_documents: Optional[List[dict]] = None
    vectorstore_name: str = "default"
    attached_files: Optional[List[dict]] = None
    attached_images: Optional[List[dict]] = None
    previous_attached_files: Optional[List[dict]] = None
    connector_repo: Optional[Dict[str, str]] = None
    skills: Optional[List[dict]] = None
    attachment_context: Optional[str] = None

    def __post_init__(self) -> None:
        if self.brain_ids is None and self.workspace_names is not None:
            self.brain_ids = self.workspace_names
        if self.workspace_names is None and self.brain_ids is not None:
            self.workspace_names = self.brain_ids

