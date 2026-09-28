import { NotFoundException } from '@nestjs/common';
import { PlaybookFlowMailTriggerOrchestrationService } from './playbook-flow-mail-trigger-orchestration.service';
import { PlaybookFlowMailTriggerMatcherService } from './playbook-flow-mail-trigger-matcher.service';

describe('PlaybookFlowMailTriggerOrchestrationService', () => {
  const flowWithFilters = {
    id: 'flow-1',
    triggerConfig: { kind: 'mail', params: { enabled: true, filters: {
      from: ['alerts@example.com'], subjectContains: ['invoice'], bodyContains: [], hasAttachments: null,
    } } },
  };

  it('applies the filters stored in the flat mail trigger params', async () => {
    const flows = { findById: jest.fn().mockResolvedValue(flowWithFilters) };
    const ledger = { setStatus: jest.fn().mockResolvedValue(true) };
    const ingestionService = { ingest: jest.fn().mockResolvedValue({ duplicate: false, entry: { id: 'event-1' } }) };
    const matcherService = new PlaybookFlowMailTriggerMatcherService();
    const service = new PlaybookFlowMailTriggerOrchestrationService(
      flows as any, ledger as any, ingestionService as any, matcherService as any,
    );

    const result = await service.ingestAndEvaluate('flow-1', {
      from: { address: 'other@example.com' }, subject: 'invoice', bodyText: '', hasAttachments: false,
    } as any);

    expect(result.finalStatus).toBe('ignored');
    expect(result.match.reasons).toEqual(['from']);
    expect(result.ingestion.entry).toMatchObject({ status: 'ignored', error: 'from' });
    expect(ledger.setStatus).toHaveBeenCalledWith('event-1', 'ignored', 'from');
  });

  it('records a match without an error', async () => {
    const flows = { findById: jest.fn().mockResolvedValue(flowWithFilters) };
    const ledger = { setStatus: jest.fn().mockResolvedValue(true) };
    const ingestionService = { ingest: jest.fn().mockResolvedValue({ duplicate: false, entry: { id: 'event-1' } }) };
    const service = new PlaybookFlowMailTriggerOrchestrationService(
      flows as any, ledger as any, ingestionService as any, new PlaybookFlowMailTriggerMatcherService() as any,
    );

    const result = await service.ingestAndEvaluate('flow-1', {
      from: { address: 'alerts@example.com' }, subject: 'Your invoice', bodyText: '', hasAttachments: false,
    } as any);

    expect(result.finalStatus).toBe('matched');
    expect(ledger.setStatus).toHaveBeenCalledWith('event-1', 'matched', null);
  });

  it('returns a duplicate as recorded, without evaluating it again', async () => {
    const flows = { findById: jest.fn().mockResolvedValue(flowWithFilters) };
    const ledger = { setStatus: jest.fn() };
    const ingestion = { duplicate: true, entry: { id: 'event-0', status: 'matched' } };
    const service = new PlaybookFlowMailTriggerOrchestrationService(
      flows as any, ledger as any, { ingest: jest.fn().mockResolvedValue(ingestion) } as any, new PlaybookFlowMailTriggerMatcherService() as any,
    );

    expect(await service.ingestAndEvaluate('flow-1', {} as any)).toEqual({ ingestion, match: { matched: true, reasons: [] }, finalStatus: 'matched' });
    expect(ledger.setStatus).not.toHaveBeenCalled();
  });

  it('refuses a flow that does not exist', async () => {
    const service = new PlaybookFlowMailTriggerOrchestrationService(
      { findById: jest.fn().mockResolvedValue(null) } as any, {} as any, {} as any, {} as any,
    );
    await expect(service.ingestAndEvaluate('flow-1', {} as any)).rejects.toBeInstanceOf(NotFoundException);
  });
});
