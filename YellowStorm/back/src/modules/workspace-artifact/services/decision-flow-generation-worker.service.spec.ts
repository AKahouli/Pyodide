import type { Model } from 'mongoose';
import pdf = require('pdf-parse');
import { DecisionFlowGenerationWorkerService } from './decision-flow-generation-worker.service';
import { WorkspaceArtifactDocument } from '../schemas/workspace-artifact.schema';
import { WorkspaceArtifactStatus, WorkspaceArtifactType } from '../interfaces/workspace-artifact.interface';

jest.mock('pdf-parse', () => jest.fn());

describe('DecisionFlowGenerationWorkerService', () => {
  it('requests inline content for the selected source pages', async () => {
    const updateOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });
    const artifacts = { updateOne } as unknown as Model<WorkspaceArtifactDocument>;
    const documents = { findById: jest.fn().mockResolvedValue({ path: 'workspace/source.pdf', originalName: 'source.pdf', createdAt: '2026-07-15T00:00:00.000Z' }), getDownloadUrl: jest.fn().mockResolvedValue({ url: 'https://storage.example/source.pdf' }) };
    const documentStorage = { download: jest.fn().mockResolvedValue(Buffer.from('PDF')) };
    const tasks = { runSingleAgentTask: jest.fn().mockResolvedValue({ text: '{"title":"Flow","nodes":[],"edges":[],"warnings":[]}' }) };
    const parser = { parse: jest.fn().mockReturnValue({}) };
    const validator = { validate: jest.fn().mockReturnValue({ title: 'Flow', nodes: [], edges: [], warnings: [] }) };
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
    (pdf as jest.Mock).mockResolvedValue({ text: '<page number="2">Eligibility rules</page>' });
    const service = new DecisionFlowGenerationWorkerService(artifacts, documents as never, documentStorage as never, tasks as never, parser as never, validator as never, logger as never);
    const objectId = (value: string) => ({ toString: () => value });
    const artifact = {
      _id: 'artifact-id',
      id: 'artifact-id',
      workspaceId: objectId('workspace-id'),
      type: WorkspaceArtifactType.DECISION_FLOW,
      status: WorkspaceArtifactStatus.GENERATING,
      primarySource: { documentId: objectId('document-id'), documentName: 'source.pdf', selection: { mode: 'pages', pages: [2, 4] } },
      generation: { leaseToken: 'lease-token', requestedBy: objectId('user-id'), agentId: objectId('agent-id'), attempts: 1 },
    } as unknown as WorkspaceArtifactDocument;

    await (service as unknown as { generate(value: WorkspaceArtifactDocument): Promise<void> }).generate(artifact);

    expect(tasks.runSingleAgentTask).toHaveBeenCalledWith(expect.objectContaining({
      attachedFiles: [],
      query: expect.stringContaining('<page number="2">Eligibility rules</page>'),
    }));
  });
});
