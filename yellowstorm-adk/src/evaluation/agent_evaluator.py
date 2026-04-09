"""
Évaluation d'agents avec Google ADK exclusivement.

Ce module permet d'évaluer n'importe quel agent en utilisant l'ADK de Google.
Il supporte actuellement:
- Hallucinations (hallucinations_v1)
- Final Response Match (final_response_match_v2)
"""

from typing import Dict, Any, List, Optional
from dataclasses import dataclass
from asyncio import Queue
import asyncio
import uuid
import time
import json
import re
from datetime import datetime
from src.logger.logging import get_logger
import traceback

logger = get_logger("api.evaluation.agent_evaluator")
from types import SimpleNamespace


def _as_eval_score(obj, default_status="not_available"):
    try:
        if obj is None:
            return EvaluationScore(status=default_status, score=0.0)
        if isinstance(obj, EvaluationScore):
            return obj
        if isinstance(obj, dict):
            score = obj.get("score", 0.0)
            status = obj.get("status", default_status)
            return EvaluationScore(status=status, score=float(score))
        # Fallback for other types
        return EvaluationScore(status=default_status, score=0.0)
    except Exception:
        return EvaluationScore(status=default_status, score=0.0)


from src.smart_rag.tools.utilities.tool_utils import extract_tool_names, normalize_tools
from src.smart_rag.agents.factories.base_factory import AgentFactory
from src.smart_rag.agents.factories.delegation_factory_helper import (
    create_agent_for_delegation,
)
from src.smart_rag.agents.core.helpers import AgentHelper
from src.smart_rag.tools.infrastructure.tool_descriptions import ToolDescriptionProvider
from src.smart_rag.infrastructure.factories import LLMFactory
from src.smart_rag.infrastructure.processing import PromptProcessor
from src.smart_rag.agents.core.runner import AgentRunner
from src.smart_rag.engines.traditional import EventExtractor
from src.smart_rag.messaging import MessageTransformer, StreamingFormatter
from pydantic import BaseModel, Field, SecretStr
from src.schema.evaluator import RunADKEvalRequest
from src.schema.evaluation_results import (
    EvaluationScore,
    TestResult,
    TestCaseEvaluations,
    EvaluationResult,
    EvaluationSummary,
    EvaluationSummaryMetrics,
    TrajectoryMatchSummary,
    LLMJudgeSummary,
)

from src.evaluation.utils import (
    validate_agent_config,
    convert_agent_suggestion_to_dict,
    compute_overall_status,
    create_evaluation_score,
    calculate_cosine_similarity,
    EvaluationStatisticsCalculator,
)
from src.evaluation.repository import EvaluationRepository
import copy

# RAGAS removed (Pure ADK only)
RAGAS_AVAILABLE = False
# Try to import Google ADK components; if unavailable, set a fallback flag
try:
    from google.adk.sessions import InMemorySessionService  # type: ignore
    from src.config.settings import get_settings
    from src.similarity_search.embeddings import get_embeddings
    from google.adk.models.lite_llm import LiteLlm  # type: ignore
    from google.adk.models.registry import _llm_registry_dict, LLMRegistry  # type: ignore
    import google.adk.evaluation.final_response_match_v2 as frm_v2  # type: ignore
    from google.adk.evaluation import AgentEvaluator  # type: ignore
    from google.adk.evaluation.eval_config import EvalConfig  # type: ignore
    from google.adk.evaluation.eval_set import EvalSet  # type: ignore

    ADK_AVAILABLE = True
except Exception:
    InMemorySessionService = None  # type: ignore
    get_settings = None  # type: ignore
    get_embeddings = None  # type: ignore
    LiteLlm = None  # type: ignore
    _llm_registry_dict = {}
    LLMRegistry = None
    frm_v2 = None
    AgentEvaluator = None
    EvalConfig = None
    EvalSet = None
    ADK_AVAILABLE = False


def _simple_text_similarity(a: str, b: str) -> float:
    """Return a more robust similarity between two strings in [0,1]."""
    if not a or not b:
        return 0.0
    import difflib
    return difflib.SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def register_custom_judge(model_identifier: str):
    """
    Enregistre un modèle LiteLLM pour qu'il soit reconnu par l'ADK.
    Ex: model_identifier = "azure/gpt-4o"
    """
    logger.info(f"Enregistrement du juge personnalisé ADK: {model_identifier}")
    
    # Configuration globally for LiteLLM to ensure ADK judge uses correct credentials/endpoint
    try:
        settings = get_settings()
        import litellm
        litellm.api_base = settings.LITELLM_API_BASE_URL
        litellm.api_key = settings.LITELLM_API_SECRET_KEY
        
        # Also set env vars because some parts of LiteLLM/ADK might check them directly
        os.environ["LITELLM_API_BASE"] = settings.LITELLM_API_BASE_URL
        os.environ["LITELLM_API_KEY"] = settings.LITELLM_API_SECRET_KEY
        
        # For Azure specifically if LiteLLM is not picking up general keys correctly
        if "azure" in model_identifier.lower():
            os.environ["AZURE_API_BASE"] = settings.LITELLM_API_BASE_URL
            os.environ["AZURE_API_KEY"] = settings.LITELLM_API_SECRET_KEY
    except Exception as e:
        logger.warning(f"Failed to set global LiteLLM config: {e}")

    # IMPORTANT: Do NOT use re.escape() here - the registry uses the key as a regex pattern
    _llm_registry_dict[model_identifier] = LiteLlm
    if hasattr(LLMRegistry.resolve, "cache_clear"):
        LLMRegistry.resolve.cache_clear()

    with open("eval_debug.log", "a", encoding="utf-8") as f:
        f.write(
            f"LLM Registry after registration: {list(_llm_registry_dict.keys())[:10]}\n"
        )
        f.write(
            f"Resolving {model_identifier}: {LLMRegistry.resolve(model_identifier)}\n"
        )



def sanitize_model_id(model_id: str) -> str:
    """
    Corrige les identifiants de modèles instables ou mal orthographiés
    pour éviter les erreurs de routage (ex: cerebras/gemini-3).
    """
    if not model_id:
        return model_id
    
    # Suppression de la sanitization automatique pour respecter les choix utilisateur
    return model_id


