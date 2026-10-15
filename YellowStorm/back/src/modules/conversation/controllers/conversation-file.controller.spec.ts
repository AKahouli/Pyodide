import { ConversationFileController } from './conversation-file.controller';

describe('ConversationFileController attachment policy', () => {
  const enabled = jest.fn<Promise<boolean>, []>();
  const ensureSystemWorkspace = jest.fn().mockResolvedValue('workspace-1');
  const documents = {
    requestUploadUrlWithPath: jest.fn(),
    uploadSmallFileWithPath: jest.fn(),
    confirmUpload: jest.fn(),
  };
  type Dependencies = ConstructorParameters<typeof ConversationFileController>;
  const controller = new ConversationFileController(
    { ensureSystemWorkspace } as unknown as Dependencies[0],
    {} as Dependencies[1], documents as unknown as Dependencies[2],
    { isAttachmentIntelligenceEnabled: enabled } as unknown as Dependencies[3],
    { setContext: jest.fn(), log: jest.fn() } as unknown as Dependencies[4],
  );
  const invoke = {
    'upload URL': () => controller.requestUploadUrl({ _id: 'user-1' }, 'conversation-1', { filename: 'image.png', mimeType: 'image/png', size: 3 }),
    'small upload': () => controller.uploadSmallFile({ _id: 'user-1' }, 'conversation-1', { fieldname: 'file', originalname: 'image.png', encoding: '7bit', mimetype: 'image/png', size: 3, buffer: Buffer.from('png') }),
    confirmation: () => controller.confirmUpload({ _id: 'user-1' }, 'conversation-1', { documentId: 'document-1' }),
  };

  beforeEach(() => jest.clearAllMocks());

  it.each(Object.entries(invoke))('%s waits for refreshed settings before touching storage', async (_, request) => {
    let resolve!: (value: boolean) => void;
    enabled.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const result = request();
    expect(ensureSystemWorkspace).not.toHaveBeenCalled();
    resolve(true);
    await result;
    expect(ensureSystemWorkspace).toHaveBeenCalledWith('user-1', 'conversation-1');
  });

  it.each(Object.entries(invoke))('%s rejects an explicitly disabled policy', async (_, request) => {
    enabled.mockResolvedValueOnce(false);
    await expect(request()).rejects.toThrow('Conversation file attachments are disabled');
    expect(ensureSystemWorkspace).not.toHaveBeenCalled();
  });

  it('fails closed when the policy cannot be loaded', async () => {
    enabled.mockRejectedValueOnce(new Error('settings unavailable'));
    await expect(invoke['upload URL']()).rejects.toThrow('settings unavailable');
    expect(ensureSystemWorkspace).not.toHaveBeenCalled();
  });
});
