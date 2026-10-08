import { PlatformCopilotBootstrapService } from './platform-copilot-bootstrap.service';

describe('PlatformCopilotBootstrapService', () => {
  const featureVisibility = { getVisibility: jest.fn() };
  const agentTypeService = { findOrCreateBySlug: jest.fn() };
  const agentRepository = { createDefaultSystemAgentIfMissing: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  it('does nothing when Platform Copilot is disabled', async () => {
    featureVisibility.getVisibility.mockResolvedValue({ platformCopilot: false });
    const service = new PlatformCopilotBootstrapService(
      featureVisibility as never,
      agentTypeService as never,
      agentRepository as never,
    );

    await service.onApplicationBootstrap();

    expect(agentTypeService.findOrCreateBySlug).not.toHaveBeenCalled();
    expect(agentRepository.createDefaultSystemAgentIfMissing).not.toHaveBeenCalled();
  });

  it('creates only the canonical identity; instructions and capabilities come from agent configuration', async () => {
    featureVisibility.getVisibility.mockResolvedValue({ platformCopilot: true });
    agentTypeService.findOrCreateBySlug.mockResolvedValue({ id: 'type-id', slug: 'platform_copilot' });
    agentRepository.createDefaultSystemAgentIfMissing.mockResolvedValue({ id: 'agent-id' });
    const service = new PlatformCopilotBootstrapService(
      featureVisibility as never,
      agentTypeService as never,
      agentRepository as never,
    );

    await service.onApplicationBootstrap();

    expect(agentRepository.createDefaultSystemAgentIfMissing).toHaveBeenCalledWith(expect.objectContaining({
      slug: 'platform-copilot',
      agentTypeSlug: 'platform_copilot',
      instruction: '',
      connectors: [],
      connectorActionSelections: [],
      tools: [],
      skills: [],
      knowledgeBases: [],
      createdBy: '000000000000000000000000',
    }));
  });

  it('allows concurrent startup calls to converge through atomic type and Agent upserts', async () => {
    featureVisibility.getVisibility.mockResolvedValue({ platformCopilot: true });
    agentTypeService.findOrCreateBySlug.mockResolvedValue({ id: 'type-id', slug: 'platform_copilot' });
    agentRepository.createDefaultSystemAgentIfMissing.mockResolvedValue({ id: 'agent-id' });
    const first = new PlatformCopilotBootstrapService(
      featureVisibility as never,
      agentTypeService as never,
      agentRepository as never,
    );
    const second = new PlatformCopilotBootstrapService(
      featureVisibility as never,
      agentTypeService as never,
      agentRepository as never,
    );

    await expect(Promise.all([
      first.onApplicationBootstrap(),
      second.onApplicationBootstrap(),
    ])).resolves.toEqual([undefined, undefined]);
    expect(agentTypeService.findOrCreateBySlug).toHaveBeenCalledTimes(2);
    expect(agentRepository.createDefaultSystemAgentIfMissing).toHaveBeenCalledTimes(2);
  });
});
