import { createHash } from 'crypto';
import AdmZip = require('adm-zip');
import { BadRequestException } from '@modules/exceptions';
import { DocumentService } from '@modules/document/document.service';
import { blobObjectKey } from '@modules/app-runtime/utils/blob-object-key';
import { ConversationV2TemplatePublishService } from './conversation-v2-template-publish.service';

function buildZip(entries: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [path, content] of Object.entries(entries)) {
    zip.addFile(path, Buffer.from(content, 'utf8'));
  }
  return zip.toBuffer();
}

const PLAIN_VITE: Record<string, string> = {
  'package.json': JSON.stringify({
    name: 'tpl',
    scripts: { dev: 'vite' },
    devDependencies: { vite: '^6.3.5' },
  }),
  'index.html': '<script type="module" src="/src/main.jsx"></script>',
  'vite.config.js': "import { defineConfig } from 'vite';\nexport default defineConfig({});\n",
  'src/main.jsx': "import App from './App';\ncreateRoot(root).render(<App />);\n",
  'src/App.jsx': 'export default function App() { return <div />; }\n',
};

/** Smallest archive that clears the publish gate, for the storage mechanics. */
const GATE_OK: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'a', devDependencies: { vite: '^6.3.5' } }),
  'index.html': '<script type="module" src="/src/main.jsx"></script>',
  'src/App.jsx': 'app',
};

const NEXT_JS: Record<string, string> = {
  'package.json': JSON.stringify({
    name: 'next-app',
    scripts: { dev: 'next dev' },
    dependencies: { next: '14.0.0' },
  }),
  'src/App.jsx': 'export default function App() { return <div />; }\n',
};

describe('ConversationV2TemplatePublishService', () => {
  const exists = jest.fn();
  const upload = jest.fn<Promise<unknown>, [Buffer, string, string, unknown]>();
  const deleteMany = jest.fn();
  let svc: ConversationV2TemplatePublishService;

  beforeEach(() => {
    jest.clearAllMocks();
    exists.mockResolvedValue(false);
    upload.mockResolvedValue({});
    deleteMany.mockResolvedValue(undefined);
    svc = new ConversationV2TemplatePublishService({
      exists,
      upload,
      deleteMany,
    } as unknown as DocumentService);
  });

  it('uploads content-addressed blobs and the system manifest', async () => {
    const result = await svc.publish('tpl_1', buildZip(GATE_OK));

    expect(result.revisionId).toBe('template_tpl_1');
    expect(result.manifestObjectKey).toBe(
      'appbuilder/manifests/_system/template_tpl_1.json',
    );
    expect(result.fileCount).toBe(3);
    expect(result.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.files.map((file) => file.path)).toEqual([
      'index.html',
      'package.json',
      'src/App.jsx',
    ]);

    const sha = createHash('sha256').update('app').digest('hex');
    expect(upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      'App.jsx',
      'application/octet-stream',
      {
        generateUniqueName: false,
        customFileName: blobObjectKey(sha),
        skipMimeValidation: true,
      },
    );
    expect(upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      'template_tpl_1.json',
      'application/json',
      {
        generateUniqueName: false,
        customFileName: 'appbuilder/manifests/_system/template_tpl_1.json',
      },
    );
  });

  it('stores the template source without the Platform Kit', async () => {
    const result = await svc.publish('tpl_kit', buildZip(PLAIN_VITE));

    expect(result.files.map((file) => file.path)).not.toContain('src/AppRouter.tsx');
    expect(result.files.map((file) => file.path)).not.toContain('yellowstorm.platform.json');
    expect(result.platformReport.injectedFiles).toContain('src/AppRouter.tsx');
  });

  it('publishes a nested GitHub ZIP with flattened project-root paths', async () => {
    const result = await svc.publish(
      'tpl_nested',
      buildZip({
        'material-kit-react-main/package.json':
          '{"name":"mk","devDependencies":{"vite":"^6.3.5"}}',
        'material-kit-react-main/src/App.jsx': 'export default function App() { return null; }',
        'material-kit-react-main/index.html': '<script type="module" src="/src/main.jsx"></script>',
      }),
    );

    expect(result.files.map((file) => file.path)).toEqual([
      'index.html',
      'package.json',
      'src/App.jsx',
    ]);
    expect(result.platformReport.appRoot).toBe('src/App.jsx');
  });

  it('reuses a blob that already exists in Ceph', async () => {
    exists.mockResolvedValue(true);
    const result = await svc.publish('tpl_2', buildZip(GATE_OK));

    // Only the system manifest is written; every blob is already addressable.
    expect(result.fileCount).toBe(3);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]?.[1]).toBe('template_tpl_2.json');
  });

  it('uploads blobs in bounded parallel batches and keeps a stable order', async () => {
    let inFlight = 0;
    let peak = 0;
    exists.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return false;
    });

    const entries: Record<string, string> = { ...GATE_OK };
    for (let i = 0; i < 20; i += 1) {
      entries[`src/file${String(i).padStart(2, '0')}.js`] = `content-${String(i)}`;
    }
    const result = await svc.publish('tpl_4', buildZip(entries));

    expect(result.fileCount).toBe(23);
    expect(result.files.map((file) => file.path)).toEqual(
      Object.keys(entries).sort((a, b) => a.localeCompare(b)),
    );
    expect(upload).toHaveBeenCalledTimes(24); // 23 blobs + manifest
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
  });

  it('blocks an incompatible publish before any Ceph write', async () => {
    await expect(svc.publish('tpl_next', buildZip(NEXT_JS))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(upload).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();
  });

  it('removes cover, manifest, and caller-supplied blob keys', async () => {
    await svc.removeTemplateArtifacts([
      {
        coverImage: 'appbuilder/templates/tpl_3/cover.png',
        manifestObjectKey: 'appbuilder/manifests/_system/template_tpl_3.json',
        objectKeys: ['appbuilder/blobs/sha256/aa/aabb'],
      },
    ]);

    expect(deleteMany).toHaveBeenCalledWith([
      'appbuilder/templates/tpl_3/cover.png',
      'appbuilder/manifests/_system/template_tpl_3.json',
      'appbuilder/blobs/sha256/aa/aabb',
    ]);
  });

  it('skips null and missing object keys', async () => {
    await svc.removeTemplateArtifacts([
      {},
      { coverImage: null, manifestObjectKey: null },
      { coverImage: 'appbuilder/templates/tpl_4/cover.png' },
    ]);

    expect(deleteMany).toHaveBeenCalledWith(['appbuilder/templates/tpl_4/cover.png']);
  });

  it('does not call Ceph when every key is empty', async () => {
    await svc.removeTemplateArtifacts([{}, { coverImage: '', manifestObjectKey: null }]);

    expect(deleteMany).not.toHaveBeenCalled();
  });
});
