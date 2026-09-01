import { PlaybookFlowController } from './playbook-flow.controller';

describe('PlaybookFlowController input contract', () => {
  it('derives the contract only after the access-scoped base read', async () => {
    const flow = {
      id: 'flow-1',
      definitionRevision: 2,
      nodes: [],
      controlEdges: [],
      dataBindings: [],
    };
    const playbookFlowService = {
      findOneBase: jest.fn().mockResolvedValue(flow),
    };
    const playbookInputContractService = {
      derive: jest.fn().mockReturnValue({ playbookId: 'flow-1', inputs: [] }),
    };

    const result = await PlaybookFlowController.prototype.getInputContract.call(
      { playbookFlowService, playbookInputContractService } as unknown as PlaybookFlowController,
      'owner-1',
      'flow-1',
    );

    expect(playbookFlowService.findOneBase).toHaveBeenCalledWith('flow-1', 'owner-1');
    expect(playbookInputContractService.derive).toHaveBeenCalledWith(flow);
    expect(result).toEqual({ playbookId: 'flow-1', inputs: [] });
  });
});
