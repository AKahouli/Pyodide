import type { AgentTaskExecutionService } from '@modules/agent/services/agent-task-execution.service';
import type { SemanticModelNativeSearchClient } from './semantic-model-native-search-client.service';
import { DocumentExtractionConceptResolver } from './document-extraction-concept.resolver';
import { resolveSheetEntities } from '../domain/semantic-source-mapping.types';

const input = {
  userId: 'user-1',
  modelId: 'model-1',
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  documentName: 'Sony_Master_Contract.pdf',
  concept: {
    id: 'concept-1',
    label: 'Contract',
    attributes: [
      { key: 'contract_number', label: 'Contract number', type: 'text' as const, required: true },
      { key: 'source_document', label: 'Source document', type: 'text' as const, required: false },
    ],
  },
  fieldMappings: [
    { sourceField: null, targetAttribute: 'contract_number', mode: 'extract' as const },
    { sourceField: 'document_name', targetAttribute: 'source_document', mode: 'metadata' as const },
  ],
  identityFields: ['contract_number'],
};

describe('DocumentExtractionConceptResolver', () => {
  const build = (text: string) => {
    const nativeSearch = {
      searchBatch: jest.fn().mockResolvedValue([{
        error: null,
        sections: [{ content: 'Contract Number: SONY-2026-MSA-01', page_range: '1', section_id: 'section-1', workspace_id: 'workspace-1', file_name: 'Sony_Master_Contract.pdf' }],
      }]),
    } as unknown as SemanticModelNativeSearchClient;
    const agentTasks = {
      runSingleAgentTask: jest.fn().mockResolvedValue({ text, toolResults: [], citations: [] }),
    } as unknown as AgentTaskExecutionService;
    return {
      resolver: new DocumentExtractionConceptResolver(
        { documentExtractionAgentId: 'agent-1', documentExtractionTimeoutMs: 1000 } as never,
        nativeSearch,
        { get: jest.fn().mockReturnValue(agentTasks) } as never,
      ),
      nativeSearch,
      agentTasks,
    };
  };

  it('keeps extracted values only when they cite returned evidence', async () => {
    const { resolver, nativeSearch } = build(JSON.stringify({ fields: [
      { targetAttribute: 'contract_number', value: 'SONY-2026-MSA-01', reference: 'section-1', confidence: 0.97 },
      { targetAttribute: 'source_document', value: 'invented.pdf', reference: 'section-1', confidence: 1 },
      { targetAttribute: 'governing_law', value: 'French law', reference: 'missing', confidence: 1 },
    ] }));

    const result = await resolver.preview(input);

    expect(result.entities[0]).toMatchObject({
      entityKey: 'sony-2026-msa-01',
      values: {
        contract_number: 'SONY-2026-MSA-01',
        source_document: 'Sony_Master_Contract.pdf',
      },
      provenance: {
        fields: {
          contract_number: {
            method: 'semantic_extraction',
            page: '1',
            quote: 'Contract Number: SONY-2026-MSA-01',
            confidence: 0.97,
          },
        },
      },
    });
    expect(nativeSearch.searchBatch).toHaveBeenCalledWith(expect.any(Array), 30_000, 1);
  });

  it('rejects extracted values whose casing is not verbatim evidence', async () => {
    const { resolver } = build(JSON.stringify({ fields: [
      { targetAttribute: 'contract_number', value: 'sony-2026-msa-01', reference: 'section-1', confidence: 1 },
    ] }));

    const result = await resolver.preview(input);

    expect(result.entities[0].values.contract_number).toBeUndefined();
  });

  it('does not invoke inference for metadata-only mappings', async () => {
    const { resolver, nativeSearch, agentTasks } = build('');
    const result = await resolver.preview({
      ...input,
      fieldMappings: [{ sourceField: 'document_name', targetAttribute: 'source_document', mode: 'metadata' }],
      identityFields: ['source_document'],
    });

    expect(result.entities[0].entityKey).toBe('sony_master_contract.pdf');
    expect(nativeSearch.searchBatch).not.toHaveBeenCalled();
    expect(agentTasks.runSingleAgentTask).not.toHaveBeenCalled();
  });

  it('rejects evidence returned for another document', async () => {
    const { resolver, nativeSearch, agentTasks } = build(JSON.stringify({ fields: [
      { targetAttribute: 'contract_number', value: 'SONY-2026-MSA-01', reference: 'section-1', confidence: 1 },
    ] }));
    (nativeSearch.searchBatch as jest.Mock).mockResolvedValue([{
      error: null,
      sections: [{ content: 'Contract Number: SONY-2026-MSA-01', section_id: 'section-1', workspace_id: 'workspace-1', file_name: 'Another.pdf' }],
    }]);

    const result = await resolver.preview(input);

    expect(result.entities[0].values.contract_number).toBeUndefined();
    expect(agentTasks.runSingleAgentTask).not.toHaveBeenCalled();
  });

  it('produces the same concept identity as a spreadsheet mapping', async () => {
    const { resolver } = build(JSON.stringify({ fields: [
      { targetAttribute: 'contract_number', value: 'SONY-2026-MSA-01', reference: 'section-1', confidence: 1 },
    ] }));
    const document = await resolver.preview(input);
    const spreadsheet = resolveSheetEntities(
      [{ contract_no: 'SONY-2026-MSA-01' }],
      [{ sourceField: 'contract_no', targetAttribute: 'contract_number', mode: 'direct' }],
      ['contract_number'],
    );

    expect(document.entities[0].entityKey).toBe(spreadsheet.entities[0].entityKey);
  });

  it('allows only one extraction per user at a time', async () => {
    const { resolver, agentTasks } = build('');
    let finish!: (value: { text: string; toolResults: never[]; citations: never[] }) => void;
    (agentTasks.runSingleAgentTask as jest.Mock).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));

    const first = resolver.preview(input);
    await new Promise((resolve) => setImmediate(resolve));
    await expect(resolver.preview(input)).rejects.toThrow('already running');
    finish({ text: '{"fields":[]}', toolResults: [], citations: [] });
    await expect(first).resolves.toBeDefined();
  });
});