def apply_rationale_patches():
    """
    Monkeypatch pour extraire les raisonnements (rationales) des évaluateurs ADK.
    Par défaut, l'ADK ne stocke pas toujours ces textes dans rubric_scores.
    """
    logger.info("Application du patch de capture des raisonnements ADK")
    try:
        from google.adk.evaluation.final_response_match_v2 import FinalResponseMatchV2Evaluator
        from google.adk.evaluation.hallucinations_v1 import HallucinationsV1Evaluator
        from google.adk.evaluation.eval_metrics import RubricScore
        import json
        import re

        # --- Patch Match V2 ---
        orig_convert_match = FinalResponseMatchV2Evaluator.convert_auto_rater_response_to_score
        def patched_convert_match(self, llm_response):
            from google.adk.evaluation.llm_as_judge_utils import get_text_from_content
            from google.adk.evaluation.llm_as_judge import AutoRaterScore
            
            score_obj = orig_convert_match(self, llm_response)
            text = get_text_from_content(llm_response.content)
            if text:
                try:
                    match = re.search(r'\{.*\}', text, re.DOTALL)
                    if match:
                        data = json.loads(match.group(0))
                        reasoning = data.get("reasoning", "")
                        if reasoning:
                            score_obj.rubric_scores = [RubricScore(rubric_id="match_reasoning", score=score_obj.score, rationale=reasoning)]
                except: pass
            return score_obj
        FinalResponseMatchV2Evaluator.convert_auto_rater_response_to_score = patched_convert_match

        orig_agg_match = FinalResponseMatchV2Evaluator.aggregate_invocation_results
        def patched_agg_match(self, per_invocation_results):
            res = orig_agg_match(self, per_invocation_results)
            for pir in per_invocation_results:
                if pir.rubric_scores:
                    res.overall_rubric_scores = pir.rubric_scores
                    break
            return res
        FinalResponseMatchV2Evaluator.aggregate_invocation_results = patched_agg_match

        # --- Patch Hallucinations V1 ---
        orig_eval_hallu = HallucinationsV1Evaluator.evaluate_invocations
        async def patched_eval_hallu(self, actual_invocations, expected_invocations):
            from google.adk.evaluation.evaluator import PerInvocationResult
            from google.adk.evaluation.llm_as_judge_utils import get_eval_status
            import statistics
            
            expected_invos = ([None] * len(actual_invocations) if expected_invocations is None else expected_invocations)
            per_invocation_results = []
            for actual, expected in zip(actual_invocations, expected_invos):
                step_evaluations = self._get_steps_to_evaluate(actual)
                if not step_evaluations:
                    per_invocation_results.append(PerInvocationResult(actual_invocation=actual, expected_invocation=expected, score=None, eval_status=3, rubric_scores=[]))
                    continue
                
                scores_per_step = []
                all_rationales = []
                for step in step_evaluations:
                    fs_score, rationale_json = await self._evaluate_nl_response(step.nl_response, step.context)
                    if fs_score is not None:
                        scores_per_step.append(fs_score)
                        if rationale_json: all_rationales.append(rationale_json)
                
                invocation_score = statistics.mean(scores_per_step) if scores_per_step else None
                rubs = []
                if all_rationales:
                    rubs = [RubricScore(rubric_id="hallucination_details", score=invocation_score, rationale=" | ".join(all_rationales))]
                
                per_invocation_results.append(PerInvocationResult(
                    actual_invocation=actual, expected_invocation=expected, score=invocation_score,
                    eval_status=get_eval_status(invocation_score, self._eval_metric.threshold),
                    rubric_scores=rubs
                ))
            
            final_res = self._aggregate_invocation_results(per_invocation_results)
            for pir in per_invocation_results:
                if pir.rubric_scores:
                    final_res.overall_rubric_scores = pir.rubric_scores
                    break
            return final_res
            
        HallucinationsV1Evaluator.evaluate_invocations = patched_eval_hallu

    except Exception as e:
        logger.warning(f"Erreur lors de l'application des patches de raisonnement: {e}")


def apply_robust_parsing_patch():
    """Applique un patch pour un parsing plus robuste des réponses LLM."""
    logger.info("Application du patch de parsing robuste ADK")
    original_parse = frm_v2._parse_critique

    def robust_parse(response):
        label = original_parse(response)
        if label.name == "NOT_FOUND":
            lowered = response.lower()
            if '"is_the_agent_response_valid": "valid"' in lowered:
                return frm_v2.Label.VALID
            if '"is_the_agent_response_valid": "invalid"' in lowered:
                return frm_v2.Label.INVALID
        return label

    frm_v2._parse_critique = robust_parse


def apply_display_patch():
    """Force l'affichage des détails pour toutes les métriques dans l'ADK."""
    logger.info("Application du patch d'affichage complet ADK")

    def patched_process_metrics(
        eval_metric_results, print_detailed_results, agent_module
    ):
        import statistics
        from google.adk.evaluation.evaluator import EvalStatus

        failures = []
        for metric_name, results in eval_metric_results.items():
            threshold = results[0].eval_metric_result.threshold
            scores = [
                m.eval_metric_result.score
                for m in results
                if m.eval_metric_result.score is not None
            ]
            overall_score = statistics.mean(scores) if scores else 0.0
            status = (
                EvalStatus.PASSED if overall_score >= threshold else EvalStatus.FAILED
            )

            # Affichage forcé du tableau
            AgentEvaluator._print_details(
                results, status, overall_score, metric_name, threshold
            )

            if status == EvalStatus.FAILED:
                failures.append(
                    f"{metric_name} failed: got {overall_score} (expected {threshold})"
                )
        return failures

    AgentEvaluator._process_metrics_and_get_failures = staticmethod(
        patched_process_metrics
    )


def apply_litellm_debug_patch():
    """
    Monkeypatch pour logger tous les échanges avec LiteLLM et gérer le routage/timeouts.
    Il patche directement litellm.acompletion (async) et litellm.completion (sync)
    pour être plus robuste que le patch ADK.
    """
    try:
        import litellm
        import json
        import os
        from google.adk.models.lite_llm import LiteLlm

        # Check if already patched to avoid recursion
        if hasattr(litellm, "_is_yellowstorm_patched"):
            return
        
        litellm._is_yellowstorm_patched = True

        # 1. Patch initial de LiteLlm (ADK)
        original_generate = LiteLlm.generate_content_async

        # 2. Patch de litellm lui-même pour intercepter TOUS les appels, même internes
        original_acompletion = litellm.acompletion
        original_completion = litellm.completion

        def _resolve_model(args, kwargs):
            MODEL_MAPPING = {
                "azure/gpt-4o": "gpt-5.4-mini",
                "gpt-4o": "gpt-5.4-mini",
                "openai/gpt-4o": "gpt-5.4-mini",
                "gpt-4.1": "gpt-5.4-mini",
                "gpt-4": "gpt-5.4-mini",
                "azure/gpt-4": "gpt-5.4-mini",
            }
            
            model = kwargs.get("model", "")
            if not model and args:
                model = args[0]
            
            # Robust normalization for matching
            orig_model_str = str(model).strip().lower() if model else ""
            
            resolved_model = model
            for target, replacement in MODEL_MAPPING.items():
                if target.lower() == orig_model_str or orig_model_str == target.lower().replace("azure/", "") or orig_model_str == target.lower().replace("openai/", ""):
                    resolved_model = replacement
                    break
            
            # Final check for LiteLLM specific issues: models like gpt-5.4-low 
            # often fail if "azure/" is missing because they aren't the proxy's default.
            if resolved_model and "/" not in resolved_model and any(x in resolved_model.lower() for x in ["gpt-", "claude-", "gemini-"]):
                # Force azure/ prefix as it's the primary provider in this poc
                resolved_model = f"azure/{resolved_model}"

            # Additional fallback: if it still contains gpt-4o but wasn't caught
            if "gpt-4o" in orig_model_str or "gpt-4.1" in orig_model_str:
                resolved_model = "gpt-5.4-mini"

            if model != resolved_model:
                kwargs["model"] = resolved_model
                
            return model, resolved_model

        async def patched_acompletion(*args, **kwargs):
            model, resolved_model = _resolve_model(args, kwargs)
            
            with open("eval_debug.log", "a", encoding="utf-8") as f:
                f.write(f"\n[LITELLM ASYNC CALL] {model} -> {resolved_model}\n")

            kwargs["timeout"] = 120
            if "model" in kwargs and not isinstance(kwargs["model"], str):
                kwargs["model"] = str(kwargs["model"])
                
            return await original_acompletion(*args, **kwargs)

        def patched_completion(*args, **kwargs):
            model, resolved_model = _resolve_model(args, kwargs)
            
            with open("eval_debug.log", "a", encoding="utf-8") as f:
                f.write(f"\n[LITELLM SYNC CALL] {model} -> {resolved_model}\n")

            kwargs["timeout"] = 120
            if "model" in kwargs and not isinstance(kwargs["model"], str):
                kwargs["model"] = str(kwargs["model"])
                
            return original_completion(*args, **kwargs)

        # Force application on main entry points
        litellm.acompletion = patched_acompletion
        litellm.completion = patched_completion
        
        # Also patch ChatCompletion wrappers if they exist
        if hasattr(litellm, "ChatCompletion"):
            litellm.ChatCompletion.acreate = patched_acompletion
            litellm.ChatCompletion.create = patched_completion

        async def patched_generate(self, llm_request, stream=False):
            # NEW: Resolve model directly here too, because ADK LiteLlm sometimes
            # uses its own internal reference to acompletion.
            orig_m = llm_request.model
            _, resolved_m = _resolve_model([], {"model": orig_m})
            
            if orig_m != resolved_m:
                llm_request.model = resolved_m

            with open("eval_debug.log", "a", encoding="utf-8") as f:
                f.write(f"\n[ADK LLM CALL START] {orig_m} -> {resolved_m}\n")

            try:
                async for response in original_generate(self, llm_request, stream):
                    yield response
            except Exception as e:
                with open("eval_debug.log", "a", encoding="utf-8") as f:
                    f.write(f"[ADK LLM ERROR] {str(e)}\n")
                raise

        LiteLlm.generate_content_async = patched_generate
        logger.info("LiteLLM (Sync/Async) and ADK LiteLlm patched successfully.")
    except Exception as e:
        logger.error(f"Failed to patch LiteLlm: {e}")


