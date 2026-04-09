import asyncio
import json
import uuid
from typing import Dict, Any, List
from pydantic import BaseModel

# Mocking parts of the system for standalone test
class MockQueue:
    def __init__(self):
        self.messages = []
    async def put(self, msg):
        if msg is not None:
            print(f"[QUEUE] Got message: {msg.get('type', 'data')}")
            self.messages.append(msg)

# Simple test to verify the logic in a controlled environment
async def test_logic():
    print("Testing Evaluation Denominator Logic...")
    
    # Simulate a request with 5 test cases
    test_cases = [{"input": {"messages": [{"content": f"Q{i}"}]}, "reference_output": {"messages": [{"content": f"A{i}"}]}} for i in range(5)]
    
    # Simulate results_map having 2 successes (tests 1 and 2)
    # The other 3 failed inference
    results_map = {
        "test_1": {"status": "success", "semantic_score": 90.0},
        "test_2": {"status": "success", "semantic_score": 95.0}
    }
    
    # This block is what I just implemented in agent_evaluator.py
    detailed_results = []
    for i in range(len(test_cases)):
        cid = f"test_{i+1}"
        if cid in results_map:
            detailed_results.append(results_map[cid])
        else:
            failed_res = {
                "test_number": i + 1,
                "status": "failed",
                "semantic_score": 0.0
            }
            detailed_results.append(failed_res)
            
    total_tests = len(detailed_results)
    success_tests = sum(1 for r in detailed_results if r["status"] == "success")
    success_rate = (success_tests / total_tests * 100) if total_tests > 0 else 0.0
    
    print(f"Total Tests: {total_tests}")
    print(f"Success Tests: {success_tests}")
    print(f"Success Rate: {success_rate}%")
    
    assert total_tests == 5
    assert success_rate == 40.0
    print("Logic Test PASSED!")

if __name__ == "__main__":
    asyncio.run(test_logic())
