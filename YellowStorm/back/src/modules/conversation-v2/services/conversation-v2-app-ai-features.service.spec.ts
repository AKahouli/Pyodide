import { ConversationV2AppAiFeaturesService } from './conversation-v2-app-ai-features.service';

describe('ConversationV2AppAiFeaturesService', () => {
  const revisions = {
    listFiles: jest.fn(),
    readRevisionFileText: jest.fn(),
  };
  const sessions = {
    setAiFeaturesFlag: jest.fn(),
    recordAiFeaturesCheckedWithoutDemote: jest.fn(),
  };

  const createService = () =>
    new ConversationV2AppAiFeaturesService(
      revisions as never,
      sessions as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('detectInRevision returns true for dynamic import of yellowmind-ai', async () => {
    revisions.listFiles.mockResolvedValueOnce({
      revisionId: 'rev_1',
      files: [{ path: 'src/pages/Chat.tsx' }],
    });
    revisions.readRevisionFileText.mockResolvedValueOnce(
      "const mod = await import('@/lib/yellowmind-ai');\nexport function Chat() { return mod }",
    );

    const svc = createService();
    await expect(svc.detectInRevision('ws_1', 'rev_1')).resolves.toBe(true);
  });

  it('detectInRevision returns true when a non-library source imports yellowmind-ai', async () => {
    revisions.listFiles.mockResolvedValueOnce({
      revisionId: 'rev_1',
      files: [
        { path: 'src/lib/yellowmind-ai.ts' },
        { path: 'src/pages/Chat.tsx' },
        { path: 'src/App.jsx' },
      ],
    });
    revisions.readRevisionFileText
      .mockResolvedValueOnce(
        "import { createAIClient } from '@/lib/yellowmind-ai';\nexport function Chat() {}",
      )
      .mockResolvedValueOnce('export default function App() { return null }');

    const svc = createService();
    await expect(svc.detectInRevision('ws_1', 'rev_1')).resolves.toBe(true);
    expect(revisions.readRevisionFileText).toHaveBeenCalledWith(
      'ws_1',
      'rev_1',
      'src/pages/Chat.tsx',
    );
  });

  it('detectInRevision ignores the yellowmind-ai library file itself', async () => {
    revisions.listFiles.mockResolvedValueOnce({
      revisionId: 'rev_1',
      files: [
        { path: 'src/lib/yellowmind-ai.ts' },
        { path: 'src/App.jsx' },
      ],
    });
    revisions.readRevisionFileText.mockResolvedValueOnce(
      'export default function App() { return <main>Ready</main> }',
    );

    const svc = createService();
    await expect(svc.detectInRevision('ws_1', 'rev_1')).resolves.toBe(false);
  });

  it('resolveForCatalog reuses cached false when checked revision matches', async () => {
    const svc = createService();
    const result = await svc.resolveForCatalog([
      {
        sessionId: 's1',
        workspaceId: 'ws_1',
        revisionId: 'rev_1',
        hasAiFeatures: false,
        aiFeaturesCheckedRevisionId: 'rev_1',
      },
    ]);
    expect(result.get('s1')).toBe(false);
    expect(revisions.listFiles).not.toHaveBeenCalled();
  });

  it('resolveForCatalog short-circuits when hasAiFeatures is already true', async () => {
    const svc = createService();
    const result = await svc.resolveForCatalog([
      {
        sessionId: 's1',
        workspaceId: 'ws_1',
        revisionId: 'rev_2',
        hasAiFeatures: true,
        aiFeaturesCheckedRevisionId: 'rev_1',
      },
    ]);
    expect(result.get('s1')).toBe(true);
    expect(revisions.listFiles).not.toHaveBeenCalled();
  });

  it('detectAndPersist does not demote a prior runtime true on a negative scan', async () => {
    revisions.listFiles.mockResolvedValueOnce({
      revisionId: 'rev_2',
      files: [{ path: 'src/App.jsx' }],
    });
    revisions.readRevisionFileText.mockResolvedValueOnce(
      'export default function App() { return null }',
    );
    sessions.recordAiFeaturesCheckedWithoutDemote.mockResolvedValueOnce(true);

    const svc = createService();
    await expect(svc.detectAndPersist('s1', 'ws_1', 'rev_2')).resolves.toBe(true);
    expect(sessions.setAiFeaturesFlag).not.toHaveBeenCalled();
    expect(sessions.recordAiFeaturesCheckedWithoutDemote).toHaveBeenCalledWith(
      's1',
      'rev_2',
    );
  });
});