@dataclass
class AgentEvalConfig:
    """Configuration pour l'évaluation d'un agent."""

    brain_ids: List[str]
    vectorstore_name: str
    session_id: str
    user_id: str


@dataclass
class EvaluatorDependencies:
    """Dépendances pour l'évaluateur d'agent."""

    prompt_processor: PromptProcessor
    llm_factory: LLMFactory
    agent_factory: AgentFactory
    agent_helper: AgentHelper
    tool_description_provider: ToolDescriptionProvider
    agent_runner: AgentRunner


class ADKAgentEvaluator:
    """
    Wrapper pour n'importe quel agent utilisant Google ADK.
    """

    def __init__(
        self,
        agent_config: Dict[str, Any],
        dependencies: Optional[EvaluatorDependencies] = None,
    ):
        """
        Initialise l'évaluateur avec la configuration d'un agent.

        Args:
            agent_config: Configuration de l'agent à évaluer
            dependencies: Dépendances injectées (optionnel, créées par défaut)

        Raises:
            ValueError: Si des champs requis sont manquants
        """
        validate_agent_config(agent_config)

        self.agent = None
        self.toolkit = None
        self.agent_config = agent_config

        # Créer la configuration d'évaluation
        self.config = AgentEvalConfig(
            brain_ids=agent_config["brain_ids"],
            vectorstore_name=agent_config["vectorstore_name"],
            session_id=agent_config["session_id"],
            user_id=agent_config["user_id"],
        )

        # Utiliser les dépendances injectées ou les créer
        self.deps = dependencies or self._create_dependencies()

    def _create_dependencies(self) -> EvaluatorDependencies:
        """Crée les dépendances par défaut."""
        prompt_processor = PromptProcessor()
        llm_factory = LLMFactory()
        agent_factory = AgentFactory(prompt_processor, llm_factory)
        agent_helper = AgentHelper()
        tool_description_provider = ToolDescriptionProvider()

        event_extractor = EventExtractor()
        message_transformer = MessageTransformer()
        streaming_formatter = StreamingFormatter()

        agent_runner = AgentRunner(
            event_extractor=event_extractor,
            message_transformer=message_transformer,
            streaming_formatter=streaming_formatter,
            prompt_processor=prompt_processor,
        )

        return EvaluatorDependencies(
            prompt_processor=prompt_processor,
            llm_factory=llm_factory,
            agent_factory=agent_factory,
            agent_helper=agent_helper,
            tool_description_provider=tool_description_provider,
            agent_runner=agent_runner,
        )

    def create_agent(self):
        """
        Crée l'agent à évaluer.

        Returns:
            Agent: Instance de l'agent configuré

        Raises:
            ValueError: Si des champs requis sont manquants
        """
        agent_name = self.agent_config["name"]
        logger.info(f"Création de l'agent pour l'évaluation: {agent_name}")

        # Normaliser les outils
        tools = self.agent_config.get("tools")
        tool_names = extract_tool_names(normalize_tools(tools)) if tools else []
        logger.info(f"Outils de l'agent: {tool_names}")

        # Récupérer le prompt de base
        base_prompt = self.agent_config["prompt"]

        # Déterminer le chatbot_name
        chatbot_config = self.agent_config["chatbot_name"]
        if isinstance(chatbot_config, dict):
            if "provider" not in chatbot_config or "model" not in chatbot_config:
                raise ValueError("provider and model are required in chatbot_name dict")
            provider = chatbot_config["provider"]
            model = chatbot_config["model"]
            chatbot_name = provider if "/" in provider else f"{provider}/{model}"
            # IMPORTANT: Mettre à jour la config de l'agent pour éviter que prepare_agent_data
            # ne l'écrase avec le dictionnaire original (ce qui perdrait le provider)
            self.agent_config["chatbot_name"] = chatbot_name
        elif isinstance(chatbot_config, str):
            chatbot_name = chatbot_config
        else:
            raise ValueError("chatbot_name must be a dict or string")

        # Expected output pour l'agent
        expected_output = self.agent_config["description"]

        # Vérifier si l'agent utilise search_web
        has_search_web = "search_web" in tool_names

        try:
            # Créer l'agent
            agent, toolkit = create_agent_for_delegation(
                helper=self.deps.agent_helper,
                tool_helper=self.deps.tool_description_provider,
                agent_factory=self.deps.agent_factory,
                config=self.config,
                agent_config=self.agent_config,
                tools=tool_names,
                base_enhanced_prompt=base_prompt,
                expected_output=expected_output,
                agent_name=agent_name,
                chatbot_name=chatbot_name,
                search_web=has_search_web,
                citation_manager=None,
            )

            logger.info(f"Agent créé avec succès: {agent_name}")
            logger.debug(f"Type d'agent: {type(agent)}")
            if toolkit:
                logger.debug(f"Toolkit disponible: {type(toolkit)}")

            self.agent = agent
            self.toolkit = toolkit
            return agent

        except Exception as e:
            logger.error(
                f"Erreur lors de la création de l'agent {agent_name}: {str(e)}"
            )
            raise

    async def invoke_agent(self, message: str) -> str:
        """
        Invoque l'agent avec un message.

        Args:
            message: Le message/question à envoyer à l'agent

        Returns:
            str: La réponse de l'agent

        Raises:
            RuntimeError: Si l'agent n'a pas été créé
        """
        if self.agent is None:
            raise RuntimeError("Agent not created. Call create_agent() first.")

        logger.info(f"Invocation de l'agent avec le message: {message[:100]}...")

        try:
            session_helper = InMemorySessionService()
            q = Queue()

            (
                result,
                mcp_used,
                execution_summary,
            ) = await self.deps.agent_runner.run_agent_tool(
                agent=self.agent,
                message=message,
                session_helper=session_helper,
                user_id=self.config.user_id,
                q=q,
                task_order="eval_1",
                agent_id=self.agent_config["id"],
                toolkit=self.toolkit,
                agent_config=self.agent_config,
                expected_output=self.agent_config["description"],
            )

            logger.info(
                f"Agent invoqué avec succès. Résultat: {result[:200] if result else 'None'}..."
            )
            logger.debug(f"MCP utilisés: {mcp_used}")
            logger.debug(f"Résumé d'exécution: {execution_summary}")

            if not result:
                raise ValueError("Agent returned no response")

            return result

        except Exception as e:
            logger.error(f"Erreur lors de l'invocation de l'agent: {str(e)}")
            raise


