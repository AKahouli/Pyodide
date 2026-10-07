import { ConfigService } from '@nestjs/config';
import { AgentService } from '@modules/agent/agent.service';
import { PlaybookExecutionNodeAgentMetadataService } from './playbook-execution-node-agent-metadata.service';

function configWith(trustedUrl: string): ConfigService {
  return {
    get: jest.fn((key: string, fallback: string) => (key === 'PYODIDE_MCP_SERVER_URL' ? trustedUrl : fallback)),
  } as unknown as ConfigService;
}

function service(): PlaybookExecutionNodeAgentMetadataService {
  const agentService = {
    buildGrpcConnectorRuntimeForPlaybook: jest.fn(),
    buildGrpcSkillsForPlaybook: jest.fn(),
  } as unknown as AgentService;
  return new PlaybookExecutionNodeAgentMetadataService(agentService, configWith('http://localhost:8027/mcp'));
}

const resolvedAgent = () => ({
  connector_bindings: [
    { connector_slug: 'pyodide', mcp_server_url: 'http://localhost:8027/mcp', auth_headers: {} },
    { connector_slug: 'external', mcp_server_url: 'https://third.party/mcp', auth_headers: {} },
  ],
  skills: [],
});

describe('PlaybookExecutionNodeAgentMetadataService trusted input files', () => {
  it('stamps the node input file names on trusted MCP bindings only', async () => {
    const result = await service().buildNodeRuntimeAgentMetadata(
      'owner-1',
      'node-1',
      { inputFiles: [{ name: 'test_2.txt' }, { name: 'other.csv' }, { name: '' }] },
      resolvedAgent(),
    );

    const bindings = (result?.connector_bindings ?? []) as Array<Record<string, unknown>>;
    const trusted = bindings.find((binding) => binding.connector_slug === 'pyodide');
    const external = bindings.find((binding) => binding.connector_slug === 'external');
    expect((trusted?.auth_headers as Record<string, string>)['X-YellowStorm-Input-Files']).toBe('test_2.txt,other.csv');
    expect((external?.auth_headers as Record<string, string>)['X-YellowStorm-Input-Files']).toBeUndefined();
  });

  it('does nothing when the node has no input files', async () => {
    const result = await service().buildNodeRuntimeAgentMetadata('owner-1', 'node-1', {}, resolvedAgent());
    const bindings = (result?.connector_bindings ?? []) as Array<Record<string, unknown>>;
    expect((bindings[0].auth_headers as Record<string, string>)['X-YellowStorm-Input-Files']).toBeUndefined();
  });
});
