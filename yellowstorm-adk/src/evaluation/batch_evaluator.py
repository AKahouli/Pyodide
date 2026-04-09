"""Service for batch evaluation of agents using AgentEvaluator."""

import asyncio
from datetime import datetime
from typing import List, Dict, Any, Optional
from google.adk.evaluation.agent_evaluator import AgentEvaluator
from google.adk.evaluation.eval_metrics import PrebuiltMetrics, ToolTrajectoryCriterion
from google.adk import Agent

from src.logger.logging import get_logger
from src.schema.evaluation_schema import EvaluationBatchRequest, EvaluationIterationResult, MetricResult
from src.smart_rag.core.single_agent_service import SingleAgentService
from src.schema.chatbot_schema import RunSingleAgentRequest, AgentSuggestion

logger = get_logger("api.evaluation.batch_evaluator")

class BatchEvaluator:
    """Service to run batch evaluations using ADK AgentEvaluator."""

    def __init__(self):
        self.single_agent_service = SingleAgentService()

    async def run_batch_evaluation(
        self, 
        request: EvaluationBatchRequest, 
        user_id: str,
        on_progress = None
    ) -> List[EvaluationIterationResult]:
        """
        Run a batch evaluation for an agent.
        """
        logger.info(f"Starting batch evaluation for agent {request.agent_id}")
        
        # 1. Prepare Agent
        # In a real scenario, we would fetch the agent config from a database.
        # For now, we assume the agent configuration is part of the request or handled by SingleAgentService.
        # This is a bit tricky because AgentEvaluator needs an initialized Agent object.
        
        # Mock request for agent creation
        # We need to adapt this to how agents are actually stored/retrieved.
        # For now, let's assume we can create it.
        
        # 2. Format Dataset for AgentEvaluator
        # AgentEvaluator expects: [{"question": "...", "reference_answer": "..."}]
        formatted_dataset = [
            {"question": item.question, "reference_answer": item.reference_answer}
            for item in request.dataset
        ]

        # 3. Define Metrics
        # Mapping my internal modes to ADK ToolTrajectoryCriterion.MatchType
        traj_mode = ToolTrajectoryCriterion.MatchType.EXACT if request.mode == "strict" else ToolTrajectoryCriterion.MatchType.ANY_ORDER
        
        metrics = [
            PrebuiltMetrics.RESPONSE_MATCH_SCORE,
            PrebuiltMetrics.FINAL_RESPONSE_MATCH_V2,
            PrebuiltMetrics.HALLUCINATIONS_V1,
            # We can also add trajectery eval if needed
            (PrebuiltMetrics.TOOL_TRAJECTORY_AVG_SCORE, traj_mode)
        ]

        results = []
        
        # 4. Run Iterations
        for i in range(request.num_runs):
            logger.info(f"Running iteration {i+1}/{request.num_runs}")
            
            # Reset agent state/memory if needed for each run
            # For each iteration, we run the evaluator over the whole dataset
            
            # NOTE: AgentEvaluator.evaluate_dataset is synchronous in some ADK versions, 
            # but we should check if it can be run per question to provide better progress.
            
            # Re-creating the agent for each run to ensure clean state
            # This is a simplification.
            agent = await self._get_agent_instance(request.agent_config, user_id)
            if not agent:
                raise ValueError(f"Could not initialize agent {request.agent_id}")

            evaluator = AgentEvaluator(agent=agent, dataset=formatted_dataset, metrics=metrics)
            
            # Run evaluation (this might be slow)
            # We wrap it in a thread if it's blocking
            loop = asyncio.get_event_loop()
            eval_summary = await loop.run_in_executor(None, evaluator.evaluate_dataset)
            
            # 5. Process Results
            # eval_summary.results is usually a list of results (one per question)
            # We aggregate or return the summary per iteration
            
            # For simplicity, we take the average scores of this run
            avg_scores = self._calculate_average_scores(eval_summary)
            
            iteration_result = EvaluationIterationResult(
                iterationIndex=i + 1,
                responseMatchScore=MetricResult(score=avg_scores.get("response_match_score", 0.0)),
                finalResponseMatchV2=MetricResult(score=avg_scores.get("final_response_match_v2", 0.0)),
                hallucinationsV1=MetricResult(score=avg_scores.get("hallucinations_v1", 0.0)),
                timestamp=datetime.now().isoformat()
            )
            
            results.append(iteration_result)
            
            if on_progress:
                await on_progress(iteration_result)

        return results

    async def _get_agent_instance(self, agent_config: AgentSuggestion, user_id: str) -> Optional[Agent]:
        """
        Retrieves an ADK Agent instance using the provided configuration.
        """
        try:
            # We create a mock request to reuse SingleAgentService logic if possible
            # But it's better to just implement the relevant parts here or make it a utility
            
            # For this POC, we'll use a simplified version of agent creation
            # similar to what's in SingleAgentService
            
            # 1. Create RunSingleAgentRequest-like object
            from src.schema.chatbot_schema import RunSingleAgentRequest
            mock_request = RunSingleAgentRequest(
                user_id=user_id,
                session_id="eval_session",
                message="eval",
                agent=agent_config
            )
            
            agent = await self.single_agent_service._create_agent_from_request(mock_request)
            return agent
        except Exception as e:
            logger.error(f"Failed to create agent instance for evaluation: {str(e)}")
            return None

    def _calculate_average_scores(self, eval_summary) -> Dict[str, float]:
        """Aggrège les scores d'un eval_summary."""
        # Simple implementation based on AgentEvaluator output structure
        scores = {
            "response_match_score": 0.0,
            "final_response_match_v2": 0.0,
            "hallucinations_v1": 0.0
        }
        
        if not eval_summary.results:
            return scores
            
        count = len(eval_summary.results)
        for res in eval_summary.results:
            # ADK result structure usually has a metrics dict
            m = res.metrics
            scores["response_match_score"] += m.get(PrebuiltMetrics.RESPONSE_MATCH_SCORE, 0.0)
            scores["final_response_match_v2"] += m.get(PrebuiltMetrics.FINAL_RESPONSE_MATCH_V2, 0.0)
            scores["hallucinations_v1"] += m.get(PrebuiltMetrics.HALLUCINATIONS_V1, 0.0)
            
        for k in scores:
            scores[k] /= count
            
        return scores