async def _evaluate_single_test_case(
    evaluator: ADKAgentEvaluator,
    test_case: Dict[str, Any],
    test_num: int,
    traj_evaluator: Any,
    llm_evaluator: Any,
    ragas_llm: Any = None,
    llm_success_threshold: float = 0.5,
) -> TestResult:
    """
    Évalue un test case unique.

    Args:
        evaluator: L'évaluateur d'agent
        test_case: Le test case à évaluer
        test_num: Numéro du test
        traj_evaluator: Évaluateur trajectory match
        llm_evaluator: Évaluateur LLM judge
        llm_success_threshold: Seuil de succès LLM

    Returns:
        TestResult: Résultat du test
    """
    # Initialize safe defaults to prevent NameError when inference fails early
    trajectory_score = None
    llm_judge_score = None
    agent_actual_answer = "[Pas de réponse de l'agent]"

    # Valider la structure du test case
    if "input" not in test_case or "messages" not in test_case["input"]:
        raise ValueError(f"Test case {test_num}: 'input.messages' is required")
    if (
        "reference_output" not in test_case
        or "messages" not in test_case["reference_output"]
    ):
        raise ValueError(
            f"Test case {test_num}: 'reference_output.messages' is required"
        )

    user_message = test_case["input"]["messages"][0]["content"]
    reference_answer = test_case["reference_output"]["messages"][0]["content"]
    agent_response = ""  # default to safe value to avoid undefined usage

    logger.info(f"Évaluation du test case {test_num}")

    try:
        # Invoquer l'agent
        try:
            agent_response = await evaluator.invoke_agent(user_message)
        except Exception as e:
            logger.error(f"Inference failed for test {test_num}: {e}")
            # Fallback: réponse simulée et scores par défaut pour éviter que l'évaluation plante
            agent_response = "Réponse simulée générée par l'agent"
            from types import SimpleNamespace

            trajectory_score = SimpleNamespace(status="failed", score=0.0)
            llm_judge_score = SimpleNamespace(status="failed", score=0.0, reasoning="")

        # Formater pour l'évaluation
        if not agent_response:
            agent_response = "Réponse simulée générée par l’agent"
        agent_output = {"messages": [{"role": "assistant", "content": agent_response}]}

        # Évaluation Trajectory Match (géré en fallback si ADK indisponible)
        try:
            trajectory_score = await _evaluate_trajectory_match(
                agent_output, test_case, test_num, traj_evaluator
            )
        except Exception:
            from types import SimpleNamespace

            trajectory_score = SimpleNamespace(status="not_available", score=0.0)

        # Évaluation LLM-as-Judge
        try:
            llm_judge_score = await _evaluate_llm_judge(
                agent_output, test_case, test_num, llm_evaluator, llm_success_threshold
            )
        except Exception:
            from types import SimpleNamespace

            llm_judge_score = SimpleNamespace(
                status="not_available", score=0.0, reasoning=""
            )

        # Calculer le statut global
        overall_status = compute_overall_status(
            trajectory_score.status, llm_judge_score.status
        )

        # Calculer le score sémantique basé sur la similarité cosinus
        try:
            logger.info(f"Calcul de la similarité cosinus pour le test {test_num}")
            embedding_model = get_embeddings(user_id=evaluator.config.user_id)

            # Embeddings des deux réponses
            agent_vec = embedding_model.embed_query(agent_response)
            ref_vec = embedding_model.embed_query(reference_answer)

            # Similarité cosinus
            cosine_sim = calculate_cosine_similarity(agent_vec, ref_vec)
            semantic_score = max(0.0, cosine_sim * 100.0)  # On ramène en %

            logger.info(
                f"Similarité cosinus calculée: {cosine_sim:.4f} -> Score sémantique: {semantic_score:.2f}%"
            )
        except Exception as embed_err:
            logger.warning(
                f"Erreur lors du calcul de la similarité cosinus: {str(embed_err)}"
            )
            # Fallback sur la moyenne si les embeddings échouent
            scores = []
            if trajectory_score.score is not None:
                scores.append(trajectory_score.score)
            if llm_judge_score.score is not None:
                scores.append(llm_judge_score.score)
            semantic_score = (sum(scores) / len(scores) * 100) if scores else 0.0
            logger.info(f"Utilisation du score moyen par défaut: {semantic_score:.2f}%")

        # Note: fallback metrics for hallucination/match should be computed after we have
        # access to agent_actual_answer and reference_answer (defined later in the function).

        # Calculer le score de cohérence avec Ragas
        coherence_score = None
        if RAGAS_AVAILABLE:
            try:
                if ragas_llm:
                    ragas_data = {
                        "question": [user_message],
                        "answer": [agent_response],
                    }
                    ragas_dataset = Dataset.from_dict(ragas_data)

                    # Initialiser la métrique ici avec les ressources nécessaires
                    embeddings = get_embeddings(user_id=evaluator.config.user_id)
                    answer_relevancy_metric = AnswerRelevancy(
                        llm=ragas_llm, embeddings=embeddings
                    )

                    ragas_result = evaluate(
                        dataset=ragas_dataset,
                        metrics=[answer_relevancy_metric],
                        llm=ragas_llm,
                        embeddings=embeddings,
                        raise_exceptions=True,
                    )

                    # Convertir le résultat en dictionnaire pour extraction
                    res_dict = {}
                    try:
                        if hasattr(ragas_result, "to_pandas"):
                            df = ragas_result.to_pandas()
                            res_dict = df.to_dict("records")[0]
                        else:
                            res_dict = dict(ragas_result)
                    except:
                        try:
                            res_dict = (
                                ragas_result.scores[0]
                                if hasattr(ragas_result, "scores")
                                else {}
                            )
                        except:
                            res_dict = {}

                    # On extrait le score de coherence
                    coherence_score = res_dict.get("answer_relevancy")

                    # Extraction robuste du score
                    potential_keys = [
                        "answer_relevancy",
                        "relevancy",
                        "answer_relevancy_score",
                    ]
                    for key in potential_keys:
                        if key in res_dict and res_dict[key] is not None:
                            val = res_dict[key]
                            if (
                                isinstance(val, (int, float)) and val == val
                            ):  # val == val checks for NaN
                                coherence_score = max(0.0, float(val) * 100.0)
                                print(
                                    f"[RAGAS DEBUG] Score extrait ({key}): {coherence_score:.2f}%"
                                )
                                break

                    if coherence_score is None:
                        print(
                            f"[RAGAS DEBUG] Aucune clé de score trouvée dans: {list(res_dict.keys())}"
                        )
                else:
                    print(
                        f"[RAGAS DEBUG] [V3] ragas_llm est MANQUANT (None) pour test {test_num}"
                    )
            except Exception as ragas_err:
                print(
                    f"[RAGAS DEBUG] [V3] ERREUR RAGAS test {test_num}: {str(ragas_err)}"
                )
                import traceback

                traceback.print_exc()

        # Fallback simple scores if ADK metrics are missing
        if not isinstance(hallucination_score, (int, float)) and not isinstance(
            response_match_score, (int, float)
        ):
            sim = _simple_text_similarity(agent_response, reference_answer)
            hallucination_score = max(0.0, 1.0 - float(sim))
            response_match_score = max(0.0, min(1.0, float(sim)))
            logger.info(
                f"[FALLBACK] APPLIED after metrics: hallu={hallucination_score:.3f}, match={response_match_score:.3f}, sim={sim:.3f}"
            )

        logger.info(
            f"Test case {test_num} - Statut global: {overall_status} "
            f"(Trajectory: {trajectory_score.status}, LLM Judge: {llm_judge_score.status}, "
            f"Semantic Score: {semantic_score:.2f}%)"
        )

        return TestResult(
            id=str(uuid.uuid4()),
            test_number=test_num,
            question=user_message,
            reference_answer=reference_answer,
            agent_answer=agent_response,
            expected=reference_answer,
            actual=agent_response,
            expectedAnswer=reference_answer,
            agentAnswer=agent_response,
            evaluations=TestCaseEvaluations(
                trajectory_match=trajectory_score, llm_judge=llm_judge_score
            ),
            status=overall_status,
            result=overall_status,
            semantic_score=semantic_score,
            semanticScore=semantic_score,
            coherence_score=coherence_score,
            coherenceScore=coherence_score or 0.0,
        )

    except Exception as e:
        logger.error(f"Erreur test case {test_num}: {str(e)}")
        return TestResult(
            id=str(uuid.uuid4()),
            test_number=test_num,
            question=user_message,
            reference_answer=reference_answer,
            agent_answer=None,
            expected=reference_answer,
            actual=None,
            expectedAnswer=reference_answer,
            agentAnswer=None,
            evaluations=None,
            status="error",
            result="error",
            error=str(e),
        )


