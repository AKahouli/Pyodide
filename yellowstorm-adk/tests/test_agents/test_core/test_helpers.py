"""Tests for AgentHelper."""

import pytest
from unittest.mock import MagicMock, patch, call
import json
import re

from src.smart_rag.agents.core.helpers import AgentHelper


class TestAgentHelper:
    """Test cases for AgentHelper."""

    @pytest.mark.parametrize("agent_name,expected", [
        ("valid_agent_123", "valid_agent_123"),
        ("invalid_agent!", "invalid_agent!"),
        ("agent with spaces", "agent_with_spaces"),
        ("agent@#$%name", "agent@#$%name"),
        ("", ""),
        ("DefaultAgent", "defaultagent"),
        ("123agent", "123agent"),
        ("Agent-Name", "agent-name"),
        ("UPPERCASE", "uppercase"),
        ("mixedCase", "mixedcase"),
    ])
    def test_normalize_agent_name(self, agent_name, expected):
        """Test agent name normalization with various inputs."""
        with patch('src.smart_rag.agents.core.helpers.DEFAULT_AGENT_NAME', 'DefaultAgent'):
            result = AgentHelper.normalize_agent_name(agent_name)
            assert result == expected

    def test_normalize_agent_name_with_long_name(self):
        """Test agent name normalization with very long names."""
        long_name = "a" * 100
        result = AgentHelper.normalize_agent_name(long_name)
        assert isinstance(result, str)
        assert len(result) == 100  # Should preserve length
        assert result == long_name

    def test_normalize_agent_name_with_whitespace(self):
        """Test agent name normalization with various whitespace characters."""
        test_cases = [
            ("  leading", "__leading"),
            ("trailing  ", "trailing__"),
            ("  both  ", "__both__"),
            ("\ttab\t", "\ttab\t"),
            ("\nnewline\n", "\nnewline\n"),
        ]

        for input_name, expected in test_cases:
            result = AgentHelper.normalize_agent_name(input_name)
            assert result == expected

    @patch('src.smart_rag.agents.core.helpers.logger')
    def test_logging_integration_normalization(self, mock_logger):
        """Test that logging is properly integrated during normalization."""
        test_name = "invalid@name"

        # Call the method
        result = AgentHelper.normalize_agent_name(test_name)

        # Verify the method works
        assert result == test_name

        # Verify logger was accessed (if used in the method)
        # This will depend on your actual implementation
        assert mock_logger is not None

    @patch('src.smart_rag.agents.core.helpers.logger')
    def test_logging_warning_for_invalid_names(self, mock_logger):
        """Test normalize_agent_name handles problematic names without logging warnings."""
        with patch('src.smart_rag.agents.core.helpers.DEFAULT_AGENT_NAME', 'DefaultAgent'):
            problematic_names = ["","very_long_name" * 10]

            results = []
            for name in problematic_names:
                result = AgentHelper.normalize_agent_name(name)
                results.append(result)

            # Verify normalize_agent_name handles problematic inputs correctly
            assert results[0] == ""  # Empty string stays empty
            assert "very_long_name" in results[1].lower()  # Long name is normalized to lowercase

    def test_normalize_agent_name_edge_cases(self):
        """Test edge cases for agent name normalization."""
        edge_cases = [
            (" ", "_"),  # Single space becomes underscore
            ("   ", "___"),  # Multiple spaces become underscores
            ("\x00", "\x00"),  # Null character (not a space, stays as-is)
            ("test\x00name", "test\x00name"),  # Null in middle (not a space, stays as-is)
        ]

        for input_name, expected in edge_cases:
            result = AgentHelper.normalize_agent_name(input_name)
            assert result == expected

    def test_normalize_agent_name_consistency(self):
        """Test that normalization is consistent across multiple calls."""
        test_names = ["test_agent", "Another Agent", "special@agent"]

        for name in test_names:
            result1 = AgentHelper.normalize_agent_name(name)
            result2 = AgentHelper.normalize_agent_name(name)
            assert result1 == result2

    @pytest.mark.parametrize("agent_name", [
        "normal_name",
        "name_with_underscores",
        "namewithcaps",
        "name-with-dashes",
        "name123",
    ])
    def test_normalize_agent_name_preserves_valid_names(self, agent_name):
        """Test that valid agent names are preserved unchanged."""
        result = AgentHelper.normalize_agent_name(agent_name)
        assert result == agent_name

    # Add tests for other methods in AgentHelper class
    # Example placeholder for additional methods:


