import { conversationV2Api } from '../api';
import type { FilesTreeNode } from '../types';
import { isTextSourcePath } from '../utils/app-source';
import { flattenFilesTree } from '../utils/files-tree';

const LOG = '[RevisionHydrator]';

function log(phase: string, details?: Record<string, unknown>) {
  if (details) {
    console.log(`${LOG} [${phase}]`, details);
  } else {
    console.log(`${LOG} [${phase}]`);
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(invalid-url)';
  }
}

/**
 * Bundled Vite/React starter for new sessions with no existing Ceph sources.
 * Matches the APImanus stub's _STUB_STARTER_FILES.
 */
const STARTER_PACKAGE_JSON = `{
  "name": "yellowmind-starter",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "vite": "^6.3.5"
  }
}`;

const STARTER_INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>YellowMind Starter</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>`;

const STARTER_VITE_CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});`;

const STARTER_MAIN_JSX = `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);`;

const STARTER_APP_JSX = `import React from 'react';

export default function App() {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', textAlign: 'center' }}>
      <h1>YellowMind Starter</h1>
      <p>Edit <code>src/App.jsx</code> to get started.</p>
    </div>
  );
}`;

export type VfsFiles = Record<string, string | Uint8Array>;

export class RevisionHydrator {
  /**
   * Download project files from Ceph via presigned URLs.
   * Mirrors the old `fetchProjectFiles` from useNodepodPreview.
   */
  async hydrateFromCeph(
    sessionId: string,
    cephPath: string,
    filesTree: FilesTreeNode,
  ): Promise<VfsFiles> {
    const flat = flattenFilesTree(filesTree);
    log('flatten-tree', { fileCount: flat.length, samplePaths: flat.slice(0, 8).map((f) => f.path) });
    if (flat.length === 0) {
      throw new Error('No source files in tree');
    }

    const paths = flat.map((f) => f.path);
    log('presign-urls:request', { sessionId, cephPath, pathCount: paths.length });
    const { items } = await conversationV2Api.getAppSourceUrls(sessionId, cephPath, paths);
    log('presign-urls:response', {
      itemCount: items.length,
      sample: items.slice(0, 3).map((i) => ({ path: i.path, urlHost: safeHost(i.url) })),
    });

    log('download:start', { itemCount: items.length });
    const files: VfsFiles = {};
    let textCount = 0;
    let binaryCount = 0;
    let skippedCount = 0;

    await Promise.all(
      items.map(async ({ path, url }) => {
        const res = await fetch(url);
        if (!res.ok) {
          const base = path.split('/').pop() ?? path;
          const required = base === 'package.json';
          if (!required) {
            skippedCount += 1;
            log('download:skip', { path, status: res.status });
            return;
          }
          throw new Error(`Failed to download ${path} (${res.status})`);
        }
        const vfsPath = path.startsWith('/') ? path : `/${path}`;
        if (isTextSourcePath(path)) {
          files[vfsPath] = await res.text();
          textCount += 1;
        } else {
          files[vfsPath] = new Uint8Array(await res.arrayBuffer());
          binaryCount += 1;
        }
      }),
    );

    log('download:done', {
      vfsFileCount: Object.keys(files).length,
      textCount,
      binaryCount,
      skippedCount,
      hasPackageJson: typeof files['/package.json'] === 'string',
    });
    return files;
  }

  /** Return the bundled Vite/React starter for a brand-new session. */
  hydrateStarter(): VfsFiles {
    log('hydrateStarter');
    return {
      '/package.json': STARTER_PACKAGE_JSON,
      '/index.html': STARTER_INDEX_HTML,
      '/vite.config.js': STARTER_VITE_CONFIG,
      '/src/main.jsx': STARTER_MAIN_JSX,
      '/src/App.jsx': STARTER_APP_JSX,
    };
  }

  /**
   * Write/overwrite files into a running Nodepod pod's VFS.
   * Used after `runtime.rehydrate` to bring the pod up to date.
   */
  async syncToRevision(
    pod: { fs: { writeFile: (path: string, content: string | Uint8Array) => Promise<void>; mkdir: (path: string, opts?: { recursive?: boolean }) => Promise<void> } },
    files: VfsFiles,
  ): Promise<void> {
    log('syncToRevision:start', { fileCount: Object.keys(files).length });
    const dirs = new Set<string>();
    for (const path of Object.keys(files)) {
      const dir = path.substring(0, path.lastIndexOf('/'));
      if (dir && dir !== '/') dirs.add(dir);
    }
    for (const dir of dirs) {
      try {
        await pod.fs.mkdir(dir, { recursive: true });
      } catch {
        // already exists
      }
    }
    await Promise.all(
      Object.entries(files).map(async ([path, content]) => {
        await pod.fs.writeFile(path, content);
      }),
    );
    log('syncToRevision:done');
  }
}
