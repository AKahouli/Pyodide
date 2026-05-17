from src.flow_engine.nodes.step_prompt import build_step_prompt


class TestStepPrompt:
    def test_build_prompt_includes_prompt_contract_sections(self):
        prompt = build_step_prompt(
            label="Draft summary",
            node_id="step-1",
            node_description="Write an executive summary using the resolved inputs.",
            input_context={"brief": "Quarterly results", "tone": "concise"},
            output_contract={
                "raw": "Return JSON",
                "ports": [{"id": "summary", "label": "Summary", "type": "text", "required": True}],
            },
            iteration=2,
            trigger_context={"email": {"subject": "Q2 review"}},
        )

        assert "Task Title:\nDraft summary" in prompt
        assert "Task Node ID:\nstep-1" in prompt
        assert "Task Description:\nWrite an executive summary using the resolved inputs." in prompt
        assert 'Resolved Inputs:\n{\n  "brief": "Quarterly results"' in prompt
        assert 'Trigger Context:\n{\n  "email": {' in prompt
        assert 'Output Contract:\n{\n  "raw": "Return JSON"' in prompt
        assert "Iteration:\n2" in prompt
        assert "Complete this node using only the resolved input data and declared output contract." in prompt

    def test_build_prompt_omits_duplicate_trigger_context(self):
        prompt = build_step_prompt(
            label="Draft summary",
            node_id="step-1",
            input_context={"brief": "Quarterly results"},
            trigger_context={"brief": "Quarterly results"},
        )

        assert "Trigger Context:" not in prompt
