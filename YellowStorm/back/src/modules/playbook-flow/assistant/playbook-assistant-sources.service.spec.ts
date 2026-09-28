import { PlaybookAssistantSourcesService } from './playbook-assistant-sources.service';
import { resourceClarificationLines } from './playbook-assistant-sources.util';
import { parseDesignResourceLine } from '../utils/playbook-flow-safe-text.util';

const WORKSPACE = '507f1f77bcf86cd799439011';
const OTHER_WORKSPACE = '507f1f77bcf86cd799439012';
const FILE = '507f1f77bcf86cd799439013';

function createService(assessment: Record<string, unknown>) {
  let stored = { ...assessment };
  const requests = {
    findAwaitingContinuation: jest.fn(async () => ({
      requestId: 'request-1', ownerId: 'user-1', playbookId: null, requestedName: 'CV screening', assessment: stored,
    })),
    findAwaitingForPlaybook: jest.fn(),
    saveResourcePicks: jest.fn(async (_continuationId: string, _ownerId: string, picks: Record<string, unknown>) => {
      stored = { ...stored, resourcePicks: picks };
      return { requestId: 'request-1' };
    }),
  };
  const flows = { findOneBase: jest.fn() };
  const workspaces = { findById: jest.fn(async (id: string) => ({ id, name: id === WORKSPACE ? 'Recruiting' : 'HR shared' })) };
  const workspaceShares = { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) };
  const documents = {
    findByIds: jest.fn(async () => [{ id: FILE, workspaceId: OTHER_WORKSPACE, originalName: 'CV Ines.pdf', mimeType: 'application/pdf', isFolder: false }]),
  };
  const service = new PlaybookAssistantSourcesService(requests as never, flows as never, workspaces as never, workspaceShares as never, documents as never);
  return { service, requests, workspaceShares, flows };
}

const questions = [
  { id: 'source', question: 'Which CVs?', reason: 'The input of the screening', required: true, resourceSelector: 'workspace_or_document', choices: ['Workspace "CV"', 'SharePoint'] },
  { id: 'destination', question: 'Where to save the shortlist?', required: false, resourceSelector: 'destination_workspace' },
  { id: 'output', question: 'What output?', required: true },
];

