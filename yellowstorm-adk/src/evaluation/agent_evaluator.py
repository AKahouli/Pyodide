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
import os
import re
from datetime import datetime
from src.logger.logging import get_logger
from src.smart_rag.infrastructure.model_parameters import normalize_messages_for_model
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

# ADK available check
try:
    from google.adk.sessions import InMemorySessionService
    from src.config.settings import get_settings
    from src.similarity_search.embeddings import get_embeddings
    from google.adk.models.lite_llm import LiteLlm
    from google.adk.models.registry import _llm_registry_dict, LLMRegistry
    import google.adk.evaluation.final_response_match_v2 as frm_v2
    from google.adk.evaluation import AgentEvaluator
    from google.adk.evaluation.eval_config import EvalConfig
    from google.adk.evaluation.eval_set import EvalSet
    ADK_AVAILABLE = True
except Exception:
    ADK_AVAILABLE = False


def _simple_text_similarity(a: str, b: str) -> float:
    if not a or not b: return 0.0
    import difflib
    return difflib.SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def register_custom_judge(model_identifier: str):
    logger.info(f"Enregistrement du juge personnalisé ADK: {model_identifier}")
    try:
        settings = get_settings()
        import litellm
        litellm.api_base = settings.LITELLM_API_BASE_URL
        litellm.api_key = settings.LITELLM_API_SECRET_KEY
        os.environ["LITELLM_API_BASE"] = settings.LITELLM_API_BASE_URL
        os.environ["LITELLM_API_KEY"] = settings.LITELLM_API_SECRET_KEY
    except Exception as e:
        logger.warning(f"Failed to set global LiteLLM config: {e}")

    _llm_registry_dict[model_identifier] = LiteLlm
    if hasattr(LLMRegistry, "resolve") and hasattr(LLMRegistry.resolve, "cache_clear"):
        LLMRegistry.resolve.cache_clear()


def apply_rationale_patches():
    try:
        from google.adk.evaluation.final_response_match_v2 import FinalResponseMatchV2Evaluator
        from google.adk.evaluation.hallucinations_v1 import HallucinationsV1Evaluator
        from google.adk.evaluation.eval_metrics import RubricScore
        
        # Match V2 Patches
        orig_convert_match = FinalResponseMatchV2Evaluator.convert_auto_rater_response_to_score
        def patched_convert_match(self, llm_response):
            from google.adk.evaluation.llm_as_judge_utils import get_text_from_content
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

        # Hallucu V1 Patches
        orig_eval_hallu = HallucinationsV1Evaluator.evaluate_invocations
        async def patched_eval_hallu(self, actual_invocations, expected_invocations):
            from google.adk.evaluation.evaluator import PerInvocationResult
            from google.adk.evaluation.llm_as_judge_utils import get_eval_status
            import statistics
            
            per_invocation_results = []
            for actual, expected in zip(actual_invocations, expected_invocations or ([None] * len(actual_invocations))):
                step_evaluations = self._get_steps_to_evaluate(actual)
                if not step_evaluations:
                    per_invocation_results.append(PerInvocationResult(actual_invocation=actual, expected_invocation=expected, score=None, eval_status=3, rubric_scores=[]))
                    continue
                scores, rats = [], []
                for step in step_evaluations:
                    fs_score, rationale = await self._evaluate_nl_response(step.nl_response, step.context)
                    if fs_score is not None:
                        scores.append(fs_score)
                        if rationale: rats.append(rationale)
                inv_score = statistics.mean(scores) if scores else None
                rubs = [RubricScore(rubric_id="hallucination_details", score=inv_score, rationale=" | ".join(rats))] if rats else []
                per_invocation_results.append(PerInvocationResult(actual_invocation=actual, expected_invocation=expected, score=inv_score, eval_status=get_eval_status(inv_score, self._eval_metric.threshold), rubric_scores=rubs))
            
            final_res = self._aggregate_invocation_results(per_invocation_results)
            for pir in per_invocation_results:
                if pir.rubric_scores: final_res.overall_rubric_scores = pir.rubric_scores; break
            return final_res
        HallucinationsV1Evaluator.evaluate_invocations = patched_eval_hallu
    except: pass

