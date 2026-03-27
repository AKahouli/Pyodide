"""Parallel processing prompt enhancements for manager agents.

This module provides prompt additions that instruct AI models to use
delegation functions in parallel for improved performance.
"""


def get_parallel_execution_prompt() -> str:
    """Get prompt instructions for parallel agent execution.

    Returns:
        str: Prompt text that instructs the model to use parallel execution
    """
    return """

## Parallel Execution Guidelines

When users ask for multiple pieces of information or tasks, ALWAYS call delegation functions in parallel to improve response time and efficiency.

### Examples of Parallel Execution:

1. **Multiple independent searches:**
   - User: "Get information about product A and product B"
   - Action: Call delegate functions for both products SIMULTANEOUSLY

2. **Different types of operations:**
   - User: "Search for sales data and calculate the total revenue"
   - Action: Call search and calculation delegation functions IN PARALLEL

3. **Analyzing multiple entities:**
   - User: "Compare company X and company Y"
   - Action: Call delegation functions for both companies AT THE SAME TIME

4. **Multiple document lookups:**
   - User: "What do documents A, B, and C say about the topic?"
   - Action: Call delegation functions for all three documents CONCURRENTLY

### When to Use Parallel Execution:

- Always prefer calling multiple delegation functions simultaneously when tasks are INDEPENDENT
- If task B doesn't need results from task A, execute them in PARALLEL
- Batch similar requests (e.g., multiple searches) and execute IN PARALLEL
- For data gathering from multiple sources, use CONCURRENT delegation

### When NOT to Use Parallel Execution:

- When task B requires the output of task A (sequential dependency)
- When a single complex task needs focused attention
- When the user explicitly requests sequential processing

### Performance Benefits:

Parallel execution can reduce total response time by 2-5x for multi-task requests.
Always look for opportunities to parallelize independent operations.
"""


def get_agent_coordination_prompt() -> str:
    """Get prompt for coordinating multiple agents efficiently.

    Returns:
        str: Prompt text for agent coordination
    """
    return """

## Multi-Agent Coordination Strategy

When coordinating multiple specialized agents:

1. **Identify Independent Tasks**: Break down the user request into independent subtasks
2. **Batch Similar Operations**: Group similar tasks together for parallel execution
3. **Delegate Appropriately**: Assign each task to the most suitable specialized agent
4. **Execute in Parallel**: Call delegation functions simultaneously for independent tasks
5. **Synthesize Results**: Combine agent responses into a coherent final answer

Remember: The goal is to minimize total latency by maximizing parallelization of independent operations.
"""