describe('PlaybookAssistantSourcesService', () => {
  it('lists the waiting clarifications of a playbook that ask for a source, for the designer', async () => {
    const { service, requests, flows } = createService({ questions });
    const PLAYBOOK = '507f1f77bcf86cd799439099';
    flows.findOneBase.mockResolvedValue({ id: PLAYBOOK, name: 'CV screening' });
    requests.findAwaitingForPlaybook.mockResolvedValue([
      { continuationId: 'continuation-1', assessment: { questions } },
      { continuationId: 'continuation-2', assessment: { questions: [questions[2]] } },
    ]);
    await expect(service.pendingForPlaybook('user-1', PLAYBOOK)).resolves.toEqual({ items: [{ continuationId: 'continuation-1', playbookName: 'CV screening' }] });
    expect(requests.findAwaitingForPlaybook).toHaveBeenCalledWith(PLAYBOOK, 'user-1');
    await expect(service.pendingForPlaybook('user-1', 'not-an-id')).rejects.toThrow('Choose a playbook');
  });

  it('lists only the questions that ask for a source, with the playbook name', async () => {
    const { service } = createService({ questions });
    await expect(service.getSources('user-1', 'continuation-1')).resolves.toEqual({
      playbookName: 'CV screening',
      questions: [
        { id: 'source', question: 'Which CVs?', reason: 'The input of the screening', required: true, selector: 'workspace_or_document', choices: ['Workspace "CV"', 'SharePoint'], choice: null },
        { id: 'destination', question: 'Where to save the shortlist?', reason: '', required: false, selector: 'destination_workspace', choices: [], choice: null },
      ],
    });
  });

  it('keeps the chosen workspaces and files with their names once the user can open them, and shows no id', async () => {
    const { service, requests, workspaceShares } = createService({ questions });
    const result = await service.choose('user-1', 'continuation-1', 'source', {
      resources: [{ kind: 'workspace', id: WORKSPACE }, { kind: 'document', id: FILE }],
    });

    expect(workspaceShares.assertUserHasAccess).toHaveBeenCalledWith('user-1', [WORKSPACE, OTHER_WORKSPACE]);
    expect(requests.saveResourcePicks).toHaveBeenCalledWith('continuation-1', 'user-1', { source: { resources: [
      { kind: 'workspace', id: WORKSPACE, workspaceId: WORKSPACE, workspaceName: 'Recruiting', label: 'Recruiting' },
      { kind: 'document', id: FILE, workspaceId: OTHER_WORKSPACE, workspaceName: 'HR shared', label: 'CV Ines.pdf', mimeType: 'application/pdf' },
    ] } });
    expect(result.questions[0].choice).toEqual({ skipped: false, resources: [
      { kind: 'workspace', name: 'Recruiting', workspaceName: 'Recruiting' },
      { kind: 'document', name: 'CV Ines.pdf', workspaceName: 'HR shared' },
    ] });
    expect(JSON.stringify(result)).not.toContain(WORKSPACE);
  });

  it('skips a question, and clears a choice when nothing is chosen', async () => {
    const { service, requests } = createService({ questions, resourcePicks: { destination: { skipped: true } } });
    await service.choose('user-1', 'continuation-1', 'source', { skip: true });
    expect(requests.saveResourcePicks).toHaveBeenLastCalledWith('continuation-1', 'user-1', { destination: { skipped: true }, source: { skipped: true } });
    await service.choose('user-1', 'continuation-1', 'destination', { resources: [] });
    expect(requests.saveResourcePicks).toHaveBeenLastCalledWith('continuation-1', 'user-1', { source: { skipped: true } });
  });

  it('keeps one of the question\'s own answers that is not a workspace, and only those', async () => {
    const { service, requests } = createService({ questions });
    const result = await service.choose('user-1', 'continuation-1', 'source', { choice: 'SharePoint' });
    expect(requests.saveResourcePicks).toHaveBeenCalledWith('continuation-1', 'user-1', { source: { choice: 'SharePoint' } });
    expect(result.questions[0].choice).toEqual({ skipped: false, option: 'SharePoint', resources: [] });
    await expect(service.choose('user-1', 'continuation-1', 'source', { choice: 'Dropbox' })).rejects.toThrow('not one of the answers');
  });

  it('refuses a question that asks for no source, a file for a destination, and a waiting request that is gone', async () => {
    const { service, requests } = createService({ questions });
    await expect(service.choose('user-1', 'continuation-1', 'output', { skip: true })).rejects.toThrow('does not ask for a source');
    await expect(service.choose('user-1', 'continuation-1', 'destination', { resources: [{ kind: 'document', id: FILE }] })).rejects.toThrow('one workspace');
    requests.findAwaitingContinuation.mockResolvedValueOnce(null as never);
    await expect(service.getSources('user-1', 'continuation-1')).rejects.toThrow('already answered or have expired');
    requests.saveResourcePicks.mockResolvedValueOnce(null as never);
    await expect(service.choose('user-1', 'continuation-1', 'source', { skip: true })).rejects.toThrow('already continued');
  });
});

describe('resourceClarificationLines', () => {
  it('writes lines the construction reads as trusted resources', () => {
    const [line] = resourceClarificationLines(
      [{ id: 'source', question: 'Which CVs: all?' }],
      [{ questionId: 'source', resources: [{ kind: 'document', id: FILE, workspaceId: OTHER_WORKSPACE, workspaceName: 'HR, shared', label: 'Grid [v2].xlsx', mimeType: 'application/pdf' }] }],
    );
    expect(parseDesignResourceLine(line)).toEqual({
      question: 'Which CVs - all?',
      label: 'Grid (v2).xlsx',
      metadata: `kind=document, id=${FILE}, workspaceId=${OTHER_WORKSPACE}, workspaceName=HR, shared, mimeType=application/pdf`,
    });
  });
});
