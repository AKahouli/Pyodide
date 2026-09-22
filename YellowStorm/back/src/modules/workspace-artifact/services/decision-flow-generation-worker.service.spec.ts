import pdf = require('pdf-parse');
import { DecisionFlowGenerationWorkerService } from './decision-flow-generation-worker.service';
import type { ArtifactLeaseClaim } from '../persistence/workspace-artifact-store';

jest.mock('pdf-parse', () => jest.fn());

describe('DecisionFlowGenerationWorkerService', () => {
  it('requests inline content for the selected source pages', async () => {
    const artifacts = { complete: jest.fn().mockResolvedValue(true), fail: jest.fn().mockResolvedValue(true) };
    const documents = { findById: jest.fn().mockResolvedValue({ path: 'workspace/source.pdf', originalName: 'source.pdf', createdAt: '2026-07-15T00:00:00.000Z' }) };
    const documentStorage = { download: jest.fn().mockResolvedValue(Buffer.from('PDF')) };
    const tasks = { runSingleAgentTask: jest.fn().mockResolvedValue({ text: '{"title":"Flow","nodes":[],"edges":[],"warnings":[]}' }) };
    const parser = { parse: jest.fn().mockReturnValue({}) };
    const validator = { validate: jest.fn().mockReturnValue({ title: 'Flow', nodes: [], edges: [], warnings: [] }) };
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
    (pdf as jest.Mock).mockResolvedValue({ text: '<page number="2">Eligibility rules</page>' });
    const service = new DecisionFlowGenerationWorkerService(artifacts as never, documents as never, documentStorage as never, tasks as never, parser as never, validator as never, logger as never);
    const claim: ArtifactLeaseClaim = {
      leaseToken: 'lease-token',
      artifact: {
        id: 'artifact-id',
        workspaceId: 'workspace-id',
        type: 'decision_flow',
        name: 'Flow',
        status: 'generating',
        schemaVersion: 1,
        revision: 0,
        primarySource: { documentId: 'document-id', documentName: 'source.pdf', selection: { mode: 'pages', pages: [2, 4] } },
        generationOptions: {
          flowType: 'eligibility',
          targetAudiences: ['infer_from_document'],
          detailLevel: 'standard',
          ambiguityPolicy: { doNotInvent: true, createToConfirmNodes: true, citeSourcePassages: true, identifyContradictions: true },
        },
        generation: { agentId: 'agent-id', requestedBy: 'user-id', attempts: 1 },
        createdBy: 'user-id',
        updatedBy: 'user-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };

    await (service as unknown as { generate(value: ArtifactLeaseClaim): Promise<void> }).generate(claim);

    expect(tasks.runSingleAgentTask).toHaveBeenCalledWith(expect.objectContaining({
      attachedFiles: [],
      query: expect.stringContaining('<page number="2">Eligibility rules</page>'),
    }));
    expect(artifacts.complete).toHaveBeenCalledWith('artifact-id', 'lease-token', expect.anything(), undefined);
  });
});
