import { FlowWorkspacePolicyService } from './flow-workspace-policy.service';

describe('FlowWorkspacePolicyService', () => {
  const service = new FlowWorkspacePolicyService();

  it('normalizes workspace selection to the first non-empty workspace', () => {
    expect(service.normalizeWorkspaces([' ', 'workspace-1', 'workspace-2'])).toEqual(['workspace-1']);
  });

  it('normalizes omitted and empty workspace selections to no default', () => {
    expect(service.normalizeWorkspaces()).toEqual([]);
    expect(service.normalizeWorkspaces([' ', ''])).toEqual([]);
  });
});
