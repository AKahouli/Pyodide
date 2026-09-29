import AdmZip = require('adm-zip');
import { BadRequestException } from '@modules/exceptions';
import { extractTemplateArchive, stripSingleRootPrefix } from './template-zip.util';

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

  it('flattens a GitHub-style single-folder ZIP to the Vite project root', () => {
    const files = extractTemplateArchive(
      buildZip({
        'material-kit-react-main/package.json': '{"name":"mk"}',
        'material-kit-react-main/index.html': '<html></html>',
        'material-kit-react-main/src/App.jsx': 'export default function App() {}',
        'material-kit-react-main/src/main.jsx': 'import App from "./App"',
        'material-kit-react-main/node_modules/x/index.js': 'skip',
        'material-kit-react-main/README.md': 'skip',
      }),
    );

    expect(files.map((f) => f.path)).toEqual([
      'index.html',
      'package.json',
      'src/App.jsx',
      'src/main.jsx',
    ]);
    expect(files.find((f) => f.path === 'src/App.jsx')?.data.toString('utf8')).toContain(
      'export default function App',
    );
  });

  it('does not flatten when the archive already has a flat Vite root', () => {
    const files = extractTemplateArchive(
      buildZip({
        'package.json': '{}',
        'src/App.jsx': 'app',
      }),
    );

    expect(files.map((f) => f.path)).toEqual(['package.json', 'src/App.jsx']);
  });

  it('does not flatten when several top-level directories are present', () => {
    const files = extractTemplateArchive(
      buildZip({
        'frontend/package.json': '{}',
        'backend/package.json': '{}',
      }),
    );

    expect(files.map((f) => f.path)).toEqual(['backend/package.json', 'frontend/package.json']);
  });

  it('does not peel a real src/ folder when there is no project root marker', () => {
    const files = extractTemplateArchive(
      buildZip({
        'src/App.jsx': 'app',
        'src/main.jsx': 'main',
      }),
    );

    expect(files.map((f) => f.path)).toEqual(['src/App.jsx', 'src/main.jsx']);
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

describe('stripSingleRootPrefix', () => {
  it('returns the input unchanged when there is no shared directory prefix', () => {
    const files = [{ path: 'package.json', data: Buffer.from('{}') }];
    expect(stripSingleRootPrefix(files)).toEqual(files);
  });
});