def apply_robust_parsing_patch():
    try:
        original_parse = frm_v2._parse_critique
        def robust_parse(response):
            label = original_parse(response)
            if label.name == "NOT_FOUND":
                lowered = response.lower()
                if '"is_the_agent_response_valid": "valid"' in lowered: return frm_v2.Label.VALID
                if '"is_the_agent_response_valid": "invalid"' in lowered: return frm_v2.Label.INVALID
            return label
        frm_v2._parse_critique = robust_parse
    except: pass

def apply_display_patch():
    def patched_process_metrics(eval_metric_results, print_detailed_results, agent_module):
        import statistics
        from google.adk.evaluation.evaluator import EvalStatus
        failures = []
        for metric_name, results in eval_metric_results.items():
            threshold = results[0].eval_metric_result.threshold
            scores = [m.eval_metric_result.score for m in results if m.eval_metric_result.score is not None]
            overall_score = statistics.mean(scores) if scores else 0.0
            status = EvalStatus.PASSED if overall_score >= threshold else EvalStatus.FAILED
            AgentEvaluator._print_details(results, status, overall_score, metric_name, threshold)
            if status == EvalStatus.FAILED: failures.append(f"{metric_name} failed: got {overall_score} (expected {threshold})")
        return failures
    AgentEvaluator._process_metrics_and_get_failures = staticmethod(patched_process_metrics)

def apply_litellm_debug_patch():
    try:
        import litellm
        from google.adk.models.lite_llm import LiteLlm
        if hasattr(litellm, "_is_yellowstorm_patched"): return
        litellm._is_yellowstorm_patched = True
        
        # Ensure we use proxy keys if configured
        settings = get_settings()
        if settings.LITELLM_API_BASE_URL:
            litellm.api_base = settings.LITELLM_API_BASE_URL
            litellm.api_key = settings.LITELLM_API_SECRET_KEY
            os.environ["LITELLM_API_BASE"] = settings.LITELLM_API_BASE_URL
            os.environ["LITELLM_API_KEY"] = settings.LITELLM_API_SECRET_KEY
        
        orig_acompletion = litellm.acompletion
        async def patched_acompletion(*args, **kwargs):
            # Extract model safely whether it's in args or kwargs
            model_arg = kwargs.get("model")
            if not model_arg and args:
                model_arg = args[0]
                
            model_str = str(model_arg or "").strip()
            if not model_str or model_str in ("/", "None", "None/None") or model_str.startswith("None/"):
                model_str = "gpt-5.4-mini"
            capability_model_str = model_str

            logger.info(f"[ADK LLM CALL START] model: {model_str}")
            
            # Normalize model name for proxy
            if "gpt-4" in model_str.lower() or "mini" in model_str.lower():
                pass 
            
            if "/" not in model_str and not model_str.startswith("azure/"):
                model_str = f"azure/{model_str}"
            
            if "messages" in kwargs:
                kwargs["messages"] = normalize_messages_for_model(
                    capability_model_str, kwargs["messages"]
                )
            elif len(args) > 1:
                args = (
                    args[0],
                    normalize_messages_for_model(capability_model_str, args[1]),
                    *args[2:],
                )
            # If model was passed as the first positional argument, override it
            if args and isinstance(args[0], str):
                args = (model_str,) + args[1:]
            else:
                kwargs["model"] = model_str
            
            kwargs["timeout"] = 300 # Increase timeout for judge
            
            try:
                res = await orig_acompletion(*args, **kwargs)
                return res
            except Exception as e:
                logger.error(f"[ADK LLM ERROR] model={kwargs.get('model')} error={e}")
                raise e
                
        litellm.acompletion = patched_acompletion
        # Also patch litellm.main — ADK may have captured the reference via
        # `from litellm import acompletion` before our patch ran.
        try:
            import litellm.main as _lm
            if not getattr(_lm, "_ys_async_patched", False):
                _lm.acompletion = patched_acompletion
                _lm._ys_async_patched = True
        except Exception:
            pass

        orig_completion = litellm.completion
        def patched_completion(*args, **kwargs):
            model_arg = kwargs.get("model")
            if not model_arg and args:
                model_arg = args[0]
                
            model_str = str(model_arg or "").strip()
            if not model_str or model_str in ("/", "None", "None/None") or model_str.startswith("None/"):
                model_str = "gpt-5.4-mini"
            capability_model_str = model_str

            logger.info(f"[ADK LLM SYNC CALL START] model: {model_str}")
            
            if "/" not in model_str and not model_str.startswith("azure/"):
                model_str = f"azure/{model_str}"
            
            if "messages" in kwargs:
                kwargs["messages"] = normalize_messages_for_model(
                    capability_model_str, kwargs["messages"]
                )
            elif len(args) > 1:
                args = (
                    args[0],
                    normalize_messages_for_model(capability_model_str, args[1]),
                    *args[2:],
                )
            if args and isinstance(args[0], str):
                args = (model_str,) + args[1:]
            else:
                kwargs["model"] = model_str
            
            kwargs["timeout"] = 300
            
            try:
                res = orig_completion(*args, **kwargs)
                return res
            except Exception as e:
                logger.error(f"[ADK LLM SYNC ERROR] model={kwargs.get('model')} error={e}")
                raise e
                
        litellm.completion = patched_completion
        try:
            import litellm.main as _lm
            if not getattr(_lm, "_ys_sync_patched", False):
                _lm.completion = patched_completion
                _lm._ys_sync_patched = True
        except Exception:
            pass
        
    except Exception as e:
        logger.warning(f"Failed to apply LiteLLM patch: {e}")


