"""
Database models for storing evaluation results.

This module defines SQLAlchemy models for persisting evaluation data
to a dedicated evaluation database.
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, JSON, Text, ForeignKey, Boolean
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.dialects.postgresql import UUID
import uuid

Base = declarative_base()


class EvaluationResult(Base):
    """Model for storing evaluation results in the database."""

    __tablename__ = 'evaluation_results'

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Evaluation metadata
    agent_id = Column(String(255), nullable=False, index=True)
    agent_name = Column(String(255), nullable=False, index=True)
    session_id = Column(String(255), nullable=False, index=True)
    user_id = Column(String(255), nullable=False, index=True)

    # Evaluation configuration
    trajectory_match_mode = Column(String(50), nullable=False)
    eval_model = Column(String(100), nullable=False)

    # Summary metrics
    total_tests = Column(Integer, nullable=False)
    overall_success_tests = Column(Integer, nullable=False)
    overall_failed_tests = Column(Integer, nullable=False)
    overall_error_tests = Column(Integer, nullable=False)
    overall_success_rate = Column(Float, nullable=False)

    # Trajectory match metrics
    trajectory_passed_tests = Column(Integer, nullable=False)
    trajectory_failed_tests = Column(Integer, nullable=False)
    trajectory_success_rate = Column(Float, nullable=False)

    # LLM judge metrics
    llm_judge_passed_tests = Column(Integer, nullable=False)
    llm_judge_failed_tests = Column(Integer, nullable=False)
    llm_judge_success_rate = Column(Float, nullable=False)
    llm_judge_average_score = Column(Float, nullable=False)
    llm_judge_average_coherence = Column(Float, nullable=False, default=0.0)
    llm_judge_average_hallucination = Column(Float, nullable=False, default=0.0)
    llm_judge_average_response_match = Column(Float, nullable=False, default=0.0)
    llm_judge_threshold = Column(Float, nullable=False)

    # Detailed results stored as JSONB for complex queries
    detailed_results = Column(JSON, nullable=False)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Optional fields for additional context
    error_message = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default='completed', index=True)  # completed, failed, error

    # Relationship to test cases
    test_cases = relationship(
        "EvaluationTestCase",
        back_populates="evaluation_result",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    def __repr__(self):
        return (
            f"<EvaluationResult(id={self.id}, agent_name='{self.agent_name}', "
            f"total_tests={self.total_tests}, success_rate={self.overall_success_rate:.2f}%)>"
        )

    def to_dict(self, include_test_cases: bool = True):
        """Convert model instance to dictionary.

        Args:
            include_test_cases: If True, includes test cases in the response
        """
        result = {
            'id': str(self.id),
            'agent_id': self.agent_id,
            'agent_name': self.agent_name,
            'session_id': self.session_id,
            'user_id': self.user_id,
            'trajectory_match_mode': self.trajectory_match_mode,
            'eval_model': self.eval_model,
            'total_tests': self.total_tests,
            'overall_success_tests': self.overall_success_tests,
            'overall_failed_tests': self.overall_failed_tests,
            'overall_error_tests': self.overall_error_tests,
            'overall_success_rate': self.overall_success_rate,
            'trajectory_passed_tests': self.trajectory_passed_tests,
            'trajectory_failed_tests': self.trajectory_failed_tests,
            'trajectory_success_rate': self.trajectory_success_rate,
            'llm_judge_passed_tests': self.llm_judge_passed_tests,
            'llm_judge_failed_tests': self.llm_judge_failed_tests,
            'llm_judge_success_rate': self.llm_judge_success_rate,
            'llm_judge_average_score': self.llm_judge_average_score,
            'llm_judge_average_coherence': self.llm_judge_average_coherence,
            'llm_judge_average_hallucination': self.llm_judge_average_hallucination,
            'llm_judge_average_response_match': self.llm_judge_average_response_match,
            'llm_judge_threshold': self.llm_judge_threshold,
            'detailed_results': self.detailed_results,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'error_message': self.error_message,
            'status': self.status
        }

        if include_test_cases and self.test_cases:
            result['test_cases'] = [tc.to_dict() for tc in self.test_cases]

        return result


class EvaluationTestCase(Base):
    """Model for storing individual test case results."""

    __tablename__ = 'evaluation_test_cases'

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Foreign key to evaluation result
    evaluation_result_id = Column(
        UUID(as_uuid=True),
        ForeignKey('evaluation_results.id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )

    # Test case information
    test_number = Column(Integer, nullable=False)
    question = Column(Text, nullable=False)
    reference_answer = Column(Text, nullable=False)
    agent_answer = Column(Text, nullable=False)

    # Trajectory match evaluation
    trajectory_status = Column(String(20), nullable=False)  # success, failed, error
    trajectory_score = Column(Boolean, nullable=True)
    trajectory_comment = Column(Text, nullable=True)
    trajectory_metadata = Column(JSON, nullable=True)

    # LLM judge evaluation
    llm_judge_status = Column(String(20), nullable=False)  # success, failed, error
    llm_judge_score = Column(Float, nullable=True)
    llm_judge_reasoning = Column(Text, nullable=True)
    llm_judge_comment = Column(Text, nullable=True)
    llm_judge_metadata = Column(JSON, nullable=True)
    coherence_score = Column(Float, nullable=True)
    hallucination_score = Column(Float, nullable=True)
    response_match_score = Column(Float, nullable=True)

    # Overall test status
    test_status = Column(String(20), nullable=False, index=True)  # success, failed, error

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationship to parent evaluation result
    evaluation_result = relationship("EvaluationResult", back_populates="test_cases")

    def __repr__(self):
        return (
            f"<EvaluationTestCase(id={self.id}, test_number={self.test_number}, "
            f"status='{self.test_status}', evaluation_result_id={self.evaluation_result_id})>"
        )

    def to_dict(self):
        """Convert model instance to dictionary."""
        return {
            'id': str(self.id),
            'evaluation_result_id': str(self.evaluation_result_id),
            'test_number': self.test_number,
            'question': self.question,
            'reference_answer': self.reference_answer,
            'agent_answer': self.agent_answer,
            'trajectory_match': {
                'status': self.trajectory_status,
                'score': self.trajectory_score,
                'comment': self.trajectory_comment,
                'metadata': self.trajectory_metadata
            },
            'llm_judge': {
                'status': self.llm_judge_status,
                'score': self.llm_judge_score,
                'reasoning': self.llm_judge_reasoning,
                'comment': self.llm_judge_comment,
                'metadata': self.llm_judge_metadata,
                'coherence_score': self.coherence_score,
                'hallucination_score': self.hallucination_score,
                'response_match_score': self.response_match_score
            },
            'test_status': self.test_status,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
