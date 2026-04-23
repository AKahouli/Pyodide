"""
Repository for managing evaluation results in the database.

This module provides a centralized service for storing and retrieving
evaluation results from the dedicated evaluation database.
"""
from typing import Optional, Dict, Any
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.exc import SQLAlchemyError
from src.evaluation.models import Base, EvaluationResult, EvaluationTestCase
from src.config.settings import get_settings
from src.logger.logging import get_logger

logger = get_logger("api.evaluation.repository")


async def dispose_evaluation_engine():
    """
    Dispose evaluation database engine during shutdown.

    This is a convenience function that calls EvaluationRepository.dispose().
    """
    await EvaluationRepository.dispose()


class EvaluationRepository:
    """Repository for managing evaluation results with async database operations."""

    _engine = None
    _session_factory = None

    @classmethod
    async def initialize(cls):
        """Initialize database engine and create tables if needed."""
        if cls._engine is not None:
            logger.info("Evaluation database engine already initialized")
            return

        settings = get_settings()

        # Check if evaluation database URL is configured
        if not getattr(settings, "EVALUATION_DATABASE_URL", None):
            logger.warning(
                "EVALUATION_DATABASE_URL not configured. "
                "Evaluation results will not be persisted to database."
            )
            return

        try:
            logger.info("Initializing evaluation database engine...")

            # Ensure URL uses asyncpg driver
            db_url = settings.EVALUATION_DATABASE_URL
            if db_url.startswith("postgresql://"):
                db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

            # Create async engine with connection pooling
            cls._engine = create_async_engine(
                db_url,
                pool_pre_ping=True,
                pool_recycle=1800,  # 30 minutes
                pool_size=5,
                max_overflow=10,
                pool_timeout=5,
                echo=False,
            )

            # Create session factory
            cls._session_factory = async_sessionmaker(
                bind=cls._engine,
                class_=AsyncSession,
                expire_on_commit=False
			)

            # Create tables if they don't exist
            async with cls._engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)

            logger.info("Evaluation database initialized successfully")

        except Exception as e:
            logger.error(f"Failed to initialize evaluation database: {str(e)}")
            cls._engine = None
            cls._session_factory = None
            raise

    @classmethod
    async def dispose(cls):
        """Dispose database engine during shutdown."""
        if cls._engine is not None:
            logger.info("Disposing evaluation database engine...")
            await cls._engine.dispose()
            cls._engine = None
            cls._session_factory = None
            logger.info("Evaluation database engine disposed")

    @classmethod
    def is_available(cls) -> bool:
        """Check if the evaluation database is available."""
        return cls._engine is not None and cls._session_factory is not None

    @classmethod
    async def save_evaluation_result(
        cls,
        agent_id: str,
        agent_name: str,
        session_id: str,
        user_id: str,
        trajectory_match_mode: str,
        eval_model: str,
        summary: Dict[str, Any],
        detailed_results: list,
        status: str = "completed",
        error_message: Optional[str] = None
    ) -> Optional[str]:
        """
        Save evaluation result to database.

        Args:
            agent_id: ID of the evaluated agent
            agent_name: Name of the evaluated agent
            session_id: Session ID for the evaluation
            user_id: User ID who triggered the evaluation
            trajectory_match_mode: Mode used for trajectory matching
            eval_model: Model used for LLM-as-Judge evaluation
            summary: Dictionary containing evaluation summary metrics
            detailed_results: List of detailed test results
            status: Status of the evaluation (completed, failed, error)
            error_message: Optional error message if evaluation failed

        Returns:
            Optional[str]: The UUID of the saved evaluation result, or None if save failed
        """
        if not cls.is_available():
            logger.warning(
                "Evaluation database not available. "
                "Skipping save for evaluation result."
            )
            return None

        try:
            # Defensive check for summary - allow empty summary for 'processing' status
            if summary is None and status == "completed":
                logger.error("Evaluation summary is None, cannot save results.")
                return None

            # Extract metrics from summary with extreme caution
            overall_summary = summary.get("overall") or {} if summary else {}
            trajectory_summary = summary.get("trajectory_match") or {} if summary else {}
            llm_judge_summary = summary.get("llm_judge") or {} if summary else {}

            # Create evaluation result instance
            eval_result = EvaluationResult(
                agent_id=agent_id,
                agent_name=agent_name,
                session_id=session_id,
                user_id=user_id,
                trajectory_match_mode=trajectory_match_mode,
                eval_model=eval_model,
                total_tests=overall_summary.get("total_tests", 0) if overall_summary else 0,
                overall_success_tests=overall_summary.get("success_tests", 0) if overall_summary else 0,
                overall_failed_tests=overall_summary.get("failed_tests", 0) if overall_summary else 0,
                overall_error_tests=overall_summary.get("error_tests", 0) if overall_summary else 0,
                overall_success_rate=overall_summary.get("success_rate", 0.0) if overall_summary else 0.0,
                trajectory_passed_tests=trajectory_summary.get("passed_tests", 0) if trajectory_summary else 0,
                trajectory_failed_tests=trajectory_summary.get("failed_tests", 0) if trajectory_summary else 0,
                trajectory_success_rate=trajectory_summary.get("success_rate", 0.0) if trajectory_summary else 0.0,
                llm_judge_passed_tests=llm_judge_summary.get("passed_tests", 0) if llm_judge_summary else 0,
                llm_judge_failed_tests=llm_judge_summary.get("failed_tests", 0) if llm_judge_summary else 0,
                llm_judge_success_rate=llm_judge_summary.get("success_rate", 0.0) if llm_judge_summary else 0.0,
                llm_judge_average_score=llm_judge_summary.get("average_score", 0.0) if llm_judge_summary else 0.0,
                llm_judge_average_coherence=overall_summary.get("average_coherence_score", 0.0) if overall_summary else 0.0,
                llm_judge_average_hallucination=overall_summary.get("average_hallucination_score", 0.0) if overall_summary else 0.0,
                llm_judge_average_response_match=overall_summary.get("average_response_match_score", 0.0) if overall_summary else 0.0,
                llm_judge_threshold=llm_judge_summary.get("threshold", 0.7) if llm_judge_summary else 0.7,
                detailed_results=detailed_results if detailed_results else [],
                status=status,
                error_message=error_message
            )

            # Save to database
            async with cls._session_factory() as session:
                # Add evaluation result
                session.add(eval_result)
                await session.flush()  # Flush to get the eval_result.id

                # Create test case records from detailed_results
                for test_detail in detailed_results:
                    evals = test_detail.get("evaluations") or {}
                    trajectory_eval = evals.get("trajectory_match") or {}
                    llm_eval = evals.get("llm_judge") or {}
                    
                    # Extract trajectory match results
                    trajectory_full = trajectory_eval.get("full_result") or {}
                    
                    # Extract LLM judge results
                    llm_full = llm_eval.get("full_result") or {}

                    # Convert boolean score to float for LLM judge if needed
                    llm_score = llm_eval.get("score")
                    if isinstance(llm_score, bool):
                        llm_score = 1.0 if llm_score else 0.0

                    test_case = EvaluationTestCase(
                        evaluation_result_id=eval_result.id,
                        test_number=test_detail.get("test_number", 0),
                        question=test_detail.get("question", ""),
                        reference_answer=test_detail.get("reference_answer", ""),
                        agent_answer=test_detail.get("agent_answer", ""),
                        # Trajectory match fields
                        trajectory_status=trajectory_eval.get("status", "error"),
                        trajectory_score=trajectory_eval.get("score"),
                        trajectory_comment=trajectory_full.get("comment"),
                        trajectory_metadata=trajectory_full.get("metadata"),
                        # LLM judge fields
                        llm_judge_status=llm_eval.get("status", "error"),
                        llm_judge_score=llm_score,
                        llm_judge_reasoning=llm_eval.get("reasoning"),
                        llm_judge_comment=llm_full.get("comment"),
                        llm_judge_metadata=llm_full.get("metadata"),
                        coherence_score=test_detail.get("coherence_score"),
                        hallucination_score=test_detail.get("hallucination_score"),
                        response_match_score=test_detail.get("response_match_score"),
                        # Overall test status
                        test_status=test_detail.get("status", "error")
                    )
                    session.add(test_case)

                # Commit all changes
                await session.commit()
                await session.refresh(eval_result)

                result_id = str(eval_result.id)
                logger.info(
                    f"Evaluation result saved successfully with ID: {result_id} "
                    f"for agent '{agent_name}' with {len(detailed_results)} test cases"
                )
                return result_id

        except SQLAlchemyError as e:
            logger.error(
                f"Database error saving evaluation result for agent '{agent_name}': {str(e)}"
            )
            return None
        except Exception as e:
            logger.error(
                f"Unexpected error saving evaluation result for agent '{agent_name}': {str(e)}"
            )
            return None

    @classmethod
    async def get_evaluation_result(cls, evaluation_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve evaluation result by ID.

        Args:
            evaluation_id: UUID of the evaluation result

        Returns:
            Optional[Dict[str, Any]]: Dictionary containing the evaluation result, or None if not found
        """
        if not cls.is_available():
            logger.warning("Evaluation database not available")
            return None

        try:
            async with cls._session_factory() as session:
                result = await session.get(EvaluationResult, evaluation_id)
                if result:
                    return result.to_dict()
                return None

        except Exception as e:
            logger.error(f"Error retrieving evaluation result {evaluation_id}: {str(e)}")
            return None

    @classmethod
    async def get_evaluations_by_agent(
        cls,
        agent_id: str,
        limit: int = 10
    ) -> list:
        """
        Retrieve recent evaluation results for a specific agent.

        Args:
            agent_id: ID of the agent
            limit: Maximum number of results to return

        Returns:
            list: List of evaluation result dictionaries
        """
        if not cls.is_available():
            logger.warning("Evaluation database not available")
            return []

        try:
            from sqlalchemy import select

            async with cls._session_factory() as session:
                stmt = (
                    select(EvaluationResult)
                    .where(EvaluationResult.agent_id == agent_id)
                    .order_by(EvaluationResult.created_at.desc())
                    .limit(limit)
                )
                result = await session.execute(stmt)
                evaluations = result.scalars().all()
                return [eval.to_dict() for eval in evaluations]

        except Exception as e:
            logger.error(f"Error retrieving evaluations for agent {agent_id}: {str(e)}")
            return []
