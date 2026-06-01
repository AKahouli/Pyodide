import { FlowWorkspacePolicyService } from './flow-workspace-policy.service';
import { BadRequestException } from '../../exceptions/exceptions/http.exceptions';

describe('FlowWorkspacePolicyService', () => {
  const service = new FlowWorkspacePolicyService();

  it('normalizes workspace selection to the first non-empty workspace', () => {
    expect(service.normalizeWorkspaces([' ', 'workspace-1', 'workspace-2'])).toEqual(['workspace-1']);
  });

  it('rejects empty workspace selections', () => {
    expect(() => service.ensureWorkspaceSelection([])).toThrow(BadRequestException);
  });
});