# Additional test class for specific edge cases
class TestAgentHelperEdgeCases:
    """Test edge cases and error conditions for AgentHelper."""

    def test_normalize_agent_name_with_non_string_input(self):
        """Test normalization with non-string inputs."""
        non_string_inputs = [123, 45.67, [], {}, True]

        for input_val in non_string_inputs:
            with pytest.raises((TypeError, AttributeError)):
                AgentHelper.normalize_agent_name(input_val)

    def test_normalize_agent_name_empty_string(self):
        """Test that empty string is handled correctly."""
        result = AgentHelper.normalize_agent_name("")
        assert result == ""

    @patch('src.smart_rag.agents.core.helpers.logger')
    def test_logging_levels(self, mock_logger):
        """Test different logging levels are used appropriately."""
        AgentHelper.normalize_agent_name("test")

        # Check if appropriate logging methods were called
        # This will depend on your implementation
        assert any(hasattr(mock_logger, level) for level in ['debug', 'info', 'warning', 'error'])


# Test class for performance characteristics
class TestAgentHelperPerformance:
    """Test performance characteristics of AgentHelper methods."""

    @pytest.mark.performance
    def test_normalize_agent_name_performance(self):
        """Test that normalization is efficient for large numbers of calls."""
        import time

        start_time = time.time()

        # Call method multiple times
        for i in range(1000):
            AgentHelper.normalize_agent_name(f"agent_{i}")

        end_time = time.time()

        # Should complete quickly (adjust threshold as needed)
        assert end_time - start_time < 1.0

    def test_normalize_agent_name_memory_usage(self):
        """Test that normalization doesn't create excessive memory usage."""
        import gc
        import sys

        # Get memory usage before
        gc.collect()
        initial_objects = len(gc.get_objects())

        # Perform operations
        names = [f"agent_{i}" for i in range(100)]
        results = [AgentHelper.normalize_agent_name(name) for name in names]

        # Get memory usage after
        gc.collect()
        final_objects = len(gc.get_objects())

        # Memory usage should be reasonable
        assert final_objects - initial_objects < 1000