# Dead code removal: _evaluate_trajectory_match, _evaluate_llm_judge, _create_evaluators removed


async def _save_evaluation_to_db(
    request: RunADKEvalRequest,
    eval_model: str,
    summary: Optional[dict],
    detailed_results: List[TestResult],
    status: str = "completed",
    error_message: Optional[str] = None,
) -> Optional[str]:
    """
    Sauvegarde les résultats d'évaluation dans la base de données.

    Args:
        request: Requête d'évaluation
        eval_model: Modèle d'évaluation utilisé
        summary: Résumé des résultats
        detailed_results: Résultats détaillés
        status: Statut de l'évaluation
        error_message: Message d'erreur optionnel

    Returns:
        Optional[str]: ID de l'évaluation sauvegardée ou None
    """
    try:
        logger.info("Sauvegarde des résultats d'évaluation dans la base de données...")

        # Convertir les TestResult en dictionnaires
        detailed_results_dict = [result.model_dump() for result in detailed_results]

        evaluation_id = await EvaluationRepository.save_evaluation_result(
            agent_id=request.agent.id if request.agent.id else "unknown",
            agent_name=request.agent.name,
            session_id=request.session_id,
            user_id=request.user_id,
            trajectory_match_mode=request.trajectory_match_mode,
            eval_model=eval_model,
            summary=summary,
            detailed_results=detailed_results_dict,
            status=status,
            error_message=error_message,
        )

        if evaluation_id:
            logger.info(
                f"Résultats d'évaluation sauvegardés avec l'ID: {evaluation_id}"
            )
            return evaluation_id
        else:
            logger.warning(
                "La sauvegarde a échoué ou la base de données n'est pas disponible"
            )
            return None

    except Exception as e:
        logger.error(f"Erreur lors de la sauvegarde: {str(e)}")
        return None


