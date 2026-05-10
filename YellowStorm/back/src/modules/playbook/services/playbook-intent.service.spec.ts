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
  const findDefaultAgents = jest.fn();
  const findEnabled = jest.fn();

  const service = new PlaybookIntentService(
    { findById } as any,
    { getHttpClient } as any,
    { resolveEffectiveSettings, resolveInferenceModel } as any,
    { findByKey } as any,
    { render } as any,
    { findDefaultAgents } as any,
    { findEnabled } as any,
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
    findDefaultAgents.mockResolvedValue({ data: [{ id: 'agent-1', slug: 'research-agent', name: 'Research Agent', role: 'Research', description: 'Research tasks', agentType: { id: 'type-1', name: 'Research' } }], meta: { total: 1, page: 1, limit: 100, totalPages: 1 } });
    findEnabled.mockResolvedValue({ items: [{ id: 'tpl-1', key: 'report_generation', type: 'report_generation', nodeType: 'agent', title: 'Report Generation', description: 'Generate a report', category: 'generation', inputPorts: [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }], outputPorts: [{ id: 'default', name: 'Output', artifactKind: 'document' }], promptTemplate: '', recommendedAgentTypeSlug: 'research-agent', requiredToolNames: [], executionMode: 'agent', assignedAgentId: null, selectedAction: null, enabled: true, version: 1, isBuiltIn: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] });
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
                    task: { title: 'Draft review', description: 'Create a first review.', agentSlug: 'research-agent' },
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
        { type: 'create_node', nodeRef: 'new-1', anchor: { mode: 'after', targetTaskId: 'task-1' }, task: { agentSlug: 'research-agent' } },
        { type: 'create_node', nodeRef: 'new-2', anchor: { mode: 'after', nodeRef: 'new-1' } },
      ],
    });
  });

  it('passes default agents into prompt rendering context', async () => {
    post.mockResolvedValue({ data: { choices: [{ message: { content: JSON.stringify({ suggestions: [] }) } }] } });

    await service.analyze('playbook-1', { intent: 'Add research step' });

    expect(render).toHaveBeenCalledWith('user-template', expect.objectContaining({
      default_agents: expect.stringContaining('research-agent'),
      node_templates: expect.stringContaining('report_generation'),
    }));
  });

  it('normalizes templateType on created task drafts', async () => {
    post.mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              suggestions: [{
                kind: 'workflow_plan',
                label: 'Add report step',
                summary: 'Adds a report generation step.',
                reason: 'A report is needed.',
                confidence: 0.84,
                impact: {
                  nodesToCreate: 1,
                  nodesToUpdate: 0,
                  nodesToDelete: 0,
                  edgesToCreate: 0,
                  edgesToDelete: 0,
                  affectedTaskIds: [],
                  businessOutcome: 'A reusable report step is added.',
                },
                changes: [
                  {
                    type: 'create_node',
                    nodeRef: 'report_step',
                    anchor: { mode: 'append', targetTaskId: null, nodeRef: null },
                    task: { title: 'Generate Report', description: 'Create the final report.', templateType: 'report_generation' },
                  },
                ],
              }],
            }),
          },
        }],
      },
    });

    const result = await service.analyze('playbook-1', { intent: 'Add a report step' });

    expect(result.suggestions[1]).toMatchObject({
      kind: 'workflow_plan',
      changes: [
        {
          type: 'create_node',
          task: { templateType: 'report_generation' },
        },
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

  it('normalizes delete_edge workflow changes and impact counts', async () => {
    post.mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              suggestions: [{
                kind: 'workflow_plan',
                label: 'Stop using classification in synthesis',
                summary: 'Removes the classification dependency only.',
                reason: 'Classification should not feed synthesis.',
                confidence: 0.9,
                impact: {
                  nodesToCreate: 0,
                  nodesToUpdate: 0,
                  nodesToDelete: 0,
                  edgesToCreate: 0,
                  edgesToDelete: 1,
                  affectedTaskIds: ['task-1', 'task-2'],
                  businessOutcome: 'Synthesis excludes classification.',
                },
                changes: [
                  {
                    type: 'delete_edge',
                    sourceTaskId: 'task-1',
                    targetTaskId: 'task-2',
                  },
                ],
              }],
            }),
          },
        }],
      },
    });

    const result = await service.analyze('playbook-1', { intent: 'Remove classification from synthesis' });

    expect(result.suggestions[1]).toMatchObject({
      kind: 'workflow_plan',
      impact: { edgesToDelete: 1, nodesToDelete: 0 },
      changes: [
        { type: 'delete_edge', sourceTaskId: 'task-1', targetTaskId: 'task-2' },
      ],
    });
  });

  it('normalizes create_edge changes using node refs', async () => {
    post.mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              suggestions: [{
                kind: 'workflow_plan',
                label: 'Reconnect branch into synthesis',
                summary: 'Creates a dependency from a created node into synthesis.',
                reason: 'The new branch should feed synthesis.',
                confidence: 0.86,
                impact: {
                  nodesToCreate: 1,
                  nodesToUpdate: 0,
                  nodesToDelete: 0,
                  edgesToCreate: 1,
                  edgesToDelete: 0,
                  affectedTaskIds: ['task-1'],
                  businessOutcome: 'Synthesis consumes the new branch.',
                },
                changes: [
                  {
                    type: 'create_node',
                    nodeRef: 'new-branch',
                    anchor: { mode: 'append', targetTaskId: 'task-1', nodeRef: null },
                    task: { title: 'New branch', description: 'Collect new evidence.' },
                  },
                  {
                    type: 'create_edge',
                    sourceNodeRef: 'new-branch',
                    targetTaskId: 'task-1',
                  },
                ],
              }],
            }),
          },
        }],
      },
    });

    const result = await service.analyze('playbook-1', { intent: 'Add a branch and connect it back' });

    expect(result.suggestions[1]).toMatchObject({
      kind: 'workflow_plan',
      impact: { edgesToCreate: 1 },
      changes: [
        { type: 'create_node', nodeRef: 'new-branch' },
        { type: 'create_edge', sourceNodeRef: 'new-branch', targetTaskId: 'task-1' },
      ],
    });
  });
});