def apply_litellm_model_guard_patch():
    """
    Patch LiteLlm.__init__ directly so any instance created with an empty or
    invalid model string falls back to a safe default.

    This is the most reliable defence: it works regardless of HOW litellm
    functions were imported, because the guard runs at object construction time.
    """
    _FALLBACK = "gpt-5.4-mini"

    def _safe(model):
        v = str(model or "").strip()
        if not v or v in ("/", "None", "None/None") or v.startswith("None/"):
            logger.warning(f"[ModelGuard] Replacing invalid model '{model}' → '{_FALLBACK}'")
            return _FALLBACK
        return v

    try:
        from google.adk.models.lite_llm import LiteLlm
        if getattr(LiteLlm, "_model_guard_patched", False):
            return

        # Strategy 1: patch __init__ (regular Python class or Pydantic v1)
        try:
            _orig_init = LiteLlm.__init__
            def _safe_init(self, model="", **kwargs):
                _orig_init(self, _safe(model), **kwargs)
            LiteLlm.__init__ = _safe_init
            logger.info("[ModelGuard] Patched LiteLlm.__init__")
        except Exception as e1:
            logger.warning(f"[ModelGuard] __init__ patch failed: {e1}")

        # Strategy 2: patch model property setter if it exists (Pydantic property)
        try:
            model_desc = type(LiteLlm).__dict__.get("model")
            if isinstance(model_desc, property) and model_desc.fset:
                def _safe_setter(self, v):
                    model_desc.fset(self, _safe(v))
                type(LiteLlm).model = property(model_desc.fget, _safe_setter, model_desc.fdel)
                logger.info("[ModelGuard] Patched LiteLlm.model property setter")
        except Exception as e2:
            logger.warning(f"[ModelGuard] property patch failed: {e2}")

        LiteLlm._model_guard_patched = True
        logger.info("[ModelGuard] LiteLlm model guard active")
    except Exception as e:
        logger.warning(f"[ModelGuard] Patch setup failed: {e}")

@dataclass
class EvaluatorDependencies:
    prompt_processor: PromptProcessor
    llm_factory: LLMFactory
    agent_factory: AgentFactory
    agent_helper: AgentHelper
    tool_description_provider: ToolDescriptionProvider
    agent_runner: AgentRunner

