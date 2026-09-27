import AdmZip = require('adm-zip');
import { BadRequestException } from '@modules/exceptions';
import { extractTemplateArchive } from './template-zip.util';

function buildZip(entries: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [path, content] of Object.entries(entries)) {
    zip.addFile(path, Buffer.from(content, 'utf8'));
  }
  return zip.toBuffer();
}

describe('extractTemplateArchive', () => {
  it('keeps shippable source files and drops build output, locks and maps', () => {
    const files = extractTemplateArchive(
      buildZip({
        'package.json': '{}',
        'src/App.jsx': 'app',
        'src/App.jsx.map': 'map',
        'node_modules/react/index.js': 'react',
        'dist/bundle.js': 'bundle',
        'README.md': 'readme',
        'package-lock.json': '{}',
      }),
    );

    expect(files.map((f) => f.path)).toEqual(['package.json', 'src/App.jsx']);
  });

  it('rejects an empty archive', () => {
    expect(() => extractTemplateArchive(buildZip({ 'README.md': 'x' }))).toThrow(
      BadRequestException,
    );
  });

  it('rejects a buffer that is not a ZIP', () => {
    expect(() => extractTemplateArchive(Buffer.from('not a zip'))).toThrow(BadRequestException);
  });
});
