import { createHash } from 'crypto';
import AdmZip = require('adm-zip');
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

describe('ConversationV2TemplatePublishService', () => {
  const exists = jest.fn();
  const upload = jest.fn();
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
    const result = await svc.publish(
      'tpl_1',
      buildZip({ 'package.json': '{"name":"a"}', 'src/App.jsx': 'app' }),
    );

    expect(result.revisionId).toBe('template_tpl_1');
    expect(result.manifestObjectKey).toBe(
      'appbuilder/manifests/_system/template_tpl_1.json',
    );
    expect(result.fileCount).toBe(2);
    expect(result.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.files).toHaveLength(2);
    expect(result.files.map((file) => file.path)).toEqual(['package.json', 'src/App.jsx']);

    const sha = createHash('sha256').update('app').digest('hex');
    expect(upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      'App.jsx',
      'text/plain',
      { generateUniqueName: false, customFileName: blobObjectKey(sha) },
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

  it('publishes a nested GitHub ZIP with flattened project-root paths', async () => {
    const result = await svc.publish(
      'tpl_nested',
      buildZip({
        'material-kit-react-main/package.json': '{"name":"mk"}',
        'material-kit-react-main/src/App.jsx': 'export default function App() { return null; }',
        'material-kit-react-main/index.html': '<html><body><div id="root"></div></body></html>',
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
    await svc.publish('tpl_2', buildZip({ 'package.json': '{}' }));

    const blobUploads = upload.mock.calls.filter((call) => call[2] === 'text/plain');
    expect(blobUploads).toHaveLength(0);
  });

  it('uploads blobs in bounded parallel batches and keeps ZIP order', async () => {
    let inFlight = 0;
    let peak = 0;
    exists.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return false;
    });

    const entries: Record<string, string> = {};
    for (let i = 0; i < 20; i += 1) {
      entries[`src/file${String(i).padStart(2, '0')}.js`] = `content-${i}`;
    }
    const result = await svc.publish('tpl_4', buildZip(entries));

    expect(result.fileCount).toBe(20);
    expect(result.files.map((file) => file.path)).toEqual(Object.keys(entries));
    expect(upload).toHaveBeenCalledTimes(21); // 20 blobs + manifest
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
  });

  it('removes cover and manifest artifacts without touching blobs', async () => {
    await svc.removeTemplateArtifacts([
      {
        coverImage: 'appbuilder/templates/tpl_3/cover.png',
        manifestObjectKey: 'appbuilder/manifests/_system/template_tpl_3.json',
      } as never,
    ]);

    expect(deleteMany).toHaveBeenCalledWith([
      'appbuilder/templates/tpl_3/cover.png',
      'appbuilder/manifests/_system/template_tpl_3.json',
    ]);
  });
});
