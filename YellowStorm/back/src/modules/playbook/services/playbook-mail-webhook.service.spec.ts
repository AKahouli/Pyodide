import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { PlaybookMailWebhookService } from './playbook-mail-webhook.service';
import { Playbook } from '../schemas/playbook.schema';
import { PlaybookMailEventLedger } from '../schemas/playbook-mail-event-ledger.schema';
import { PlaybookMailGraphClientService } from './playbook-mail-graph-client.service';
import { PlaybookMailTriggerOrchestrationService } from './playbook-mail-trigger-orchestration.service';
import { PlaybookMailTriggerHandoffService } from './playbook-mail-trigger-handoff.service';
import { WorkspaceDocumentService } from '../../workspace/workspace-document.service';
import { LoggerService } from '../../logger';

function mockPlaybook(overrides: Record<string, any> = {}) {
  return {
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: { toString: () => 'p1' },
          createdBy: { toString: () => 'u1' },
          mailTrigger: {
            mailboxAppKey: 'microsoft',
            subscriptionClientState: 'ys_p1',
            attachmentImportEnabled: true,
            allowedAttachmentExtensions: ['pdf'],
            ...overrides,
          },
          workspaces: [{ toString: () => 'ws-1' }],
          ...overrides,
        }),
      }),
    }),
  };
}

function mockMessage(overrides: Record<string, any> = {}) {
  return {
    id: 'msg-1',
    conversationId: 'thread-1',
    receivedDateTime: '2026-04-17T15:00:00Z',
    subject: 'Test',
    bodyPreview: 'Body',
    body: { content: '<p>Body</p>' },
    from: { emailAddress: { address: 'from@example.com', name: 'From' } },
    toRecipients: [],
    ccRecipients: [],
    hasAttachments: false,
    ...overrides,
  };
}

function mockEvaluation(overrides: Record<string, any> = {}) {
  return {
    ingestion: { entry: { id: 'evt-1' }, duplicate: false },
    match: { matched: true, reasons: [] },
    finalStatus: 'matched',
    ...overrides,
  };
}