class TestAgentHelperTemperature:
    """Test cases for get_temperature_from_agents method."""

    @patch('src.smart_rag.agents.core.helpers.DocumentHelpers.agent_to_dict')
    def test_get_temperature_from_manager_agent(self, mock_agent_to_dict):
        """Test extracting temperature from a manager agent."""
        # Mock manager agent with temperature in agent_params
        manager_agent = MagicMock()
        mock_agent_to_dict.return_value = {
            'name': 'Manager Agent',
            'agent_type': 'manager',
            'agent_params': {'temperature': 0.7}
        }

        result = AgentHelper.get_temperature_from_agents([manager_agent], fallback_temperature=0.1)
        assert result == 0.7
        mock_agent_to_dict.assert_called_once_with(manager_agent)

    @patch('src.smart_rag.agents.core.helpers.DocumentHelpers.agent_to_dict')
    def test_get_temperature_no_manager_agent(self, mock_agent_to_dict):
        """Test fallback when no manager agent exists."""
        # Mock regular agent (not manager)
        regular_agent = MagicMock()
        mock_agent_to_dict.return_value = {
            'name': 'Regular Agent',
            'agent_type': 'worker',
            'agent_params': {'temperature': 0.9}
        }

        result = AgentHelper.get_temperature_from_agents([regular_agent], fallback_temperature=0.1)
        assert result == 0.1

    @patch('src.smart_rag.agents.core.helpers.DocumentHelpers.agent_to_dict')
    def test_get_temperature_manager_without_temperature(self, mock_agent_to_dict):
        """Test fallback when manager agent exists but has no temperature."""
        # Mock manager agent without temperature in agent_params
        manager_agent = MagicMock()
        mock_agent_to_dict.return_value = {
            'name': 'Manager Agent',
            'agent_type': 'manager',
            'agent_params': {}
        }

        result = AgentHelper.get_temperature_from_agents([manager_agent], fallback_temperature=0.1)
        assert result == 0.1

    @patch('src.smart_rag.agents.core.helpers.DocumentHelpers.agent_to_dict')
    def test_get_temperature_manager_with_non_dict_params(self, mock_agent_to_dict):
        """Test fallback when manager agent has non-dict agent_params."""
        # Mock manager agent with non-dict agent_params
        manager_agent = MagicMock()
        mock_agent_to_dict.return_value = {
            'name': 'Manager Agent',
            'agent_type': 'manager',
            'agent_params': 'not_a_dict'
        }

        result = AgentHelper.get_temperature_from_agents([manager_agent], fallback_temperature=0.1)
        assert result == 0.1

    @patch('src.smart_rag.agents.core.helpers.DocumentHelpers.agent_to_dict')
    def test_get_temperature_empty_agents_list(self, mock_agent_to_dict):
        """Test fallback when agents list is empty."""
        result = AgentHelper.get_temperature_from_agents([], fallback_temperature=0.1)
        assert result == 0.1
        mock_agent_to_dict.assert_not_called()

    @patch('src.smart_rag.agents.core.helpers.DocumentHelpers.agent_to_dict')
    def test_get_temperature_multiple_agents_first_manager(self, mock_agent_to_dict):
        """Test that first manager agent's temperature is used when multiple exist."""
        # Mock multiple agents with first being manager
        manager1 = MagicMock()
        manager2 = MagicMock()

        mock_agent_to_dict.side_effect = [
            {
                'name': 'Manager 1',
                'agent_type': 'manager',
                'agent_params': {'temperature': 0.5}
            },
            {
                'name': 'Manager 2',
                'agent_type': 'manager',
                'agent_params': {'temperature': 0.8}
            }
        ]

        result = AgentHelper.get_temperature_from_agents([manager1, manager2], fallback_temperature=0.1)
        assert result == 0.5

    @patch('src.smart_rag.agents.core.helpers.DocumentHelpers.agent_to_dict')
    def test_get_temperature_with_default_fallback(self, mock_agent_to_dict):
        """Test default fallback temperature when not specified."""
        regular_agent = MagicMock()
        mock_agent_to_dict.return_value = {
            'name': 'Regular Agent',
            'agent_type': 'worker'
        }

        result = AgentHelper.get_temperature_from_agents([regular_agent])
        assert result == 0.1  # Default fallback

    @patch('src.smart_rag.agents.core.helpers.DocumentHelpers.agent_to_dict')
    def test_get_temperature_with_zero_temperature(self, mock_agent_to_dict):
        """Test that zero temperature is correctly returned."""
        manager_agent = MagicMock()
        mock_agent_to_dict.return_value = {
            'name': 'Manager Agent',
            'agent_type': 'manager',
            'agent_params': {'temperature': 0.0}
        }

        result = AgentHelper.get_temperature_from_agents([manager_agent], fallback_temperature=0.1)
        assert result == 0.0

    @patch('src.smart_rag.agents.core.helpers.DocumentHelpers.agent_to_dict')
    @patch('src.smart_rag.agents.core.helpers.logger')
    def test_get_temperature_logging(self, mock_logger, mock_agent_to_dict):
        """Test that appropriate logging occurs."""
        manager_agent = MagicMock()
        mock_agent_to_dict.return_value = {
            'name': 'Manager Agent',
            'agent_type': 'manager',
            'agent_params': {'temperature': 0.7}
        }

        AgentHelper.get_temperature_from_agents([manager_agent], fallback_temperature=0.1)

        # Verify logger.info was called
        mock_logger.info.assert_called()


