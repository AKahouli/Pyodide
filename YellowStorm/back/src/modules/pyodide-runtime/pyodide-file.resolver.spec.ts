import { PyodideFileError, PyodideFileResolver } from './pyodide-file.resolver';

const USER_ID = '65f000000000000000000001';
const WORKSPACE_ID = '65f0000000000000000000aa';
const CONVERSATION_ID = '65f0000000000000000000cc';

function resolverWith(documents: unknown, documentStore: unknown): PyodideFileResolver {
  return new PyodideFileResolver(
    documents as never,
    documentStore as never,
    {} as never,
    { findById: jest.fn().mockResolvedValue({ createdBy: USER_ID }) } as never,
    {} as never,
    { get: jest.fn().mockReturnValue(undefined) } as never,
  );
}

describe('PyodideFileResolver.publishOutput', () => {
  it('copies the persisted output into the conversation system prefix', async () => {
    const documents = {
      findAllByWorkspace: jest.fn().mockResolvedValue({
        documents: [{
          id: 'doc-1',
          originalName: 'rapport.pdf',
          path: `${USER_ID}/workspaces/${WORKSPACE_ID}/rapport.pdf`,
          mimeType: 'application/pdf',
          size: 1234,
          isFolder: false,
        }],
      }),
    };
    const documentStore = { copy: jest.fn().mockResolvedValue(undefined) };
    const resolver = resolverWith(documents, documentStore);

    const receipt = await resolver.publishOutput(USER_ID, WORKSPACE_ID, CONVERSATION_ID, 'rapport.pdf');

    expect(documentStore.copy).toHaveBeenCalledWith(
      `${USER_ID}/workspaces/${WORKSPACE_ID}/rapport.pdf`,
      `${USER_ID}/system_${CONVERSATION_ID}/rapport.pdf`,
    );
    expect(receipt).toEqual({
      ceph_path: `${USER_ID}/system_${CONVERSATION_ID}/rapport.pdf`,
      filename: 'rapport.pdf',
      mime_type: 'application/pdf',
      size: 1234,
    });
  });

  it('refuses path-like or missing context inputs without touching storage', async () => {
    const documents = { findAllByWorkspace: jest.fn() };
    const documentStore = { copy: jest.fn() };
    const resolver = resolverWith(documents, documentStore);

    await expect(resolver.publishOutput(USER_ID, WORKSPACE_ID, CONVERSATION_ID, '../escape.pdf'))
      .rejects.toThrow(PyodideFileError);
    await expect(resolver.publishOutput(USER_ID, WORKSPACE_ID, '', 'a.pdf'))
      .rejects.toThrow(PyodideFileError);
    expect(documentStore.copy).not.toHaveBeenCalled();
    expect(documents.findAllByWorkspace).not.toHaveBeenCalled();
  });

  it('surfaces a clean error when the output was never persisted', async () => {
    const documents = { findAllByWorkspace: jest.fn().mockResolvedValue({ documents: [] }) };
    const documentStore = { copy: jest.fn() };
    const resolver = resolverWith(documents, documentStore);

    await expect(resolver.publishOutput(USER_ID, WORKSPACE_ID, CONVERSATION_ID, 'nope.pdf'))
      .rejects.toThrow('File not found in the workspace: nope.pdf');
    expect(documentStore.copy).not.toHaveBeenCalled();
  });
});