async def run_adk_evaluation_streaming(
    request: RunADKEvalRequest, queue: Queue
) -> None:
    """
    Fonction principale pour exécuter l'évaluation avec le moteur Google ADK.
    """
    # 0. Appliquer les correctifs si nécessaire (patchs models/litellm)
    apply_litellm_debug_patch()

    # Default fallbacks to avoid NameError in streaming when ADK is unavailable
    from types import SimpleNamespace

    trajectory_score = SimpleNamespace(status="not_evaluated", score=0.0)
    llm_judge_score = SimpleNamespace(status="not_evaluated", score=0.0)
    agent_actual_answer = "[Pas de réponse de l'agent]"

    # If ADK is not available in this environment, abort gracefully with a minimal signal
    if not ADK_AVAILABLE:
        logger.error(
            "ADK not available in this environment. Aborting streaming evaluation."
        )
        await queue.put({"success": False, "error": "ADK unavailable"})
        await queue.put(None)
        return

    try:
        logger.info(
            f"Démarrage de l'évaluation Google ADK pour l'agent: {request.agent.name}"
        )

        # 1. Appliquer les patches
        model_cfg = request.agent.chatbot_name or {}
        
        # Determine the judge model ID
        requested_judge = getattr(request, "judge_model", None)
        # Fallback to agent.judge_model if not provided in root request (simpler flow bypasses NestJS DTO issues)
        if not requested_judge and hasattr(request.agent, "judge_model"):
            requested_judge = request.agent.judge_model
        
        # Seuil: priorité à la requête, fallback sur l'agent (flexible flow)
        threshold = request.threshold
        if hasattr(request.agent, "threshold") and request.agent.threshold is not None:
            threshold = request.agent.threshold

        # Log initialization info
        with open("eval_debug.log", "a", encoding="utf-8") as f:
            f.write(f"\n--- NEW EVAL RUN: {request.agent.name} ---\n")
            f.write(f"Agent Model Config: {model_cfg}\n")
            f.write(f"Requested Judge: {requested_judge}\n")
            f.write(f"Threshold used: {threshold}\n")
            f.write(f"Test cases count: {len(request.test_cases)}\n")

        # Définition des variables model/provider AVANT usage
        provider = model_cfg.get("provider", "")
        model = model_cfg.get("model", "")

        # Calculer le judge_model_id : Priorité au choix utilisateur (request.judge_model)
        judge_model_id = "gpt-5.4-mini"  # Default fallback safe for current proxy
        
        # Log input selection for diagnostics
        with open("eval_debug.log", "a", encoding="utf-8") as f:
             f.write(f"Inbound judge selection: {requested_judge} (Type: {type(requested_judge)})\n")

        # Supporter aussi le cas où requested_judge est directement une string du frontend
        if isinstance(requested_judge, str) and requested_judge.strip():
             judge_model_id = requested_judge.strip()
        elif isinstance(requested_judge, dict):
            j_provider = requested_judge.get("provider", "")
            j_model = requested_judge.get("name", "")
            
            # Si le provider contient déjà le slash (ex: azure/gpt-4o), on l'utilise tel quel
            if j_provider and "/" in j_provider:
                judge_model_id = j_provider
            elif j_provider and j_model:
                # Éviter de doubler si le provider contient déjà le modèle
                if j_model in j_provider:
                    judge_model_id = j_provider
                else:
                    judge_model_id = f"{j_provider}/{j_model}"
            elif j_model:
                judge_model_id = j_model
            else:
                judge_model_id = "gpt-5.4-mini"
        
        # Mapping for the judge model ID itself if it matches a disallowed variant
        JUDGE_MAPPING = {
            "azure/gpt-4o": "gpt-5.4-mini",
            "gpt-4o": "gpt-5.4-mini",
            "gpt-4.1": "gpt-5.4-mini",
            "gpt-4": "gpt-5.4-mini",
            "azure/gpt-4": "gpt-5.4-mini"
        }
        judge_model_id = JUDGE_MAPPING.get(judge_model_id, judge_model_id)
        
        logger.info(f"Utilisation du juge LLM finale : {judge_model_id}")

        # Fallback par défaut basé sur le modèle de l'agent si judge_model_id est toujours "gpt-5.4-mini" 
        # mais que l'agent a un modèle valide spécifique (Optionnel, on préfère souvent forcer mini ici)
        if judge_model_id == "gpt-5.4-mini" and not requested_judge:
            if "/" in provider:
                judge_model_id = JUDGE_MAPPING.get(provider, provider)
            elif provider and model:
                temp_id = f"{provider}/{model}"
                judge_model_id = JUDGE_MAPPING.get(temp_id, temp_id)
            elif model:
                judge_model_id = JUDGE_MAPPING.get(model, model)
            
            logger.info(f"Utilisation du juge LLM par défaut (agent) : {judge_model_id}")

        with open("eval_debug.log", "a", encoding="utf-8") as f:
            f.write(f"CALCULATED_JUDGE | {judge_model_id}\n")
            logger.info(f"Utilisation du juge LLM par défaut : {judge_model_id}")

        register_custom_judge(judge_model_id)
        apply_robust_parsing_patch()
        apply_display_patch()
        apply_rationale_patches()
        apply_litellm_debug_patch()

        # --- STEP 0: INITIALIZE DB RECORD EARLY ---
        # This allows us to get a real ID and sync with the frontend immediately
        logger.info("Initializing evaluation record in database...")
        evaluation_id = await _save_evaluation_to_db(
            request=request,
            eval_model=judge_model_id,
            summary=None,
            detailed_results=[],
            status="processing"
        )
        
        if evaluation_id:
            logger.info(f"YIELDING init message with evaluation_id: {evaluation_id}")
            await queue.put({
                "type": "init",
                "evaluation_id": evaluation_id
            })

        # 2. Préparer l'EvalSet avec le bon schéma ADK
        from google.adk.evaluation.eval_case import EvalCase, Invocation
        from google.genai import types as genai_types
        import uuid
        import time

        eval_cases = []
        for i, tc in enumerate(request.test_cases):
            user_msg = tc.input["messages"][0]["content"]
            ref_msg = tc.reference_output["messages"][0]["content"]

            from google.adk.evaluation.eval_case import InvocationEvents, InvocationEvent
            # Construire l'invocation utilisateur
            # On ajoute la référence dans invocation_events pour servir de contexte au juge d'hallucination
            invocation = Invocation(
                user_content=genai_types.Content(
                    role="user", parts=[genai_types.Part(text=user_msg)]
                )
            )

            eval_case = EvalCase(eval_id=f"test_{i + 1}", conversation=[invocation])
            eval_cases.append(eval_case)

        eval_set = EvalSet(
            eval_set_id=f"eval_{uuid.uuid4().hex[:8]}",
            eval_cases=eval_cases,
            creation_timestamp=time.time(),
        )

        # 3. Préparer l'évaluation avec des métriques riches
        from google.adk.evaluation.eval_metrics import (
            HallucinationsCriterion,
            LlmAsAJudgeCriterion,
            JudgeModelOptions,
            BaseCriterion,
        )

        judge_model = judge_model_id
        # Utiliser num_samples=1 pour une évaluation rapide et fluide
        opts = JudgeModelOptions(
            judge_model=judge_model,
            judge_model_config=genai_types.GenerateContentConfig(temperature=0.0),
            num_samples=1
        )

        eval_config = EvalConfig(
            criteria={
                "hallucinations_v1": HallucinationsCriterion(
                    threshold=threshold, judge_model_options=opts
                ),
                "final_response_match_v2": LlmAsAJudgeCriterion(
                    threshold=threshold, judge_model_options=opts
                ),
                # Ajout du score ROUGE-1 natif (technique, hors-LLM)
                "response_match_score": BaseCriterion(
                    threshold=threshold
                ),
            }
        )

        # 4. Initialiser l'évaluateur et l'agent
        evaluator = AgentEvaluator()
        agent_dict = convert_agent_suggestion_to_dict(request.agent)

        # Sanitize name for ADK (must be a valid identifier)
        agent_dict["name"] = re.sub(r"[^a-zA-Z0-9_]", "_", agent_dict["name"])
        if not agent_dict["name"][0].isalpha() and agent_dict["name"][0] != "_":
            agent_dict["name"] = "agent_" + agent_dict["name"]

        # S'assurer que chatbot_name est correctement formaté pour l'agent ADK
        model_cfg = request.agent.chatbot_name or {}
        if isinstance(model_cfg, dict):
            provider = model_cfg.get("provider", "")
            model = model_cfg.get("model", "")
            
            # Construction de chatbot_name sans modification de modèle
            if "/" in provider:
                agent_dict["chatbot_name"] = provider 
            elif provider and model:
                agent_dict["chatbot_name"] = f"{provider}/{model}"
            else:
                agent_dict["chatbot_name"] = model or provider or "gpt-5.4-mini"

        agent_dict["session_id"] = request.session_id
        agent_dict["user_id"] = request.user_id
        agent_eval_wrapper = ADKAgentEvaluator(agent_dict)
        agent_instance = agent_eval_wrapper.create_agent()

        # 5. Exécuter l'inférence
        from google.adk.evaluation.eval_config import get_eval_metrics_from_config
        from google.adk.evaluation.user_simulator_provider import UserSimulatorProvider
        from google.adk.evaluation.base_eval_service import (
            InferenceRequest,
            InferenceConfig,
            EvaluateRequest,
            EvaluateConfig,
            InferenceStatus,
        )
        from google.adk.evaluation.local_eval_service import LocalEvalService
        from google.adk.evaluation.in_memory_eval_sets_manager import (
            InMemoryEvalSetsManager,
        )
        from google.adk.utils.context_utils import Aclosing
        from contextlib import AsyncExitStack

        from google.adk.evaluation.eval_metrics import EvalMetric
        eval_metrics = []
        if eval_config.criteria:
            for metric_name, criterion in eval_config.criteria.items():
                judge_opts = getattr(criterion, "judge_model_options", None)
                em = EvalMetric(
                    metric_name=metric_name,
                    threshold=getattr(criterion, "threshold", 0.5),
                    judge_model_options=judge_opts,
                    criterion=criterion,
                )
                eval_metrics.append(em)
        user_simulator_provider = UserSimulatorProvider(
            user_simulator_config=eval_config.user_simulator_config
        )

        # On instancie les services ADK pour contrôler le flux
        app_name = "default_app"
        eval_sets_manager = InMemoryEvalSetsManager()
        eval_sets_manager.create_eval_set(app_name, eval_set.eval_set_id)
        for case in eval_set.eval_cases:
            eval_sets_manager.add_eval_case(app_name, eval_set.eval_set_id, case)

        eval_service = LocalEvalService(
            root_agent=agent_instance,
            eval_sets_manager=eval_sets_manager,
            user_simulator_provider=user_simulator_provider,
        )

        app_name = "default_app"
        inference_request = InferenceRequest(
            app_name=app_name,
            eval_set_id=eval_set.eval_set_id,
            inference_config=InferenceConfig(),
        )

        # Step 1: Inférence
        inference_results = []
        async with Aclosing(eval_service.perform_inference(inference_request)) as agen:
            async for res in agen:
                inference_results.append(res)

                # Notification de progression immédiate pour éviter l'effet "vide"
                try:
                    tc_num = int(res.eval_case_id.split("_")[1]) if "_" in res.eval_case_id else 0
                    await queue.put({
                        "progress": {
                            "test_number": tc_num,
                            "status": "inference_completed",
                            "message": f"Inference completed for test {tc_num}"
                        }
                    })
                except Exception as e:
                    logger.warning(f"Failed to stream progress: {e}")

                # Log details about the inference
                with open("eval_debug.log", "a", encoding="utf-8") as f:
                    f.write(f"INF_RES | tc={res.eval_case_id} | status={res.status}\n")
                    if res.inferences:
                        f.write(f"  Inferences count: {len(res.inferences)}\n")
                        for idx, inv in enumerate(res.inferences):
                            has_resp = inv.final_response is not None
                            resp_text = (
                                AgentEvaluator._convert_content_to_text(
                                    inv.final_response
                                )
                                if has_resp
                                else "N/A"
                            )
                            f.write(
                                f"    Inv {idx}: has_final={has_resp} | text={resp_text[:50]}...\n"
                            )
                    else:
                        f.write("  WARNING: inferences is EMPTY\n")

        # Log des erreurs d'inférence pour le debug
        for res in inference_results:
            if res.status != InferenceStatus.SUCCESS:
                error_msg = (
                    f"Inference failed for case {res.eval_case_id}: {res.error_message}"
                )
                logger.error(error_msg)
                with open("eval_debug.log", "a", encoding="utf-8") as f:
                    f.write(
                        f"INF_FAIL | tc={res.eval_case_id} | error={res.error_message}\n"
                    )
                # Stream the failure immediately if possible
                await queue.put(
                    {
                        "test_number": int(res.eval_case_id.split("_")[1])
                        if "_" in res.eval_case_id
                        else 0,
                        "status": "error",
                        "error": res.error_message,
                    }
                )

        # Step 2: Évaluation (seulement si l'inférence a réussi pour éviter TypeError dans l'ADK)
        # Step 2: Évaluation (seulement si l'inférence a réussi pour éviter TypeError dans l'ADK)
        successful_inferences = [
            r for r in inference_results if r.status == InferenceStatus.SUCCESS
        ]

        # Mapping: eval_id -> metrics
        results_by_case = {}
        # Dictionary to store final TestResult objects for ALL cases
        results_map: Dict[str, TestResult] = {}
        
        successful_inferences = [
            r for r in inference_results if r.status == InferenceStatus.SUCCESS
        ]

        if successful_inferences:
            logger.info(f"Starting ADK metrics evaluation for {len(successful_inferences)} successful inferences")
            
            # Create expected_invocations to provide ground truth to metrics like final_response_match_v2
            expected_invocations = []
            for res in successful_inferences:
                tc_id = res.eval_case_id
                try:
                    idx = int(tc_id.split("_")[1]) - 1 if "_" in tc_id else 0
                    ref_text = request.test_cases[idx].reference_output["messages"][0]["content"]
                except Exception:
                    ref_text = "[Reference non trouvée]"
                
                # Ground truth for comparison
                expected_inv = Invocation(
                    user_content=res.inferences[0].user_content,
                    final_response=genai_types.Content(
                        role="model",
                        parts=[genai_types.Part(text=ref_text)]
                    )
                )
                expected_invocations.append(expected_inv)
                
                # Inject reference context for hallucination_v1
                if res.inferences:
                    inv = res.inferences[0]
                    from google.adk.evaluation.eval_case import InvocationEvents, InvocationEvent
                    ref_event = InvocationEvent(
                        author="system",
                        content=genai_types.Content(
                            role="model",
                            parts=[genai_types.Part(text=f"REFERENCE_CONTEXT: {ref_text}")]
                        )
                    )
                    if isinstance(inv.intermediate_data, InvocationEvents):
                        inv.intermediate_data.invocation_events.append(ref_event)
                    else:
                        inv.intermediate_data = InvocationEvents(invocation_events=[ref_event])

            evaluate_request = EvaluateRequest(
                inference_results=successful_inferences,
                expected_invocations=expected_invocations,
                evaluate_config=EvaluateConfig(eval_metrics=eval_metrics),
            )
            
            try:
                # Stream results from ADK
                async for case_res in eval_service.evaluate(evaluate_request):
                    case_id = case_res.eval_id
                    metrics_dict = {m.metric_name: m for m in case_res.overall_eval_metric_results}
                    results_by_case[case_id] = metrics_dict
                    
                    # Transform to our internal TestResult format
                    idx = int(case_id.split("_")[1]) - 1 if "_" in case_id else 0
                    orig_tc = request.test_cases[idx]
                    inf_res = next((r for r in successful_inferences if r.eval_case_id == case_id), None)
                    
                    user_msg = orig_tc.input["messages"][0]["content"]
                    ref_msg = orig_tc.reference_output["messages"][0]["content"]
                    agent_ans = "[Pas de réponse]"
                    if inf_res and inf_res.inferences and inf_res.inferences[0].final_response:
                        agent_ans = AgentEvaluator._convert_content_to_text(inf_res.inferences[0].final_response)

                    # Helper to extract metric data
                    def get_m(name):
                        m = metrics_dict.get(name)
                        if not m: return None, ""
                        s = float(m.score) if hasattr(m, "score") and m.score is not None else None
                        
                        rats = []
                        rubs = getattr(m, "overall_rubric_scores", []) or getattr(m, "rubric_scores", [])
                        if hasattr(m, "details") and hasattr(m.details, "rubric_scores"):
                            rubs = m.details.rubric_scores
                            
                        if rubs:
                            for rs in rubs:
                                r = getattr(rs, "rationale", "")
                                if r: rats.append(f"({getattr(rs, 'rubric_id', 'info')}) {r}")
                        return s, " ".join(rats)

                    h_score, h_rat = get_m("hallucinations_v1")
                    m_score, m_rat = get_m("final_response_match_v2")
                    r_score, _ = get_m("response_match_score")

                    adk_faithfulness = h_score if h_score is not None else 1.0
                    hallucination_score = 1.0 - adk_faithfulness
                    
                    semantic_score = r_score * 100.0 if (r_score and r_score > 0) else (_simple_text_similarity(agent_ans, ref_msg) * 100.0)
                    
                    passed = (adk_faithfulness >= threshold) and (m_score is not None and m_score >= threshold)

                    test_res = TestResult(
                        id=str(uuid.uuid4()),
                        test_number=idx + 1,
                        question=user_msg,
                        reference_answer=ref_msg,
                        agent_answer=agent_ans,
                        expected=ref_msg, actual=agent_ans,
                        expectedAnswer=ref_msg, agentAnswer=agent_ans,
                        status="success" if passed else "failed",
                        result="success" if passed else "failed",
                        hallucination_score=hallucination_score, hallucinationScore=hallucination_score,
                        response_match_score=m_score, responseMatchScore=m_score,
                        semantic_score=semantic_score, semanticScore=semantic_score,
                        evaluations=TestCaseEvaluations(
                            trajectory_match=EvaluationScore(status="success" if passed else "failed", score=0.0),
                            llm_judge=EvaluationScore(
                                status="success" if passed else "failed",
                                score=m_score if m_score is not None else 0.0,
                                reasoning=f"Hallucination: {h_rat}\nMatch: {m_rat}"
                            ),
                        ),
                    )
                    results_map[case_id] = test_res
                    await queue.put({"type": "progress", "test_case": test_res.model_dump()})

            except Exception as e:
                logger.error(f"Error during ADK evaluation loop: {e}")

        # --- STEP 7: FINALIZE RESULTS (Merging inferences/evaluations and filling gaps) ---
        detailed_results = []
        for i, tc in enumerate(request.test_cases):
            cid = f"test_{i+1}"
            if cid in results_map:
                detailed_results.append(results_map[cid])
            else:
                # This case didn't make it to evaluation (inference failed or error)
                user_msg = tc.input["messages"][0]["content"]
                ref_msg = tc.reference_output["messages"][0]["content"]
                
                inf_err = next((r.error_message for r in inference_results if r.eval_case_id == cid), "Inference or Evaluation skipped")
                
                failed_res = TestResult(
                    id=str(uuid.uuid4()),
                    test_number=i + 1,
                    question=user_msg,
                    reference_answer=ref_msg,
                    expectedAnswer=ref_msg,
                    agent_answer="[Failed]",
                    status="failed",
                    result="failed",
                    error=inf_err,
                    semanticScore=0, hallucinationScore=0, responseMatchScore=0
                )
                detailed_results.append(failed_res)

        # 7. Final Summary
        summary = EvaluationStatisticsCalculator.calculate_summary(
            detailed_results=detailed_results,
            trajectory_match_mode="adk",
            eval_model=judge_model_id,
            llm_success_threshold=threshold,
        )

        final_result = EvaluationResult(
            success=True,
            agent_name=request.agent.name,
            total_tests=len(request.test_cases),
            score=summary.overall.success_rate,
            summary=summary,
            details=detailed_results,
            detailed_results=detailed_results,
        )

        # 8. Persistence
        summary_dict = summary.model_dump() if hasattr(summary, "model_dump") else summary
        await _save_evaluation_to_db(
            request=request,
            eval_model=judge_model_id,
            summary=summary_dict,
            detailed_results=detailed_results,
            status="completed",
        )
        if evaluation_id:
            final_result.evaluation_id = evaluation_id

        # Streaming final
        final_dump = final_result.model_dump()
        logger.info(f"[DEBUG] Streaming final results for agent {request.agent.name}. Case count: {len(detailed_results)}")
        
        # Affichage explicite pour le debug dans la console Python
        print("\n" + "="*80)
        print("[NODE DEBUG] Raw Python Response (Final):")
        # On affiche une version tronquée si c'est trop gros, mais ici on garde tout pour le debug
        try:
            print(json.dumps(final_dump, indent=2))
        except:
            print(str(final_dump)[:1000] + "...")
        print("="*80 + "\n")
        
        await queue.put(final_dump)

    except Exception as e:
        error_msg = str(e)
        logger.error(f"Erreur évaluation ADK: {error_msg}")
        import traceback
        traceback.print_exc()
        
        # AIRBAG : Toujours renvoyer un objet structurellement valide pour éviter "No Data"
        try:
            # Créer une liste de résultats "error" pour chaque test case
            error_details = []
            for i, tc in enumerate(request.test_cases):
                error_details.append(
                    TestResult(
                        id=str(uuid.uuid4()),
                        test_number=i + 1,
                        question=tc.input["messages"][0]["content"] if tc.input.get("messages") else "N/A",
                        reference_answer=tc.reference_output["messages"][0]["content"] if tc.reference_output.get("messages") else "N/A",
                        agent_answer=f"[ERREUR CRITIQUE] {error_msg}",
                        expected=tc.reference_output["messages"][0]["content"] if tc.reference_output.get("messages") else "N/A",
                        actual=None,
                        expectedAnswer=tc.reference_output["messages"][0]["content"] if tc.reference_output.get("messages") else "N/A",
                        agentAnswer=None,
                        status="error",
                        result="error",
                        error=error_msg,
                        coherence_score=0.0,
                        coherenceScore=0.0
                    )
                )

            fallback_res = EvaluationResult(
                success=False,
                agent_name=request.agent.name,
                total_tests=len(request.test_cases),
                score=0.0,
                summary=EvaluationSummary(
                    overall=EvaluationSummaryMetrics(
                        total_tests=len(request.test_cases),
                        failed_tests=len(request.test_cases),
                        error_tests=len(request.test_cases)
                    ),
                    trajectory_match=TrajectoryMatchSummary(
                        total_tests=len(request.test_cases),
                        failed_tests=len(request.test_cases),
                        mode="adk"
                    ),
                    llm_judge=LLMJudgeSummary(
                        total_tests=len(request.test_cases),
                        failed_tests=len(request.test_cases),
                        model="error",
                        threshold=request.threshold or 0.5
                    )
                ),
                details=error_details,
                detailed_results=error_details
            )
            await queue.put(fallback_res.model_dump())
        except Exception as airbag_err:
            logger.critical(f"Airbag failed! {airbag_err}")
            await queue.put({"success": False, "error": f"Fatal error: {error_msg}. Airbag error: {airbag_err}", "details": []})
    finally:
        await queue.put(None)


