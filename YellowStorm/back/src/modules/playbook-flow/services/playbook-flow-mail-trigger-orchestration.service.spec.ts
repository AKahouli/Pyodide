import { PlaybookFlowMailTriggerOrchestrationService } from './playbook-flow-mail-trigger-orchestration.service';
import { PlaybookFlowMailTriggerMatcherService } from './playbook-flow-mail-trigger-matcher.service';

describe('PlaybookFlowMailTriggerOrchestrationService', () => {
  it('applies the filters stored in the flat mail trigger params', async () => {
    const flowModel = {
      findById: jest.fn().mockReturnValue({
        select: () => ({ lean: () => ({ exec: async () => ({
          triggerConfig: { kind: 'mail', params: { enabled: true, filters: {
            from: ['alerts@example.com'], subjectContains: ['invoice'], bodyContains: [], hasAttachments: null,
          } } },
        }) }) }),
      }),
    };
    const ledgerModel = { updateOne: jest.fn().mockReturnValue({ exec: async () => ({}) }) };
    const ingestionService = { ingest: jest.fn().mockResolvedValue({ duplicate: false, entry: { id: 'event-1' } }) };
    const matcherService = new PlaybookFlowMailTriggerMatcherService();
    const service = new PlaybookFlowMailTriggerOrchestrationService(
      flowModel as any, ledgerModel as any, ingestionService as any, matcherService as any,
    );

    const result = await service.ingestAndEvaluate('flow-1', {
      from: { address: 'other@example.com' }, subject: 'invoice', bodyText: '', hasAttachments: false,
    } as any);

    expect(result.finalStatus).toBe('ignored');
    expect(result.match.reasons).toEqual(['from']);
    expect(ledgerModel.updateOne).toHaveBeenCalledWith(
      { id: 'event-1' }, { $set: { status: 'ignored', error: 'from' } },
    );
  });
});
