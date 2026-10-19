import { ConversationArtifactService } from './conversation-artifact.service';
import { ImageHistoryDto } from '../dto/image-history.dto';
import { validate } from 'class-validator';

describe('Conversation image history', () => {
  const original = 'a'.repeat(24), firstEdit = 'b'.repeat(24), secondEdit = 'c'.repeat(24), unrelated = 'd'.repeat(24);
  const source = (id: string) => `generated-image:${id}`;
  const image = (id: string, parent?: string) => ({ id, workspaceId: 'workspace', originalName: `generated-${id}.png`,
    path: `private/${id}.png`, mimeType: 'image/png', status: 'completed', createdAt: `2026-10-15T10:00:0${id === original ? 0 : id === firstEdit ? 1 : 2}.000Z`,
    metadata: parent ? { imageParentId: parent } : {}, isFolder: false });
  function setup() {
    const images = [image(original), image(firstEdit, original), image(secondEdit, firstEdit), image(unrelated)];
    const messages = { getMessageDocument: jest.fn(async () => ({ conversationId: 'conversation', conversationType: 'ai', content: source(firstEdit) })) };
    const conversations = { getConversationDocument: jest.fn(async () => ({ systemWorkspaceId: 'workspace' })) };
    const workspaces = {
      findById: jest.fn(async (_workspace: string, id: string) => images.find(value => value.id === id)),
      findByMultipleWorkspaces: jest.fn(async () => ({ documents: images, pagination: { total: images.length } })),
    };
    const storage = { generateSasUrl: jest.fn(async (path: string) => `https://storage.example/${path}`) };
    const service = new ConversationArtifactService(messages as never, storage as never, conversations as never, workspaces as never);
    return { service, images, messages, conversations, workspaces, storage };
  }
  it('reloads only the server-recorded family and resolves a selected older or newer version', async () => {
    const t = setup();
    const result = await t.service.resolveGeneratedImageHistory('conversation', 'answer', firstEdit, source(original));
    expect(result.versions.map(value => value.source)).toEqual([source(original), source(firstEdit), source(secondEdit)]);
    expect(result.versions[1].parentSource).toBe(source(original));
    expect(result.selected).toMatchObject({ source: source(original), url: `https://storage.example/private/${original}.png` });
    const reloaded = await t.service.resolveGeneratedImageHistory('conversation', 'answer', firstEdit, source(secondEdit));
    expect(reloaded.selected.source).toBe(source(secondEdit));
    expect(t.workspaces.findByMultipleWorkspaces).toHaveBeenCalledWith(['workspace'], expect.objectContaining({ limit: 1000 }));
  });
  it('rejects unrelated version selectors before signing their paths', async () => {
    const t = setup();
    await expect(t.service.resolveGeneratedImageHistory('conversation', 'answer', firstEdit, source(unrelated))).rejects.toThrow('not found');
    expect(t.storage.generateSasUrl).not.toHaveBeenCalledWith(`private/${unrelated}.png`, expect.anything());
  });
  it('rejects foreign answer scopes before enumerating history', async () => {
    const t = setup();
    await expect(t.service.resolveGeneratedImageHistory('other-conversation', 'answer', firstEdit)).rejects.toThrow('not found');
    expect(t.workspaces.findByMultipleWorkspaces).not.toHaveBeenCalled();
    expect(t.storage.generateSasUrl).not.toHaveBeenCalled();
  });
  it('never invents history for legacy images or follows foreign-workspace metadata', async () => {
    const t = setup(); t.images[1].metadata = {};
    t.images[2].workspaceId = 'foreign-workspace';
    const result = await t.service.resolveGeneratedImageHistory('conversation', 'answer', firstEdit);
    expect(result.versions.map(value => value.source)).toEqual([source(firstEdit)]);
    expect(result.selected.parentSource).toBeUndefined();
  });
  it('fails explicitly for cyclic or incomplete history instead of returning a partial list', async () => {
    const t = setup(); t.images[0].metadata = { imageParentId: secondEdit };
    await expect(t.service.resolveGeneratedImageHistory('conversation', 'answer', firstEdit)).rejects.toThrow('not found');
    t.images[0].metadata = {};
    t.workspaces.findByMultipleWorkspaces.mockResolvedValueOnce({ documents: t.images, pagination: { total: 1001 } });
    await expect(t.service.resolveGeneratedImageHistory('conversation', 'answer', firstEdit)).rejects.toThrow('limit');
  });
  it('validates selectors as image references, never paths or URLs', async () => {
    for (const value of ['../../private.png', 'https://storage.example/private.png', 'generated-image:bad']) {
      expect(await validate(Object.assign(new ImageHistoryDto(), { versionSource: value }))).not.toHaveLength(0);
    }
    expect(await validate(Object.assign(new ImageHistoryDto(), { versionSource: source(original) }))).toHaveLength(0);
  });
});