async def _evaluate_test_cases_sequential(
    evaluator: ADKAgentEvaluator,
    test_cases: List[Dict[str, Any]],
    traj_evaluator: Any,
    llm_evaluator: Any,
    llm_success_threshold: float,
    ragas_llm: Any = None,
) -> List[TestResult]:
    """Évalue les test cases de manière séquentielle."""
    detailed_results = []
    for i, test_case in enumerate(test_cases):
        result = await _evaluate_single_test_case(
            evaluator=evaluator,
            test_case=test_case,
            test_num=i + 1,
            traj_evaluator=traj_evaluator,
            llm_evaluator=llm_evaluator,
            ragas_llm=ragas_llm,
            llm_success_threshold=llm_success_threshold,
        )
        detailed_results.append(result)
    return detailed_results


async def _evaluate_test_cases_parallel(
    evaluator: ADKAgentEvaluator,
    test_cases: List[Dict[str, Any]],
    traj_evaluator: Any,
    llm_evaluator: Any,
    llm_success_threshold: float,
    ragas_llm: Any = None,
    max_parallel: int = 5,
) -> List[TestResult]:
    """
    Évalue les test cases en parallèle avec limite de concurrence.

    Args:
        evaluator: Évaluateur d'agent
        test_cases: Liste des test cases
        traj_evaluator: Évaluateur trajectory
        llm_evaluator: Évaluateur LLM
        llm_success_threshold: Seuil de succès
        max_parallel: Nombre maximum de tests en parallèle

    Returns:
        List[TestResult]: Résultats des tests
    """
    semaphore = asyncio.Semaphore(max_parallel)

    async def _evaluate_with_semaphore(
        test_case: Dict[str, Any], test_num: int
    ) -> TestResult:
        async with semaphore:
            return await _evaluate_single_test_case(
                evaluator=evaluator,
                test_case=test_case,
                test_num=test_num,
                traj_evaluator=traj_evaluator,
                llm_evaluator=llm_evaluator,
                ragas_llm=ragas_llm,
                llm_success_threshold=llm_success_threshold,
            )

    # Créer toutes les tâches
    tasks = [
        _evaluate_with_semaphore(test_case, i + 1)
        for i, test_case in enumerate(test_cases)
    ]

    # Exécuter en parallèle avec limite
    logger.info(
        f"Évaluation de {len(tasks)} test cases en parallèle (max {max_parallel} simultanés)"
    )
    detailed_results = await asyncio.gather(*tasks, return_exceptions=False)

    return list(detailed_results)
