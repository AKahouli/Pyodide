import axios from 'axios';
import { ServiceUnavailableException } from '@modules/exceptions';
import { SemanticAttributeExtractionService } from './semantic-attribute-extraction.service';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function build(options: {
  agent?: { slug?: string; llmModel?: string | null } | null;
  apiKey?: string;
} = {}) {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'indexing.apiAdk') return 'http://adk.test';
      if (key === 'indexing.adkApiKey') return options.apiKey ?? 'test-key';
      return undefined;
    }),
  };
  const agents = {
    findDefaultByNameActive: jest.fn().mockResolvedValue(
      options.agent === undefined
        ? { slug: 'semantic-field-extraction', llmModel: 'gpt-5.4-nano' }
        : options.agent),
  };
  const service = new SemanticAttributeExtractionService(config as never, agents as never);
  return { service, agents };
}

const BOUND = { agentSlug: 'semantic-field-extraction', model: 'gpt-5.4-nano', contractVersion: 'ai-attribute-v1' };

const request = {
  modelId: 'model-1',
  conceptId: 'contract',
  attributes: [{ key: 'contract_number' }],
  sections: [{ sectionPk: 7, blockPk: 9, content: 'Contract number CNT-2026-0041' }],
  aiExtraction: BOUND,
};

describe('SemanticAttributeExtractionService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fails closed when the default extraction agent is missing or inactive', async () => {
    const { service } = build({ agent: null });
    await expect(service.extract(request)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('fails closed when the ADK api key is not configured', async () => {
    const { service } = build({ apiKey: '' });
    await expect(service.extract(request)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('proxies to the ADK with the model bound into the fingerprint', async () => {
    mockedAxios.post.mockResolvedValue({ data: { extractorVersion: 'ai-attribute-v1', values: [], failed: [] } });
    const { service } = build();

    await service.extract(request);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://adk.test/semantic-model/attributes/extract',
      expect.objectContaining({ modelId: 'model-1', model: 'gpt-5.4-nano' }),
      expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'test-key' }) }),
    );
  });

  it('refuses to run when no extractor identity was bound at admission', async () => {
    const { service } = build();
    await expect(service.extract({ ...request, aiExtraction: null }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('fails closed when the agent changed after the job was admitted', async () => {
    const { service } = build({ agent: { slug: 'semantic-field-extraction', llmModel: 'another-model' } });
    await expect(service.extract(request)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('fails closed when the ADK reports a different extractor version', async () => {
    mockedAxios.post.mockResolvedValue({ data: { extractorVersion: 'ai-attribute-v2', values: [], failed: [] } });
    const { service } = build();
    await expect(service.extract(request)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('reports an ADK failure as an unavailable dependency', async () => {
    mockedAxios.post.mockRejectedValue({ isAxiosError: true, response: { status: 502, data: 'bad gateway' } });
    (mockedAxios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);
    const { service } = build();

    await expect(service.extract(request)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
