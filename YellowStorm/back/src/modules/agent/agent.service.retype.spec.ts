import { AgentService } from './agent.service';
import { RootPolicyService } from './services/root-policy.service';
import { newRootExecutionPolicy } from './interfaces/root-execution-policy.interface';
import type { AgentRecord } from './repositories/agent-record.mapper';
import type { UpdateAgentDto } from './dto/update-agent.dto';

function harness(isDefault: boolean, delegationEnabled = false) {
  const policy = newRootExecutionPolicy();
  policy.delegation.enabled = delegationEnabled;
  const record: AgentRecord = {
    _id: '111111111111111111111111', name: 'Specialist', slug: 'specialist',
    agentType: '222222222222222222222222', agentTypeSlug: 'mono-agent',
    role: 'Role', description: '', temperature: 0, instruction: 'Keep this instruction',
    llmModel: 'model', ignorePrePrompt: false, knowledgeBases: ['knowledge'], tools: ['tool'],
    skills: [], disabledSkills: [], connectors: [], connectorActionSelections: [], guardrails: {}, deploymentSettings: {},
    enable_temporary_child_agents: false, max_temporary_child_agents: 4,
    rootExecutionPolicy: policy as unknown as Record<string, unknown>,
    delegateAgentIds: ['333333333333333333333333'], delegateTeamIds: [],
    isDefault, isDefaultForType: false, isActive: true, createdBy: 'owner',
    a2aPublished: false, createdAt: new Date(), updatedAt: new Date(),
  };
  const repository = {
    findById: jest.fn(async () => record), findByIdDefault: jest.fn(async () => record),
    findByIds: jest.fn(async () => [{ _id: record.delegateAgentIds![0] }]),
    updateById: jest.fn(async (_id, patch) => ({ ...record, ...patch })),
  };
  const types = {
    findById: jest.fn(async () => ({ isActive: true })),
    getManyForHydration: jest.fn(async () => new Map([
      ['222222222222222222222222', { id: '222222222222222222222222', name: 'Mono', slug: 'mono-agent', skills: [] }],
      ['444444444444444444444444', { id: '444444444444444444444444', name: 'Simple', slug: 'simple', skills: [] }],
    ])),
  };
  const service = new AgentService(
    { setContext: jest.fn(), log: jest.fn() } as never,
    {} as never, types as never, {} as never,
    { findByIds: jest.fn(async () => []) } as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    repository as never, new RootPolicyService(repository as never, {} as never), {} as never,
  );
  const update = (dto: UpdateAgentDto) => isDefault
    ? service.updateDefault(record._id, dto)
    : service.updatePersonal('owner', record._id, dto);
  return { record, repository, update };
}

describe.each([false, true])('agent retyping (system=%s)', (isDefault) => {
  const simple = '444444444444444444444444';

  it('can explicitly unenroll and change to simple after library delegation is disabled', async () => {
    const { update, repository } = harness(isDefault);
    const response = await update({ agentType: simple, rootExecutionPolicy: null,
      delegateAgentIds: [], delegateTeamIds: [], enable_temporary_child_agents: false });
    expect(repository.updateById).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      agentType: simple, agentTypeSlug: 'simple', rootExecutionPolicy: null, delegateAgentIds: [], delegateTeamIds: [],
    }));
    expect(response).toMatchObject({ agentType: { slug: 'simple' }, model: 'model', tools: ['tool'],
      knowledgeBases: ['knowledge'], instruction: 'Keep this instruction' });
  });

  it('does not retain an existing Root policy when only the type is changed', async () => {
    const { update, repository } = harness(isDefault, true);
    await expect(update({ agentType: simple })).rejects.toThrow('only allowed on mono-agent');
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  it('does not treat library delegation being disabled as full unenrollment', async () => {
    const { update, record, repository } = harness(isDefault);
    await expect(update({ agentType: simple, rootExecutionPolicy: record.rootExecutionPolicy as never }))
      .rejects.toThrow('only allowed on mono-agent');
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  it('explicit unenrollment clears even simultaneously supplied allowlists', async () => {
    const { update, record, repository } = harness(isDefault);
    await update({ agentType: simple, rootExecutionPolicy: null, delegateAgentIds: record.delegateAgentIds });
    expect(repository.updateById).toHaveBeenCalledWith(record._id, expect.objectContaining({
      rootExecutionPolicy: null, delegateAgentIds: [], delegateTeamIds: [],
    }));
  });

  it('does not attach a Root policy when changing from simple to another non-root type', async () => {
    const { update, record, repository } = harness(isDefault);
    record.agentTypeSlug = 'simple';
    record.rootExecutionPolicy = undefined;
    record.delegateAgentIds = [];
    await expect(update({ agentType: simple, rootExecutionPolicy: newRootExecutionPolicy() }))
      .rejects.toThrow('only allowed on mono-agent');
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  it('allows an ordinary simple-agent save with empty Root selections', async () => {
    const { update, record } = harness(isDefault);
    record.agentType = simple;
    record.agentTypeSlug = 'simple';
    record.rootExecutionPolicy = undefined;
    record.delegateAgentIds = [];
    await expect(update({ agentType: simple, delegateAgentIds: [], delegateTeamIds: [] })).resolves.toBeDefined();
  });

  it('validates enrollment against the selected mono-agent type, not the old simple type', async () => {
    const { update, record, repository } = harness(isDefault);
    record.agentType = simple;
    record.agentTypeSlug = 'simple';
    record.rootExecutionPolicy = undefined;
    record.delegateAgentIds = [];
    await update({ agentType: '222222222222222222222222', rootExecutionPolicy: newRootExecutionPolicy() });
    expect(repository.updateById).toHaveBeenCalledWith(record._id, expect.objectContaining({ agentTypeSlug: 'mono-agent' }));
  });
});