describe('PlaybookMailWebhookService', () => {
  let service: PlaybookMailWebhookService;
  let playbookModel: { findOne: jest.Mock };
  let ledgerModel: { updateOne: jest.Mock };
  let graphClient: { getMessageByResource: jest.Mock; listAttachments: jest.Mock; downloadAttachment: jest.Mock };
  let orchestrationService: { ingestAndEvaluate: jest.Mock };
  let handoffService: { handoffMatchedEvent: jest.Mock };
  let workspaceDocumentService: { uploadSmallFile: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock; error: jest.Mock };

  beforeEach(async () => {
    playbookModel = { findOne: jest.fn() };
    ledgerModel = { updateOne: jest.fn() };
    graphClient = { getMessageByResource: jest.fn(), listAttachments: jest.fn(), downloadAttachment: jest.fn() };
    orchestrationService = { ingestAndEvaluate: jest.fn() };
    handoffService = { handoffMatchedEvent: jest.fn() };
    workspaceDocumentService = { uploadSmallFile: jest.fn() };
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybookMailWebhookService,
        { provide: getModelToken(Playbook.name), useValue: playbookModel },
        { provide: getModelToken(PlaybookMailEventLedger.name), useValue: ledgerModel },
        { provide: PlaybookMailGraphClientService, useValue: graphClient },
        { provide: PlaybookMailTriggerOrchestrationService, useValue: orchestrationService },
        { provide: PlaybookMailTriggerHandoffService, useValue: handoffService },
        { provide: WorkspaceDocumentService, useValue: workspaceDocumentService },
        { provide: LoggerService, useValue: logger },
      ],
    }).compile();

    service = module.get(PlaybookMailWebhookService);
  });

  it('ignores notifications whose clientState does not match', async () => {
    playbookModel.findOne.mockReturnValue(mockPlaybook({ subscriptionClientState: 'ys_expected' }));

    const result = await service.handleNotifications({
      value: [{ subscriptionId: 'sub-1', clientState: 'wrong', resourceData: { id: 'msg-1' } }],
    });

    expect(graphClient.getMessageByResource).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 0, results: [] });
  });

  it('fetches, evaluates, and hands off a valid notification without attachments', async () => {
    playbookModel.findOne.mockReturnValue(mockPlaybook());
    graphClient.getMessageByResource.mockResolvedValue(mockMessage());
    orchestrationService.ingestAndEvaluate.mockResolvedValue(mockEvaluation());
    handoffService.handoffMatchedEvent.mockResolvedValue({ executionId: 'exec-1', handedOff: true, skippedReason: null });
    ledgerModel.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) });

    const result = await service.handleNotifications({
      value: [{ subscriptionId: 'sub-1', clientState: 'ys_p1', resourceData: { id: 'msg-1' } }],
    });

    expect(handoffService.handoffMatchedEvent).toHaveBeenCalledWith('p1', 'u1', '', 'evt-1');
    expect(result.processed).toBe(1);
  });

  it('does not import attachments when attachmentImportEnabled is false', async () => {
    playbookModel.findOne.mockReturnValue(
      mockPlaybook({ attachmentImportEnabled: false }),
    );
    graphClient.getMessageByResource.mockResolvedValue(mockMessage({ hasAttachments: true }));
    orchestrationService.ingestAndEvaluate.mockResolvedValue(mockEvaluation());
    handoffService.handoffMatchedEvent.mockResolvedValue({ executionId: 'exec-1', handedOff: true, skippedReason: null });

    await service.handleNotifications({
      value: [{ subscriptionId: 'sub-1', clientState: 'ys_p1', resourceData: { id: 'msg-1' } }],
    });

    expect(graphClient.listAttachments).not.toHaveBeenCalled();
    expect(workspaceDocumentService.uploadSmallFile).not.toHaveBeenCalled();
  });

  it('imports only allowed extensions and rejects others', async () => {
    playbookModel.findOne.mockReturnValue(
      mockPlaybook({ attachmentImportEnabled: true, allowedAttachmentExtensions: ['pdf'] }),
    );
    graphClient.getMessageByResource.mockResolvedValue(mockMessage({ hasAttachments: true }));
    graphClient.listAttachments.mockResolvedValue([
      { id: 'att-pdf', name: 'report.pdf', contentType: 'application/pdf', size: 100, isInline: false },
      { id: 'att-exe', name: 'malware.exe', contentType: 'application/octet-stream', size: 200, isInline: false },
    ]);
    graphClient.downloadAttachment.mockResolvedValue(Buffer.from('pdf-content'));
    workspaceDocumentService.uploadSmallFile.mockResolvedValue({
      id: 'doc-1', originalName: 'report.pdf', filename: 'report.pdf', mimeType: 'application/pdf', size: 100, path: 'u1/ws-1/doc-1/report.pdf',
    });
    orchestrationService.ingestAndEvaluate.mockResolvedValue(mockEvaluation());
    handoffService.handoffMatchedEvent.mockResolvedValue({ executionId: 'exec-1', handedOff: true, skippedReason: null });
    ledgerModel.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) });

    await service.handleNotifications({
      value: [{ subscriptionId: 'sub-1', clientState: 'ys_p1', resourceData: { id: 'msg-1' } }],
    });

    expect(workspaceDocumentService.uploadSmallFile).toHaveBeenCalledTimes(1);
    expect(workspaceDocumentService.uploadSmallFile).toHaveBeenCalledWith(
      'ws-1', 'u1', expect.any(Buffer), 'report.pdf', 'application/pdf',
    );
    const ledgerCall = ledgerModel.updateOne.mock.calls[0];
    const ledgerArg = ledgerCall ? ledgerCall[1] : {};
    const attachments = (ledgerArg as any)?.$set?.attachments ?? [];
    const pdfAtt = attachments.find((a: any) => a.filename === 'report.pdf');
    expect(pdfAtt.workspaceImport.workspaceDocumentId).toBe('doc-1');
    const exeAtt = attachments.find((a: any) => a.filename === 'malware.exe');
    expect(exeAtt.workspaceImport.workspaceDocumentId).toBeNull();
    expect(exeAtt.workspaceImport.error).toContain('not allowed');
  });

  it('imports all attachments when allowed extensions list is empty', async () => {
    playbookModel.findOne.mockReturnValue(
      mockPlaybook({ attachmentImportEnabled: true, allowedAttachmentExtensions: [] }),
    );
    graphClient.getMessageByResource.mockResolvedValue(mockMessage({ hasAttachments: true }));
    graphClient.listAttachments.mockResolvedValue([
      { id: 'att-1', name: 'data.csv', contentType: 'text/csv', size: 50, isInline: false },
    ]);
    graphClient.downloadAttachment.mockResolvedValue(Buffer.from('csv'));
    workspaceDocumentService.uploadSmallFile.mockResolvedValue({
      id: 'doc-1', originalName: 'data.csv', filename: 'data.csv', mimeType: 'text/csv', size: 50, path: 'u1/ws-1/doc-1/data.csv',
    });
    orchestrationService.ingestAndEvaluate.mockResolvedValue(mockEvaluation());
    handoffService.handoffMatchedEvent.mockResolvedValue({ executionId: 'exec-1', handedOff: true, skippedReason: null });
    ledgerModel.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) });

    await service.handleNotifications({
      value: [{ subscriptionId: 'sub-1', clientState: 'ys_p1', resourceData: { id: 'msg-1' } }],
    });

    expect(workspaceDocumentService.uploadSmallFile).toHaveBeenCalledTimes(1);
  });

  it('does not import attachments for duplicate notifications', async () => {
    playbookModel.findOne.mockReturnValue(
      mockPlaybook({ attachmentImportEnabled: true }),
    );
    graphClient.getMessageByResource.mockResolvedValue(mockMessage({ hasAttachments: true }));
    orchestrationService.ingestAndEvaluate.mockResolvedValue(
      mockEvaluation({ ingestion: { entry: { id: 'evt-1' }, duplicate: true }, finalStatus: 'deduplicated' }),
    );
    ledgerModel.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) });

    await service.handleNotifications({
      value: [{ subscriptionId: 'sub-1', clientState: 'ys_p1', resourceData: { id: 'msg-1' } }],
    });

    expect(graphClient.listAttachments).not.toHaveBeenCalled();
    expect(workspaceDocumentService.uploadSmallFile).not.toHaveBeenCalled();
  });

  it('does not import attachments when not matched', async () => {
    playbookModel.findOne.mockReturnValue(
      mockPlaybook({ attachmentImportEnabled: true }),
    );
    graphClient.getMessageByResource.mockResolvedValue(mockMessage({ hasAttachments: true }));
    orchestrationService.ingestAndEvaluate.mockResolvedValue(
      mockEvaluation({ match: { matched: false, reasons: ['from mismatch'] }, finalStatus: 'ignored' }),
    );

    await service.handleNotifications({
      value: [{ subscriptionId: 'sub-1', clientState: 'ys_p1', resourceData: { id: 'msg-1' } }],
    });

    expect(graphClient.listAttachments).not.toHaveBeenCalled();
    expect(workspaceDocumentService.uploadSmallFile).not.toHaveBeenCalled();
  });

  it('continues processing remaining notifications when one fails', async () => {
    const playbooks = [
      mockPlaybook({ subscriptionClientState: 'ys_fail' }),
      mockPlaybook({ subscriptionClientState: 'ys_ok' }),
    ];
    playbookModel.findOne
      .mockReturnValueOnce(playbooks[0])
      .mockReturnValueOnce(playbooks[1]);

    graphClient.getMessageByResource
      .mockRejectedValueOnce(new Error('Graph down'))
      .mockResolvedValueOnce(mockMessage());
    orchestrationService.ingestAndEvaluate.mockResolvedValue(mockEvaluation());
    handoffService.handoffMatchedEvent.mockResolvedValue({ executionId: 'exec-1', handedOff: true, skippedReason: null });

    const result = await service.handleNotifications({
      value: [
        { subscriptionId: 'sub-1', clientState: 'ys_fail', resourceData: { id: 'msg-fail' } },
        { subscriptionId: 'sub-2', clientState: 'ys_ok', resourceData: { id: 'msg-ok' } },
      ],
    });

    expect(result.processed).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Mail notification processing failed',
      expect.objectContaining({ error: 'Graph down' }),
    );
  });

  it('strips leading dots from allowed extensions during filtering', async () => {
    playbookModel.findOne.mockReturnValue(
      mockPlaybook({ attachmentImportEnabled: true, allowedAttachmentExtensions: ['.pdf'] }),
    );
    graphClient.getMessageByResource.mockResolvedValue(mockMessage({ hasAttachments: true }));
    graphClient.listAttachments.mockResolvedValue([
      { id: 'att-1', name: 'doc.pdf', contentType: 'application/pdf', size: 100, isInline: false },
    ]);
    graphClient.downloadAttachment.mockResolvedValue(Buffer.from('pdf'));
    workspaceDocumentService.uploadSmallFile.mockResolvedValue({
      id: 'doc-1', originalName: 'doc.pdf', filename: 'doc.pdf', mimeType: 'application/pdf', size: 100, path: 'u1/ws-1/doc-1/doc.pdf',
    });
    orchestrationService.ingestAndEvaluate.mockResolvedValue(mockEvaluation());
    handoffService.handoffMatchedEvent.mockResolvedValue({ executionId: 'exec-1', handedOff: true, skippedReason: null });
    ledgerModel.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) });

    await service.handleNotifications({
      value: [{ subscriptionId: 'sub-1', clientState: 'ys_p1', resourceData: { id: 'msg-1' } }],
    });

    expect(workspaceDocumentService.uploadSmallFile).toHaveBeenCalledTimes(1);
  });
});
