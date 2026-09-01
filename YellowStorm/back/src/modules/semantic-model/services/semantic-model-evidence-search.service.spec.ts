import { ConfigType } from '@nestjs/config';
import semanticModelConfig from '@config/semantic-model.config';
import { SemanticGraph } from '../domain/semantic-model.types';
import { SemanticModelEvidenceSearchService } from './semantic-model-evidence-search.service';
import { SemanticGraphCommandService } from './semantic-graph-command.service';
import { SemanticModelCorpusPreparationService } from './semantic-model-corpus-preparation.service';
import {
  SemanticModelNativeSearchClient,
  SemanticModelNativeSearchFatalError,
} from './semantic-model-native-search-client.service';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SemanticModelService } from './semantic-model.service';

const config = {
  evidenceSearchConcurrency: 2,
} as ConfigType<typeof semanticModelConfig>;

const graph: SemanticGraph = {
  modelId: 'model-1',
  versionId: 'version-1',
  revision: 1,
  nodes: [{
    id: 'employee',
    key: 'employee',
    label: 'Employee',
    description: 'A company employee',
    category: 'business_object',
    recordPolicy: 'expected',
    systemKey: null,
    aliases: [],
    attributes: [
      { key: 'name', label: 'Name', type: 'text', required: true, description: 'full name' },
      { key: 'email', label: 'Email', type: 'text', required: false, description: 'work email' },
    ],
    position: { x: 0, y: 0 },
  }],
  relations: [],
  records: [],
  recordRelations: [],
};

describe('SemanticModelEvidenceSearchService', () => {
  const models = { requireRole: jest.fn() };
  const corpusPreparation = { prepare: jest.fn() };
  const graphCommands = { getGraph: jest.fn() };
  const nativeSearch = { search: jest.fn() };

  const service = new SemanticModelEvidenceSearchService(
    config,
    models as unknown as SemanticModelService,
    corpusPreparation as unknown as SemanticModelCorpusPreparationService,
    graphCommands as unknown as SemanticGraphCommandService,
    nativeSearch as unknown as SemanticModelNativeSearchClient,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    models.requireRole.mockResolvedValue(undefined);
    graphCommands.getGraph.mockResolvedValue(graph);
    corpusPreparation.prepare.mockResolvedValue({
      bindings: [{
        bindingId: 'binding-1',
        target: { kind: 'node_type', id: 'employee', label: 'Employee' },
        resourceKind: 'document',
        workspaceId: 'workspace-1',
        documentId: 'document-1',
        retrievalMode: 'targeted',
        priority: 1,
        documents: [{
          sourceDocumentId: 'document-1',
          workspaceId: 'workspace-1',
          originalName: 'employee.pdf',
          mimeType: 'application/pdf',
          indexingStatus: 'ready',
        }],
      }],
    });
  });

  it('calls native search once per attribute plus one identity query', async () => {
    nativeSearch.search.mockResolvedValue([{ content: 'Jane Doe', section_id: 7 }]);

    const result = await service.search('user-1', 'model-1');

    expect(nativeSearch.search).toHaveBeenCalledTimes(3);
    expect(nativeSearch.search).toHaveBeenNthCalledWith(1, {
      query: 'Employee: Name: full name',
      workspace_id: 'workspace-1',
      file_name: 'employee.pdf',
    });
    expect(nativeSearch.search).toHaveBeenNthCalledWith(3, {
      query: 'Employee: main subject, proper name, or identifier of the Employee',
      workspace_id: 'workspace-1',
      file_name: 'employee.pdf',
    });
    expect(result.failedUnits).toEqual([]);
    expect(result.tasks[0].evidence).toEqual([{
      source: 'employee.pdf',
      fileName: 'employee.pdf',
      quote: 'Jane Doe',
      workspaceId: 'workspace-1',
      reference: '7',
    }]);
  });

  it('keeps successful evidence when one query fails', async () => {
    nativeSearch.search
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue([{ content: 'Jane Doe', file_name: 'employee.pdf' }]);

    const result = await service.search('user-1', 'model-1');

    expect(result.tasks).toHaveLength(1);
    expect(result.failedUnits).toEqual([]);
    expect(result.tasks[0].toolResults.some((item) => item.status === 'failed')).toBe(true);
  });

  it('marks the document failed when every query fails', async () => {
    nativeSearch.search.mockRejectedValue(new Error('unavailable'));

    const result = await service.search('user-1', 'model-1');

    expect(result.tasks).toEqual([]);
    expect(result.failedUnits).toEqual([expect.objectContaining({
      bindingId: 'binding-1',
      sourceDocumentId: 'document-1',
      fileName: 'employee.pdf',
    })]);
  });

  it('propagates fatal native-search configuration and authentication errors', async () => {
    nativeSearch.search.mockRejectedValue(new SemanticModelNativeSearchFatalError(
      ErrorCode.SERVICE_UNAVAILABLE,
      'unauthorized',
    ));

    await expect(service.search('user-1', 'model-1'))
      .rejects.toBeInstanceOf(SemanticModelNativeSearchFatalError);
  });
});
