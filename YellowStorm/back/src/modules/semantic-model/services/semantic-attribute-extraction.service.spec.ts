import { ServiceUnavailableException } from '@modules/exceptions';
import { SemanticAttributeExtractionService } from './semantic-attribute-extraction.service';

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
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('fails closed when the default extraction agent is missing or inactive', async () => {
    const { service } = build({ agent: null });
    await expect(service.extract(request)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when the ADK api key is not configured', async () => {
    const { service } = build({ apiKey: '' });
    await expect(service.extract(request)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proxies to the ADK with the model bound into the fingerprint', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ extractorVersion: 'ai-attribute-v1', values: [], failed: [] }), { status: 200 }));
    const { service } = build();

    await service.extract(request);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://adk.test/semantic-model/attributes/extract');
    expect(JSON.parse(init.body)).toEqual(expect.objectContaining({ modelId: 'model-1', model: 'gpt-5.4-nano' }));
    expect(init.headers).toEqual(expect.objectContaining({ 'x-api-key': 'test-key' }));
  });

  it('refuses to run when no extractor identity was bound at admission', async () => {
    const { service } = build();
    await expect(service.extract({ ...request, aiExtraction: null }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when the agent changed after the job was admitted', async () => {
    const { service } = build({ agent: { slug: 'semantic-field-extraction', llmModel: 'another-model' } });
    await expect(service.extract(request)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when the ADK reports a different extractor version', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ extractorVersion: 'ai-attribute-v2', values: [], failed: [] }), { status: 200 }));
    const { service } = build();
    await expect(service.extract(request)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('reports an ADK failure as an unavailable dependency', async () => {
    fetchMock.mockResolvedValue(new Response('bad gateway', { status: 502 }));
    const { service } = build();

    await expect(service.extract(request)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
