import { NotFoundException, ServiceUnavailableException } from '../../exceptions';
import { PlaybookIntentService } from './playbook-intent.service';

describe('PlaybookIntentService', () => {
  const findById = jest.fn();
  const post = jest.fn();
  const getHttpClient = jest.fn();
  const resolveEffectiveSettings = jest.fn();
  const resolveInferenceModel = jest.fn();
  const findByKey = jest.fn();
  const render = jest.fn();

  const service = new PlaybookIntentService(
    { findById } as any,
    { getHttpClient } as any,
    { resolveEffectiveSettings, resolveInferenceModel } as any,
    { findByKey } as any,
    { render } as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    getHttpClient.mockReturnValue({ post });
    resolveEffectiveSettings.mockResolvedValue({
      inferenceModelId: null,
      resolvedInferenceModelId: null,
      nodeSuggestionsMode: 'manual',
      approvalSuggestionMode: 'auto',
    });
    resolveInferenceModel.mockResolvedValue('gpt-test');
    findByKey.mockResolvedValue({ systemTemplate: 'sys', userTemplate: 'user-template' });
    render.mockReturnValue('rendered-user-prompt');
    findById.mockResolvedValue({
      id: 'playbook-1',
      name: 'PB',
      description: 'desc',
      designSettings: {},
      tasks: [{ id: 'task-1', title: 'Task 1', description: 'Step' }],
      edges: [],
    });
  });

  it('falls back to a normalized direct-intent suggestion when the model payload is invalid', async () => {
    post.mockResolvedValue({ data: { choices: [{ message: { content: 'not json' } }] } });

    const result = await service.analyze('playbook-1', { intent: '  Review contract  ' });

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({
      isDirectIntentFallback: true,
      kind: 'single_change',
      operationType: 'create_node',
      summary: 'Review contract',
      task: { title: 'Review contract', description: 'Review contract' },
    });
  });

  it('throws when the selected task cannot be found', async () => {
    await expect(service.analyze('playbook-1', { intent: 'Update', selectedTaskId: 'missing' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws when LiteLLM is unavailable', async () => {
    getHttpClient.mockReturnValue(null);

    await expect(service.analyze('playbook-1', { intent: 'Create step' })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('normalizes workflow plan suggestions with ordered changes and impact', async () => {
    post.mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              suggestions: [{
                kind: 'workflow_plan',
                label: 'Add review workflow',
                summary: 'Creates a short review chain.',
                reason: 'The requested outcome needs more than one step.',
                confidence: 0.84,
                impact: {
                  nodesToCreate: 2,
                  nodesToUpdate: 1,
                  nodesToDelete: 0,
                  edgesToCreate: 2,
                  edgesToDelete: 0,
                  affectedTaskIds: ['task-1'],
                  businessOutcome: 'A complete review flow can be applied in one approval.',
                },
                changes: [
                  {
                    type: 'create_node',
                    nodeRef: 'new-1',
                    anchor: { mode: 'after', targetTaskId: 'task-1', nodeRef: null },
                    task: { title: 'Draft review', description: 'Create a first review.' },
                  },
                  {
                    type: 'create_node',
                    nodeRef: 'new-2',
                    anchor: { mode: 'after', targetTaskId: null, nodeRef: 'new-1' },
                    task: { title: 'Approve review', description: 'Approve the output.' },
                  },
                ],
              }],
            }),
          },
        }],
      },
    });

    const result = await service.analyze('playbook-1', { intent: 'Add review flow', selectedTaskId: 'task-1' });

    expect(result.suggestions[1]).toMatchObject({
      kind: 'workflow_plan',
      label: 'Add review workflow',
      impact: { nodesToCreate: 2, businessOutcome: 'A complete review flow can be applied in one approval.' },
      changes: [
        { type: 'create_node', nodeRef: 'new-1', anchor: { mode: 'after', targetTaskId: 'task-1' } },
        { type: 'create_node', nodeRef: 'new-2', anchor: { mode: 'after', nodeRef: 'new-1' } },
      ],
    });
  });

  it('infers workflow plan suggestions without an explicit kind for update-only plans', async () => {
    post.mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              suggestions: [{
                label: 'Refine existing workflow',
                summary: 'Improves two existing steps without adding new ones.',
                reason: 'The workflow already exists and only needs refinement.',
                confidence: 0.77,
                impact: {
                  nodesToCreate: 0,
                  nodesToUpdate: 2,
                  nodesToDelete: 0,
                  edgesToCreate: 0,
                  edgesToDelete: 0,
                  affectedTaskIds: ['task-1'],
                  businessOutcome: 'The current workflow is refined without structural changes.',
                },
                changes: [
                  {
                    type: 'update_node',
                    targetTaskId: 'task-1',
                    task: { title: 'Task 1 refined', description: 'Sharper execution guidance.' },
                  },
                ],
              }],
            }),
          },
        }],
      },
    });

    const result = await service.analyze('playbook-1', { intent: 'Refine the existing workflow', selectedTaskId: 'task-1' });

    expect(result.suggestions[1]).toMatchObject({
      kind: 'workflow_plan',
      label: 'Refine existing workflow',
      impact: { nodesToCreate: 0, nodesToUpdate: 2 },
      changes: [
        {
          type: 'update_node',
          targetTaskId: 'task-1',
          task: { title: 'Task 1 refined', description: 'Sharper execution guidance.' },
        },
      ],
    });
  });

  it('accepts nodeRef as the target identifier for update-only workflow plan changes', async () => {
    post.mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              suggestions: [{
                kind: 'workflow_plan',
                label: 'Add Tesla comparison workflow',
                summary: 'Updates the workflow to compare MSFT with Tesla.',
                reason: 'The existing workflow is MSFT-specific and needs refinement.',
                confidence: 0.93,
                impact: {
                  nodesToCreate: 0,
                  nodesToUpdate: 3,
                  nodesToDelete: 0,
                  edgesToCreate: 0,
                  edgesToDelete: 0,
                  affectedTaskIds: ['task-1'],
                  businessOutcome: 'Users can run a clear MSFT-vs-Tesla comparison.',
                },
                changes: [
                  {
                    type: 'update_node',
                    nodeRef: 'task-1',
                    task: {
                      title: 'Collect MSFT and Tesla data',
                      description: 'Gather both data sets for correlation analysis.',
                    },
                  },
                ],
              }],
            }),
          },
        }],
      },
    });

    const result = await service.analyze('playbook-1', { intent: 'Compare MSFT with Tesla', selectedTaskId: 'task-1' });

    expect(result.suggestions[1]).toMatchObject({
      kind: 'workflow_plan',
      changes: [
        {
          type: 'update_node',
          targetTaskId: 'task-1',
          task: {
            title: 'Collect MSFT and Tesla data',
            description: 'Gather both data sets for correlation analysis.',
          },
        },
      ],
    });
  });

  it('keeps parallel create-node anchors using targetTaskIds and nodeRefs', async () => {
    post.mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              suggestions: [{
                kind: 'workflow_plan',
                label: 'Create sequential and parallel workflow',
                summary: 'Adds a short chain and a parallel consolidation step.',
                reason: 'The requested workflow needs both sequence and branching.',
                confidence: 0.88,
                impact: {
                  nodesToCreate: 3,
                  nodesToUpdate: 0,
                  nodesToDelete: 0,
                  edgesToCreate: 4,
                  edgesToDelete: 0,
                  affectedTaskIds: ['task-1'],
                  businessOutcome: 'The workflow can fan out and then continue.',
                },
                changes: [
                  {
                    type: 'create_node',
                    nodeRef: 'new-1',
                    anchor: { mode: 'after', targetTaskId: 'task-1', nodeRef: null },
                    task: { title: 'Branch A', description: 'First branch.' },
                  },
                  {
                    type: 'create_node',
                    nodeRef: 'new-2',
                    anchor: { mode: 'after', targetTaskId: 'task-1', nodeRef: null },
                    task: { title: 'Branch B', description: 'Second branch.' },
                  },
                  {
                    type: 'create_node',
                    nodeRef: 'new-3',
                    anchor: { mode: 'after', targetTaskIds: [], nodeRefs: ['new-1', 'new-2'], targetTaskId: null, nodeRef: null },
                    task: { title: 'Consolidate', description: 'Merge both branches.' },
                  },
                ],
              }],
            }),
          },
        }],
      },
    });

    const result = await service.analyze('playbook-1', { intent: 'Create a sequential and parallel workflow', selectedTaskId: 'task-1' });

    expect(result.suggestions[1]).toMatchObject({
      kind: 'workflow_plan',
      changes: [
        { type: 'create_node', nodeRef: 'new-1', anchor: { targetTaskId: 'task-1' } },
        { type: 'create_node', nodeRef: 'new-2', anchor: { targetTaskId: 'task-1' } },
        { type: 'create_node', nodeRef: 'new-3', anchor: { nodeRefs: ['new-1', 'new-2'] } },
      ],
    });
  });
});