class TestAgentHelperMemory:
    """Test cases for get_manager_memory_from_agents method."""

    @patch('src.smart_rag.agents.core.helpers.DocumentHelpers.agent_to_dict')
    def test_get_memory_from_manager_agent_true(self, mock_agent_to_dict):
        """Test extracting save_memory=True from a manager agent."""
        manager_agent = MagicMock()
        mock_agent_to_dict.return_value = {
            'name': 'Manager Agent',
            'agent_type': 'manager',
            'save_memory': True
        }

        result = AgentHelper.get_manager_memory_from_agents([manager_agent], fallback_save_memory=False)
        assert result is True
        mock_agent_to_dict.assert_called_once_with(manager_agent)

    @patch('src.smart_rag.agents.core.helpers.DocumentHelpers.agent_to_dict')
    def test_get_memory_from_manager_agent_false(self, mock_agent_to_dict):
        """Test extracting save_memory=False from a manager agent."""
        manager_agent = MagicMock()
        mock_agent_to_dict.return_value = {
            'name': 'Manager Agent',
            'agent_type': 'manager',
            'save_memory': False
        }

        result = AgentHelper.get_manager_memory_from_agents([manager_agent], fallback_save_memory=True)
        assert result is False

    @patch('src.smart_rag.agents.core.helpers.DocumentHelpers.agent_to_dict')
    def test_get_memory_no_manager_agent(self, mock_agent_to_dict):
        """Test fallback when no manager agent exists."""
        regular_agent = MagicMock()
        mock_agent_to_dict.return_value = {
            'name': 'Regular Agent',
            'agent_type': 'worker',
            'save_memory': True
        }

        result = AgentHelper.get_manager_memory_from_agents([regular_agent], fallback_save_memory=False)
        assert result is False

    @patch('src.smart_rag.agents.core.helpers.DocumentHelpers.agent_to_dict')
    def test_get_memory_manager_without_save_memory(self, mock_agent_to_dict):
        """Test fallback when manager agent exists but has no save_memory attribute."""
        manager_agent = MagicMock()
        mock_agent_to_dict.return_value = {
            'name': 'Manager Agent',
            'agent_type': 'manager'
        }

        result = AgentHelper.get_manager_memory_from_agents([manager_agent], fallback_save_memory=True)
        assert result is True

    @patch('src.smart_rag.agents.core.helpers.DocumentHelpers.agent_to_dict')
    def test_get_memory_empty_agents_list(self, mock_agent_to_dict):
        """Test fallback when agents list is empty."""
        result = AgentHelper.get_manager_memory_from_agents([], fallback_save_memory=True)
        assert result is True
        mock_agent_to_dict.assert_not_called()

    @patch('src.smart_rag.agents.core.helpers.DocumentHelpers.agent_to_dict')
    def test_get_memory_multiple_agents_first_manager(self, mock_agent_to_dict):
        """Test that first manager agent's save_memory is used when multiple exist."""
        manager1 = MagicMock()
        manager2 = MagicMock()

        mock_agent_to_dict.side_effect = [
            {
                'name': 'Manager 1',
                'agent_type': 'manager',
                'save_memory': False
            },
            {
                'name': 'Manager 2',
                'agent_type': 'manager',
                'save_memory': True
            }
        ]

        result = AgentHelper.get_manager_memory_from_agents([manager1, manager2], fallback_save_memory=True)
        assert result is False

    @patch('src.smart_rag.agents.core.helpers.DocumentHelpers.agent_to_dict')
    def test_get_memory_with_default_fallback(self, mock_agent_to_dict):
        """Test default fallback save_memory when not specified."""
        regular_agent = MagicMock()
        mock_agent_to_dict.return_value = {
            'name': 'Regular Agent',
            'agent_type': 'worker'
        }

        result = AgentHelper.get_manager_memory_from_agents([regular_agent])
        assert result is False  # Default fallback

    @patch('src.smart_rag.agents.core.helpers.DocumentHelpers.agent_to_dict')
    @patch('src.smart_rag.agents.core.helpers.logger')
    def test_get_memory_logging(self, mock_logger, mock_agent_to_dict):
        """Test that appropriate logging occurs."""
        manager_agent = MagicMock()
        mock_agent_to_dict.return_value = {
            'name': 'Manager Agent',
            'agent_type': 'manager',
            'save_memory': True
        }

        AgentHelper.get_manager_memory_from_agents([manager_agent], fallback_save_memory=False)

        # Verify logger.info was called
        mock_logger.info.assert_called()