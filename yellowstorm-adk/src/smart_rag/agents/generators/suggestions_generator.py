import json
import uuid
from typing import Dict, Any, Optional, List, Literal, Coroutine
from google.adk import Agent, Runner
from google.genai import types
from pydantic import BaseModel, Field

from src.logger.logging import get_logger
from src.smart_rag.agents.generators.suggestions_helper import parse_suggestions_response, \
    model_supports_structured_output
from src.smart_rag.infrastructure.processing import append_suggested_agents, modify_suggested_agents
from src.smart_rag.infrastructure.processing.plugin import CleanSessionPlugin
from src.smart_rag.infrastructure.session import SessionHelper
from src.smart_rag.infrastructure.model_parameters import resolve_model_config
from google.adk.sessions import DatabaseSessionService
from src.config.settings import get_settings
settings=get_settings()
logger = get_logger("api.routers.agentic_rag.AgentSuggestionGenerator")


class AgentSuggestionGenerator:
    """Handles the generation of agent suggestions based on user prompts."""

    def __init__(self, prompt_processor, llm_factory, chatbot_name: str):
        self.prompt_processor = prompt_processor
        self.llm_factory = llm_factory
        self.chatbot_name = resolve_model_config(chatbot_name)

    async def generate_suggestions(self,session_id:str, suggestions_prompt: str, user_prompt: str,available_agents: List,
                                   config, brain_documents: Optional[List] = None,
                                   brain_relations: Optional[Dict] = None) -> tuple[
                                                                                  list[dict[str, Any]] | dict[Any, Any],
                                                                                  dict[str, Any]] | list[Any]:
        """Generate agent suggestions based on the user prompt.

        Args:
            suggestions_prompt (str): The prompt template for generating suggestions.
            user_prompt (str): The user's input prompt.
            config: Configuration object containing user and brain details.
            brain_documents (Optional[List]): Optional list of brain documents to use.
            brain_relations (Optional[Dict]): Optional dict of brain relations to use.
        """
        try:
            agent_id_mapping={f"id{index}":agent for index,agent in enumerate(available_agents)}
            available_agents_str ="<available_agents>" +"\n".join([
                f" agent_name : {agent.name} | agent_description : {agent.description} | agent_tools : {agent.tools} :: {agent_id}  "
                for agent_id, agent in agent_id_mapping.items()
            ]) + "<available_agents>"
            suggestions_prompt=suggestions_prompt.format(available_agents_str=available_agents_str)
            suggestion_agent = self._create_suggestion_agent(suggestions_prompt, user_prompt)
            response = await self._run_suggestion_agent(session_id,suggestion_agent, user_prompt, config)

            return response,agent_id_mapping

        except Exception as e:
            logger.error(f"Error generating agent suggestions: {str(e)}")
            return []

    def _create_suggestion_agent(self, suggestions_prompt: str, user_prompt: str) -> Agent:
        """Create the agent suggestion generator."""
        model = self.llm_factory.create_no_tool_calls_llm(self.chatbot_name)

        # Check if model supports structured output
        supports_structured_output = model_supports_structured_output(self.chatbot_name)
        if False:
            class SuggestionSchema(BaseModel):
                name: str
                description: str
                prompt: str
                tools: Optional[List[Literal["calculator", "search", "search_web", "in_memory"]]] = None

            class SuggestionsResponse(BaseModel):
                suggestions: List[SuggestionSchema] = Field(default=[], description="List of newly suggested agents")
                available_agent_ids: List[str] = Field(default=[],
                                                       description="List of IDs of relevant available agents")

            return Agent(
                name="AgentSuggestionGenerator",
                model=model,
                instruction=suggestions_prompt,
                output_schema=SuggestionsResponse,
                disallow_transfer_to_peers=True,
                disallow_transfer_to_parent=True,
                output_key="suggested_agents",
                before_agent_callback=append_suggested_agents,
                after_agent_callback=modify_suggested_agents
            )
        else:
            # For models that don't support structured output, add JSON format instructions to the prompt
            enhanced_suggestions_prompt = f"""{suggestions_prompt}

    IMPORTANT: You must respond with a valid JSON object in exactly this format:
    {{
        "suggestions": [
            {{
                "name": "agent_name",
                "description": "agent_description", 
                "prompt": "agent_prompt",
                "tools": ["tool1", "tool2"] or null,
            }}
        ],
        "available_agent_ids": ["id1", "id2"] 
    }}

    Do not include any text before or after the JSON. Return only the JSON object."""


            return Agent(
                name="AgentSuggestionGenerator",
                model=model,
                instruction=enhanced_suggestions_prompt,
                disallow_transfer_to_peers=True,
                disallow_transfer_to_parent=True,
                output_key="suggested_agents",
                before_agent_callback=append_suggested_agents
            )

    async def _run_suggestion_agent(self,session_id:str, agent: Agent, user_prompt: str, config) -> list[dict[str, Any]] | dict[
        Any, Any]:
        """Run the suggestion agent and parse results."""
        content = types.Content(role="user", parts=[types.Part(text=user_prompt)])
   #     session_helper = SessionHelper(user_id=config.user_id)
        suggestions_app_name=f"seg-{config.user_id}"
        #session_id = await session_helper.init_session(agent=agent,session_id=suggestions_session_id)



        data_base_session = DatabaseSessionService(db_url=settings.DATABASE_URL)
        exsiting_session = await data_base_session.get_session(app_name=suggestions_app_name,
                                                               user_id=config.user_id, session_id=session_id)


        if not exsiting_session:
            agent_name = getattr(agent, 'name', "unknown") if hasattr(agent, 'name') else "unknown"
            system_prompt = getattr(agent, 'instruction', None) if hasattr(agent,
                                                                                   'instruction') else None
            tools_info_result = []

            state = {"system_prompt": system_prompt, "agent_name": agent_name, "tools_info": tools_info_result}

            await data_base_session.create_session(app_name=suggestions_app_name,
                                                   user_id=config.user_id,
                                                   session_id=session_id, state=state)
        agent_runner = Runner(
                agent=agent,
                app_name=suggestions_app_name,
                session_service=data_base_session,
            )

        async for event in agent_runner.run_async(
                user_id=config.user_id,
                session_id=session_id,
                new_message=content,
        ):
            if not event.content or not event.content.parts:
                continue  # skip empty events safely

            response = event.content.parts[0]
            suggestions = parse_suggestions_response(response)
            if suggestions:
                return suggestions

        return {}
