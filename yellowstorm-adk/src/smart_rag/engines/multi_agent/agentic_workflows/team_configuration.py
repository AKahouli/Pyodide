"""
Module for configuring and initializing a multi-agent team.

This module provides functions to set up dependencies, create team configurations,
and instantiate the multi-agent team for processing user requests.
"""



from typing import Dict, Any, Set

from src.schema.chatbot_schema import RunAgentTeamRequest
from src.smart_rag.agents.core import AgentRunner
from src.smart_rag.agents.factories import AgentFactory
from src.smart_rag.engines.multi_agent.config import AgentTeamConfig
from src.smart_rag.engines.multi_agent.team_orchestrator import AutoAgentGenerationTeam
from src.smart_rag.engines.traditional import EventExtractor
from src.smart_rag.infrastructure.factories import LLMFactory
from src.smart_rag.infrastructure.processing import PromptProcessor
from src.smart_rag.messaging import StreamingFormatter, MessageTransformer
from src.smart_rag.tools import build_tree
from src.skills.runtime import normalize_skills
from src.logger.logging import get_logger

logger = get_logger("api.smart_rag.engines.multi_agent.agentic_workflows.team_configuration")


def initialize_dependencies() -> Dict[str, Any]:
    """Initialize all required dependencies.
    Returns a dictionary of initialized components.

    Returns:
        Dict[str, Any]: A dictionary containing initialized components.
        compponents include:
            - prompt_processor: Instance of PromptProcessor for handling prompts
            - llm_factory: Instance of LLMFactory for creating LLM instances
            - agent_factory: Instance of AgentFactory for creating agents
            - streaming_formatter: Instance of StreamingFormatter for formatting streaming responses
            - event_extractor: Instance of EventExtractor for extracting events
            - agent_runner: Instance of AgentRunner for running agents

    """
    prompt_processor = PromptProcessor()
    llm_factory = LLMFactory()
    agent_factory = AgentFactory(prompt_processor, llm_factory)
    streaming_formatter = StreamingFormatter()
    event_extractor = EventExtractor()
    agent_runner = AgentRunner(
        EventExtractor(), MessageTransformer(),
        StreamingFormatter(), prompt_processor
    )

    return {
        'prompt_processor': prompt_processor,
        'llm_factory': llm_factory,
        'agent_factory': agent_factory,
        'streaming_formatter': streaming_formatter,
        'event_extractor': event_extractor,
        'agent_runner': agent_runner
    }


def _merge_attached_files_into_brain_documents(user_request: RunAgentTeamRequest) -> None:
    """Merge attached_files and previous_attached_files into brain_documents.

    This ensures the Code Interpreter (and any other consumer of brain_documents)
    can access files that were attached in the conversation.
    Deduplicates by document _id to avoid adding files already present.
    """
    if not user_request.brain_documents:
        user_request.brain_documents = []

    existing_ids: Set[str] = set()
    for doc in user_request.brain_documents:
        if isinstance(doc, dict):
            doc_id = doc.get('id') or doc.get('_id') or doc.get('document_id')
            if doc_id:
                existing_ids.add(doc_id)

    added = 0
    all_attached = (user_request.attached_files or []) + (user_request.previous_attached_files or [])
    for file_doc in all_attached:
        if not isinstance(file_doc, dict):
            continue
        doc_id = file_doc.get('id') or file_doc.get('_id') or file_doc.get('document_id')
        if not doc_id:
            continue
        if not (file_doc.get('filepath') and file_doc.get('filename')):
            continue
        if doc_id in existing_ids:
            continue
        user_request.brain_documents.append(file_doc)
        existing_ids.add(doc_id)
        added += 1

    if added:
        logger.info(f"Merged {added} attached file(s) into brain_documents")


def create_team_config(user_request: RunAgentTeamRequest) -> AgentTeamConfig:
    """Create team configuration from user request.

    Args:
        user_request (RunAgentTeamRequest): The user request containing configuration details.
    Returns:
        AgentTeamConfig: The configuration for the agent team.
    """
    _merge_attached_files_into_brain_documents(user_request)

    documents_tree, brain_tree = build_tree(user_request.brain_documents, user_request.brain_relations)

    return AgentTeamConfig(
        session_id=user_request.session_id,
        user_id=user_request.user_id,
        chatbot_name=user_request.chatbot_name,
        doc_tree=documents_tree,
        brain_tree=brain_tree,
        brain_ids=user_request.brain_ids or [],
        brain_documents=user_request.brain_documents,
        vectorstore_name=user_request.vectorstore_name,
        attached_files=user_request.attached_files,
        attached_images=user_request.attached_images,
        previous_attached_files=user_request.previous_attached_files,
        connector_repo=user_request.connector_repo,
        skills=normalize_skills(user_request.skills),
    )


def create_team(config: AgentTeamConfig, dependencies: Dict[str, Any]) -> AutoAgentGenerationTeam:
    """Create the agent team.
    Args:
        config (AgentTeamConfig): The configuration for the agent team.
        dependencies (Dict[str, Any]): The initialized dependencies.
    Returns:
        AutoAgentGenerationTeam: The created agent team.

    """
    return AutoAgentGenerationTeam(
        config=config,
        prompt_processor=dependencies['prompt_processor'],
        llm_factory=dependencies['llm_factory'],
        agent_factory=dependencies['agent_factory'],
        agent_runner=dependencies['agent_runner'],
        streaming_formatter=dependencies['streaming_formatter'],
        event_extractor=dependencies['event_extractor'],
        chatbot_name=config.chatbot_name
    )
