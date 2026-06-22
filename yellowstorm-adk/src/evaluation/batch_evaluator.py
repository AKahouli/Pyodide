"""Service for batch evaluation of agents using the ADK evaluation pipeline.

This module wraps the streaming evaluation pipeline from agent_evaluator.py
into a synchronous batch execution model, collecting all results and returning
them as a complete response.
"""

import asyncio
import uuid
from asyncio import Queue
from datetime import datetime
from typing import List, Dict, Any, Optional, Callable

from src.logger.logging import get_logger
from src.schema.evaluator import RunADKEvalRequest
from src.schema.chatbot_schema import AgentSuggestion
from src.evaluation.agent_evaluator import run_adk_evaluation_streaming

logger = get_logger("api.evaluation.batch_evaluator")


class BatchEvaluator:
    """Service to run batch evaluations using the ADK evaluation pipeline.
    
    Instead of reimplementing evaluation logic, this class delegates to
    run_adk_evaluation_streaming (the proven pipeline) and collects
    results from the async queue into a final synchronous response.
    """

    async def run_evaluation(
        self,
        agent_config: dict,
        dataset: List[Dict[str, str]],
        num_runs: int = 1,
        mode: str = "non_strict",
        judge_model: Optional[Dict[str, str]] = None,
        threshold: float = 0.7,
        user_id: str = "batch_user",
        session_id: Optional[str] = None,
        on_progress: Optional[Callable] = None,
    ) -> Dict[str, Any]:
        """Run a complete evaluation using the ADK pipeline.
        
        Args:
            agent_config: Agent configuration dict (from NestJS buildAgentsForStream)
            dataset: List of {"question": ..., "reference_answer": ...}
            num_runs: Number of evaluation iterations
            mode: Evaluation mode (strict / non_strict)
            judge_model: Judge model config {"name": ..., "provider": ...}
            threshold: Success threshold (0.0 to 1.0)
            user_id: User ID for the evaluation
            session_id: Optional session ID
            on_progress: Optional callback for progress updates
            
        Returns:
            Complete evaluation result dict with scores, details, and summary
        """
        logger.info(f"Starting batch evaluation for agent '{agent_config.get('name', 'unknown')}' "
                     f"with {len(dataset)} test cases, {num_runs} run(s)")

        # Build the RunADKEvalRequest from the batch parameters
        # Transform dataset items into ADK test_cases format
        test_cases = []
        for item in dataset:
            test_cases.append({
                "input": {"messages": [{"role": "user", "content": item["question"]}]},
                "reference_output": {"messages": [{"role": "assistant", "content": item["reference_answer"]}]},
            })

        # Build AgentSuggestion from agent_config dict
        agent_suggestion = AgentSuggestion(**agent_config) if isinstance(agent_config, dict) else agent_config

        # Run evaluation for each run iteration
        all_detailed_results = []
        final_summary = None
        final_score = 0
        final_agent_name = agent_config.get("name", "unknown")
        evaluation_id = None

        for run_index in range(num_runs):
            logger.info(f"--- Starting run {run_index + 1}/{num_runs} ---")
            
            run_session_id = f"eval_batch_{uuid.uuid4().hex[:8]}_run_{run_index + 1}"
            
            adk_request = RunADKEvalRequest(
                agent=agent_suggestion,
                test_cases=test_cases,
                trajectory_match_mode=mode,
                session_id=run_session_id,
                user_id=user_id,
                threshold=threshold,
                num_runs=1,  # Always 1 per run - we handle multi-runs here
                judge_model=judge_model,
            )

            # Use a queue to collect results from the streaming pipeline
            queue: Queue = Queue()
            
            # Run the streaming evaluation in background
            eval_task = asyncio.create_task(run_adk_evaluation_streaming(adk_request, queue))

            # Collect all results from the queue
            run_final_result = None
            error_msg = None

            try:
                while True:
                    event = await asyncio.wait_for(queue.get(), timeout=600)  # 10 min timeout
                    if event is None:
                        break  # Sentinel: evaluation finished

                    event_type = event.get("type", "")
                    
                    if event_type == "progress" and on_progress:
                        # Tag progress and test_case with run index for frontend consistency
                        run_idx = run_index + 1
                        event["run_index"] = run_idx
                        event["runIndex"] = run_idx # CamelCase for frontend
                        if "test_case" in event:
                            event["test_case"]["run_index"] = run_idx
                            event["test_case"]["runIndex"] = run_idx
                        await on_progress(event)
                    
                    if event_type == "completed" or event_type == "final":
                        run_final_result = event
                    elif event_type == "error":
                        error_msg = event.get("error", "Unknown evaluation error")
            except asyncio.TimeoutError:
                error_msg = f"Run {run_index + 1} timed out after 10 minutes"
                logger.error(error_msg)
            
            # Ensure the background task is done
            if not eval_task.done():
                eval_task.cancel()
                try:
                    await eval_task
                except asyncio.CancelledError:
                    current = asyncio.current_task()
                    if current is not None and current.cancelling() > 0:
                        raise

            if error_msg:
                logger.error(f"Run {run_index + 1} failed: {error_msg}")
                continue  # Skip this run, try次の

            if run_final_result:
                # Collect detailed results and tag them with run_index
                run_details = run_final_result.get("detailed_results") or run_final_result.get("details") or []
                for detail in run_details:
                    d = detail if isinstance(detail, dict) else (detail.model_dump() if hasattr(detail, "model_dump") else detail)
                    d["run_index"] = run_index + 1
                    all_detailed_results.append(d)
                
                final_summary = run_final_result.get("summary")
                final_score = run_final_result.get("score", 0)
                final_agent_name = run_final_result.get("agent_name", final_agent_name)
                evaluation_id = run_final_result.get("evaluation_id", evaluation_id)
                
                logger.info(f"Run {run_index + 1} completed: {len(run_details)} test results, score={final_score}")

        # Build final aggregated response
        if not all_detailed_results:
            return {
                "status": "failed",
                "error": "All evaluation runs failed",
                "results": [],
            }

        # Calculate aggregated score across all runs
        scored_count = 0
        total_score = 0
        for d in all_detailed_results:
            frm = d.get("final_response_match_v2", {})
            s = frm.get("score", 0) if isinstance(frm, dict) else 0
            if isinstance(s, (int, float)):
                total_score += s
                scored_count += 1
        mean_score = total_score / scored_count if scored_count > 0 else 0

        logger.info(f"Batch evaluation completed: {len(all_detailed_results)} total test results "
                     f"across {num_runs} run(s), mean score={mean_score:.3f}")

        return {
            "status": "completed",
            "results": self._transform_results_from_details(all_detailed_results),
            "summary": final_summary,
            "score": mean_score,
            "total_tests": len(all_detailed_results),
            "agent_name": final_agent_name,
            "evaluation_id": evaluation_id,
        }

    def _transform_results_from_details(self, details: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Transform ADK detail results into the format expected by the NestJS backend.
        
        The NestJS backend expects results as a list of iteration results with:
        - iterationIndex, question, agentAnswer, referenceAnswer
        - responseMatchScore: {score, reasoning}
        - finalResponseMatchV2: {score, reasoning}
        - hallucinationsV1: {score, reasoning}
        - timestamp, runIndex
        """
        transformed = []
        
        for detail in details:
            # Handle both dict and Pydantic model
            d = detail if isinstance(detail, dict) else detail.model_dump() if hasattr(detail, "model_dump") else detail
            
            # Extract scores robustly
            frm_v2 = d.get("final_response_match_v2", {})
            hallu = d.get("hallucinations_v1", {})
            
            transformed.append({
                "iterationIndex": d.get("test_number", 0),
                "question": d.get("question", ""),
                "agentAnswer": d.get("agent_answer", ""),
                "referenceAnswer": d.get("reference_answer", ""),
                "responseMatchScore": {
                    "score": d.get("response_match_score", 0) if isinstance(d.get("response_match_score"), (int, float)) else (d.get("response_match_score", {}).get("score", 0) if isinstance(d.get("response_match_score"), dict) else 0),
                    "reasoning": ""
                },
                "finalResponseMatchV2": {
                    "score": frm_v2.get("score", 0) if isinstance(frm_v2, dict) else 0,
                    "reasoning": frm_v2.get("reasoning", "") if isinstance(frm_v2, dict) else ""
                },
                "hallucinationsV1": {
                    "score": hallu.get("score", 0) if isinstance(hallu, dict) else 0,
                    "reasoning": hallu.get("reasoning", "") if isinstance(hallu, dict) else ""
                },
                "timestamp": d.get("timestamp", datetime.now().isoformat()),
                "runIndex": d.get("runIndex") or d.get("run_index", 1),
            })
        
        return transformed
