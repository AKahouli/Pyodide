import { extractComponentData } from './component-mapper';
import { extractToolUiTargets } from './tool-ui-targets';

const target = { surface: 'semanticModel.editor', params: { modelId: 'model-1', modelName: 'Billing & Contract Management' } };

describe('extractToolUiTargets', () => {
  it('keeps the buttons a tool result asks for, including inside MCP text content', () => {
    const envelope = { ok: true, data: { uiTarget: target, model: { id: 'model-1' } }, meta: { uiTarget: target } };
    expect(extractToolUiTargets(JSON.stringify(envelope))).toEqual([target]);
    const mcp = { content: [{ type: 'text', text: JSON.stringify(envelope) }] };
    expect(extractToolUiTargets(JSON.stringify(mcp))).toEqual([target]);
  });

  it('ignores anything that is not a small, well-formed target', () => {
    expect(extractToolUiTargets('not json')).toEqual([]);
    expect(extractToolUiTargets(JSON.stringify({ uiTarget: { surface: 'x y', params: {} } }))).toEqual([]);
    expect(extractToolUiTargets(JSON.stringify({ uiTarget: { surface: 'ok', params: { modelId: 42 } } }))).toEqual([]);
    expect(extractToolUiTargets(undefined)).toEqual([]);
  });

  it('saves them on the tool activity so they survive without the result', () => {
    const { data } = extractComponentData({
      type: 'toolActivity',
      tool_activity: { tool_name: 'apply_model_changes', status: 'completed', result_json: JSON.stringify({ data: { uiTarget: target } }) },
    });
    expect(data.uiTargets).toEqual([target]);
  });
});
