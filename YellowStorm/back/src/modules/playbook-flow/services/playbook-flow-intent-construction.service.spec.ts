import { PlaybookFlowIntentConstructionService } from './playbook-flow-intent-construction.service';

describe('PlaybookFlowIntentConstructionService', () => {
  function createService(): PlaybookFlowIntentConstructionService {
    return new PlaybookFlowIntentConstructionService({
      normalizeConstructionSuggestions: jest.fn().mockReturnValue([]),
    } as any);
  }

  it('uses the default large workflow limit during realtime construction normalization', () => {
    const normalizeConstructionSuggestions = jest.fn().mockReturnValue([]);
    const service = new PlaybookFlowIntentConstructionService({
      normalizeConstructionSuggestions,
    } as any);

    (service as any).normalizeRawSuggestions(
      '{"suggestions":[]}',
      { intent: 'build a large workflow' },
      {
        selectedNodeId: null,
        limits: {
          maxWorkflowPlanChanges: 50,
          maxInputPorts: 4,
          maxOutputPorts: 4,
          maxIteratorBodySteps: 12,
          maxIteratorBodyEdges: 50,
        },
        validationContext: {},
      },
    );

    expect(normalizeConstructionSuggestions).toHaveBeenCalledWith(expect.objectContaining({
      limits: expect.objectContaining({ maxWorkflowPlanChanges: 500 }),
    }));
  });

  it('reads a final chat completion stream line without a trailing newline', async () => {
    const service = createService();
    const payload = JSON.stringify({ choices: [{ delta: { content: 'tail content' } }] });
    const stream = [Buffer.from(`data: ${payload}`)];

    const chunks: string[] = [];
    for await (const content of (service as any).readChatCompletionStream(stream)) {
      chunks.push(content);
    }

    expect(chunks).toEqual(['tail content']);
  });
});