class ADKAgentEvaluator:
    def __init__(self, agent_config: Dict[str, Any]):
        self.agent_config = agent_config
        self.agent = None
        self.toolkit = None
        self.deps = self._create_dependencies()

    def _create_dependencies(self):
        pp = PromptProcessor()
        lf = LLMFactory()
        return EvaluatorDependencies(
            prompt_processor=pp, llm_factory=lf,
            agent_factory=AgentFactory(pp, lf),
            agent_helper=AgentHelper(),
            tool_description_provider=ToolDescriptionProvider(),
            agent_runner=AgentRunner(EventExtractor(), MessageTransformer(), StreamingFormatter(), pp)
        )

    def create_agent(self):
        agent_dict = self.agent_config
        tools = agent_dict.get("tools")
        tool_names = extract_tool_names(normalize_tools(tools)) if tools else []
        chatbot_config = agent_dict.get("chatbot_name")
        if isinstance(chatbot_config, dict):
            p, m = chatbot_config.get("provider", ""), chatbot_config.get("model", "")
            chatbot_name = f"{p}/{m}" if p and m else (m or p or "gpt-5.4-mini")
        else: 
            chatbot_name = str(chatbot_config or "").strip()
            
        if chatbot_name == "/" or not chatbot_name:
            chatbot_name = "gpt-5.4-mini"
        
        agent, toolkit = create_agent_for_delegation(
            helper=self.deps.agent_helper, tool_helper=self.deps.tool_description_provider,
            agent_factory=self.deps.agent_factory, config=SimpleNamespace(brain_ids=agent_dict["brain_ids"], vectorstore_name=agent_dict["vectorstore_name"], session_id=agent_dict["session_id"], user_id=agent_dict["user_id"]),
            agent_config=agent_dict, tools=tool_names, base_enhanced_prompt=agent_dict["prompt"],
            expected_output=agent_dict["description"], agent_name=agent_dict["name"], chatbot_name=chatbot_name,
            search_web="search_web" in tool_names, citation_manager=None
        )
        self.agent = agent
        self.toolkit = toolkit
        return agent

    async def invoke_agent(self, message: str) -> str:
        if not self.agent: raise RuntimeError("Agent not created")
        q = Queue()
        result, _, _ = await self.deps.agent_runner.run_agent_tool(
            agent=self.agent, message=message, session_helper=InMemorySessionService(),
            user_id=self.agent_config["user_id"], q=q, task_order="eval_1",
            agent_id=self.agent_config["id"], toolkit=self.toolkit, agent_config=self.agent_config,
            expected_output=self.agent_config["description"]
        )
        return result or ""

async def _save_evaluation_to_db(request, eval_model, summary, detailed_results, status="completed", evaluation_id=None):
    try:
        detailed_results_dict = [r.model_dump() if hasattr(r, "model_dump") else r for r in detailed_results]
        return await EvaluationRepository.save_evaluation_result(
            agent_id=request.agent.id or "unknown", agent_name=request.agent.name,
            session_id=request.session_id, user_id=request.user_id,
            trajectory_match_mode=request.trajectory_match_mode, eval_model=eval_model,
            summary=summary, detailed_results=detailed_results_dict, status=status, evaluation_id=evaluation_id
        )
    except: return None

