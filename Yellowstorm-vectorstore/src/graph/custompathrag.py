from src.PathRAG import PathRAG,QueryParam
import asyncio
import numpy as np
from src.PathRAG.operate import _build_query_context
from openai import AsyncOpenAI
from src.PathRAG.prompt import PROMPTS
import json
import re

from src.config.settings import get_settings
from src.middleware.correlation import get_user


class CustomPathRAG(PathRAG):

    async def aextract_keywords(self, query: str, query_param: QueryParam):
        """
        Extracts keywords using the internal LLM model function.
        """
        use_model_func = self.llm_model_func
        examples = "\n".join(PROMPTS["keywords_extraction_examples"])
        language = self.addon_params.get("language", PROMPTS["DEFAULT_LANGUAGE"])

        # Create the keyword extraction prompt
        kw_prompt = PROMPTS["keywords_extraction"].format(
            query=query, examples=examples, language=language
        )

        # Execute the LLM function to extract keywords
        result = await use_model_func(kw_prompt, keyword_extraction=True)

        # Parse the keyword extraction result
        match = re.search(r"\{.*\}", result, re.DOTALL)
        if match:
            try:
                result = json.loads(match.group(0))
                hl_keywords = result.get("high_level_keywords", [])
                ll_keywords = result.get("low_level_keywords", [])
                return hl_keywords, ll_keywords
            except json.JSONDecodeError as e:
                print(f"JSON parsing error: {e}")

        return [], []

    async def aretrieve_context_with_keywords(self, query: str, param: QueryParam = QueryParam()):
        """
        Extracts keywords and then retrieves context based on these keywords.
        """
        # Extract keywords using the internal logic
        hl_keywords, ll_keywords = await self.aextract_keywords(query, param)
        # If no keywords were extracted, return a warning or handle accordingly
        if not hl_keywords and not ll_keywords:
            print("Warning: No keywords extracted.")
            return None

        # Build context using extracted keywords
        context = await _build_query_context(
            [", ".join(ll_keywords), ", ".join(hl_keywords)],
            self.chunk_entity_relation_graph,
            self.entities_vdb,
            self.relationships_vdb,
            self.text_chunks,
            param,
        )
        return context

    def retrieve_context_with_keywords(self, query: str, param: QueryParam = QueryParam()):
        try:
            loop = asyncio.get_running_loop()
            # If already in an async context, create a task and await it
            task = loop.create_task(self.aretrieve_context_with_keywords(query, param))
            return task  # Return the task, to be awaited by the caller if needed
        except RuntimeError:
            # If no event loop is running, start a new one
            return asyncio.run(self.aretrieve_context_with_keywords(query, param))


async def llm_model_func(
    prompt, system_prompt=None, history_messages=[], keyword_extraction=False, user_id=None, **kwargs
) -> str:
    settings=get_settings()
    client = AsyncOpenAI(
        api_key=settings.LITELLM_API_KEY,
        base_url=settings.LITELLM_BASE_URL,

    )

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    if history_messages:
        messages.extend(history_messages)
    messages.append({"role": "user", "content": prompt})

    # Use provided user_id or fallback to context user
    user = user_id or get_user()
    
    chat_completion = await client.chat.completions.create(
        model="gpt-4o",  # model = "deployment_name".
        messages=messages,
        temperature=kwargs.get("temperature", 0),
        top_p=kwargs.get("top_p", 1),
        n=kwargs.get("n", 1),
        user=user,
    )
    return chat_completion.choices[0].message.content


async def embedding_func(texts: list[str], user_id=None) -> np.ndarray:
    settings=get_settings()
    client = AsyncOpenAI(
        api_key=settings.LITELLM_API_KEY,
        base_url=settings.LITELLM_BASE_URL,

    )
    # Use provided user_id or fallback to context user
    user = user_id or get_user()
    
    embedding = await client.embeddings.create(
        model=settings.EMBEDDING_DEPLOYMENT_NAME,
        input=texts,
        user=user,
    )

    embeddings = [item.embedding for item in embedding.data]
    return np.array(embeddings)