async def run_adk_evaluation_streaming(request: RunADKEvalRequest, queue: Queue) -> None:
    try:
        logger.info(f"--- PARALLEL EVALUATION STARTING --- runs={request.num_runs}")
        apply_litellm_debug_patch()
        apply_litellm_model_guard_patch()  # Guard LiteLlm.__init__ against empty model
        apply_rationale_patches()
        apply_robust_parsing_patch()
        
        # Determine threshold and judge
        threshold = request.threshold or getattr(request.agent, "threshold", 0.7)
        requested_judge = getattr(request, "judge_model", None) or getattr(request.agent, "judge_model", "gpt-5.4-mini")

        # Resolve judge model ID robustly from str, dict, or fallback
        if isinstance(requested_judge, str):
            judge_model_id = requested_judge.strip()
        elif isinstance(requested_judge, dict):
            _provider = (requested_judge.get("provider") or "").strip()
            _name = (requested_judge.get("name") or "").strip()
            if _provider and _name:
                judge_model_id = f"{_provider}/{_name}"
            elif _name:
                judge_model_id = _name  # name already contains provider e.g. "azure/gpt-5.4-mini"
            elif _provider:
                judge_model_id = _provider
            else:
                judge_model_id = "gpt-5.4-mini"
        else:
            judge_model_id = "gpt-5.4-mini"

        # Safety fallback: catch empty, slash-only, or "None/..." artifacts
        if not judge_model_id or judge_model_id in ("/", "None", "None/None") or judge_model_id.startswith("None/"):
            judge_model_id = "gpt-5.4-mini"
        if "gpt-4" in judge_model_id.lower():
            judge_model_id = "gpt-5.4-mini"
        register_custom_judge(judge_model_id)

        # Early record
        evaluation_id = await _save_evaluation_to_db(request, judge_model_id, None, [], "processing")
        if evaluation_id: await queue.put({"type": "init", "evaluation_id": evaluation_id})

        # Setup EvalSet for single run
        from google.adk.evaluation.eval_case import EvalCase, Invocation, InvocationEvent, InvocationEvents
        from google.genai import types as genai_types
        import uuid
        import time
        from google.adk.evaluation.eval_metrics import HallucinationsCriterion, LlmAsAJudgeCriterion, JudgeModelOptions, BaseCriterion, EvalMetric
        
        eval_cases = [EvalCase(eval_id=f"test_{i+1}", conversation=[Invocation(user_content=genai_types.Content(role="user", parts=[genai_types.Part(text=tc.input['messages'][0]['content'])]))]) for i, tc in enumerate(request.test_cases)]
        eval_set = EvalSet(eval_set_id=f"eval_{uuid.uuid4().hex[:8]}", eval_cases=eval_cases, creation_timestamp=time.time())
        opts = JudgeModelOptions(judge_model=judge_model_id, judge_model_config=genai_types.GenerateContentConfig(temperature=0.0), num_samples=1)
        eval_metrics = [
            EvalMetric(metric_name="hallucinations_v1", threshold=threshold, judge_model_options=opts, criterion=HallucinationsCriterion(threshold=threshold, judge_model_options=opts)),
            EvalMetric(metric_name="final_response_match_v2", threshold=threshold, judge_model_options=opts, criterion=LlmAsAJudgeCriterion(threshold=threshold, judge_model_options=opts)),
            EvalMetric(metric_name="response_match_score", threshold=threshold, criterion=BaseCriterion(threshold=threshold))
        ]

        logger.info(f"Using session_id: {request.session_id}")
        evaluator_wrapper = ADKAgentEvaluator(convert_agent_suggestion_to_dict(request.agent))
        evaluator_wrapper.agent_config.update({"session_id": request.session_id, "user_id": request.user_id})
        agent_instance = evaluator_wrapper.create_agent()

        from google.adk.evaluation.local_eval_service import LocalEvalService
        from google.adk.evaluation.in_memory_eval_sets_manager import InMemoryEvalSetsManager
        from google.adk.evaluation.base_eval_service import InferenceRequest, InferenceConfig, InferenceStatus, EvaluateRequest, EvaluateConfig
        from google.adk.utils.context_utils import Aclosing

        app_name = f"app_{uuid.uuid4().hex[:4]}"
        eval_sets_manager = InMemoryEvalSetsManager()
        eval_sets_manager.create_eval_set(app_name, eval_set.eval_set_id)
        for c in eval_set.eval_cases: eval_sets_manager.add_eval_case(app_name, eval_set.eval_set_id, c)

        # ponytail: ADK 2.x supplies a default user_simulator_provider; the old
        # judge-model override on it was best-effort only, so let the default stand.
        eval_service = LocalEvalService(
            root_agent=agent_instance,
            eval_sets_manager=eval_sets_manager,
        )
        
        inference_results = []
        logger.info(f"Starting inference phase")
        async with Aclosing(eval_service.perform_inference(InferenceRequest(app_name=app_name, eval_set_id=eval_set.eval_set_id, inference_config=InferenceConfig()))) as agen:
            async for res in agen:
                inference_results.append(res)
                await queue.put({"type": "progress", "test_number": int(res.eval_case_id.split("_")[1]) if "_" in res.eval_case_id else 0, "status": "inference_completed"})
        logger.info(f"Inference done, successful={len([r for r in inference_results if r.status == InferenceStatus.SUCCESS])}")

        successful = [r for r in inference_results if r.status == InferenceStatus.SUCCESS]
        all_results = []
        if successful:
            expected_invocations = []
            for res in successful:
                idx = int(res.eval_case_id.split("_")[1]) - 1
                ref_text = request.test_cases[idx].reference_output['messages'][0]['content']
                expected_invocations.append(Invocation(user_content=res.inferences[0].user_content, final_response=genai_types.Content(role="model", parts=[genai_types.Part(text=ref_text)])))
                
                iv = res.inferences[0]
                ref_ev = InvocationEvent(author="system", content=genai_types.Content(role="model", parts=[genai_types.Part(text=f"REFERENCE_CONTEXT: {ref_text}")]))
                if hasattr(iv, "intermediate_data") and isinstance(iv.intermediate_data, InvocationEvents): iv.intermediate_data.invocation_events.append(ref_ev)
                else: iv.intermediate_data = InvocationEvents(invocation_events=[ref_ev])

            logger.info(f"Starting evaluation phase")
            async for case_res in eval_service.evaluate(EvaluateRequest(inference_results=successful, expected_invocations=expected_invocations, evaluate_config=EvaluateConfig(eval_metrics=eval_metrics))):
                idx = int(case_res.eval_id.split("_")[1]) - 1
                m_dict = {m.metric_name: m for m in case_res.overall_eval_metric_results}
                agent_ans = AgentEvaluator._convert_content_to_text(next(r.inferences[0].final_response for r in successful if r.eval_case_id == case_res.eval_id))
                ref_ans = request.test_cases[idx].reference_output['messages'][0]['content']

                def _extract_metric(metric_name, alt_names=[]):
                    metric = m_dict.get(metric_name)
                    if not metric:
                        for alt in alt_names:
                            metric = m_dict.get(alt)
                            if metric: break
                    
                    if not metric: return 0.0, ""
                    
                    score = 0.0
                    reasoning = ""
                    
                    # Score extraction
                    if hasattr(metric, 'score'): score = metric.score
                    elif isinstance(metric, dict) and 'score' in metric: score = metric['score']
                    elif isinstance(metric, (int, float)): score = metric
                    
                    # Reasoning extraction
                    if hasattr(metric, 'reasoning') and metric.reasoning: reasoning = metric.reasoning
                    elif hasattr(metric, 'comment') and metric.comment: reasoning = metric.comment
                    elif isinstance(metric, dict):
                        reasoning = metric.get('reasoning') or metric.get('comment') or ""
                    
                    return float(score) if score is not None else 0.0, str(reasoning) if reasoning is not None else ""

                m_score, m_reason = _extract_metric("final_response_match_v2", ["response_match_v2", "llm_judge", "answer_correctness"])
                h_score, h_reason = _extract_metric("hallucinations_v1", ["hallucination_v1", "hallucinations"])
                r_score, r_reason = _extract_metric("response_match_score", ["semantic_score", "response_match", "answer_similarity"])
                
                passed = (h_score >= threshold and m_score >= threshold)
                test_res = TestResult(
                    id=str(uuid.uuid4()), test_number=idx + 1,
                    question=request.test_cases[idx].input['messages'][0]['content'],
                    reference_answer=ref_ans, agent_answer=agent_ans,
                    response_match_score=r_score,
                    final_response_match_v2={"score": m_score, "reasoning": m_reason},
                    hallucination_score=(1.0 - h_score),
                    hallucinations_v1={"score": (1.0 - h_score), "reasoning": h_reason},
                    passed=passed, status="completed", result="success" if passed else "failed"
                )
                all_results.append(test_res)
                await queue.put({"type": "progress", "test_case": test_res.model_dump()})
        logger.info(f"Evaluation phase done, results={len(all_results)}")

        summary = EvaluationStatisticsCalculator.calculate_summary(detailed_results=all_results, trajectory_match_mode="adk", eval_model=judge_model_id, llm_success_threshold=threshold)
        final_res = EvaluationResult(success=True, agent_name=request.agent.name, total_tests=len(all_results), score=summary.overall.success_rate, summary=summary, details=all_results, detailed_results=all_results, evaluation_id=evaluation_id)
        
        await _save_evaluation_to_db(request, judge_model_id, summary.model_dump(), all_results, "completed", evaluation_id)
        
        final_data = final_res.model_dump()
        final_data["type"] = "completed"
        await queue.put(final_data)

    except Exception as e:
        logger.error(f"Fatal eval error in run_adk_evaluation_streaming: {e}")
        traceback.print_exc()
        try:
            await queue.put({"type": "error", "error": f"Evaluation Setup Error: {str(e)}"})
        except: pass
    finally:
        await queue.put(None)
