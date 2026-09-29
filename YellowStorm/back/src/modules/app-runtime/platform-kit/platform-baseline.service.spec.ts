import { PlatformBaselineService, type BaselineMode } from './platform-baseline.service';
import type { RuntimeRevisionService } from '../services/runtime-revision.service';
import {
  PLATFORM_KIT_FILES,
  PLATFORM_MANIFEST_PATH,
  readPlatformKitFile,
} from './platform-kit';

/** Minimal in-memory stand-in for the Ceph-backed revision store. */
function revisionsFor(files: Record<string, string>): {
  service: RuntimeRevisionService;
  files: Record<string, string>;
} {
  const state = { ...files };
  const service = {
    getAuthorizedRevision: jest.fn(async () => ({
      revisionId: 'rev_1',
      workspaceId: 'ws',
      parentRevisionId: null,
      manifestHash: 'h',
      manifestObjectKey: 'k',
      files: Object.keys(state).map((path) => ({ path, sha256: 'x', objectKey: 'o', size: 1 })),
    })),
    readRevisionFileText: jest.fn(async (_ws: string, _rev: string, path: string) =>
      state[path] ?? null,
    ),
    patchRevisionWithFiles: jest.fn(async (input: any) => {
      for (const file of input.additionalFiles) state[file.path] = file.content;
      return { revisionId: input.newRevisionId, files: [] };
    }),
  } as unknown as RuntimeRevisionService;
  return { service, files: state };
}

async function plan(files: Record<string, string>, mode: BaselineMode = 'seed') {
  const { service } = revisionsFor(files);
  return new PlatformBaselineService(service).planBaseline({
    workspaceId: 'ws',
    revisionId: 'rev_1',
    mode,
  });
}

const BARE_TEMPLATE: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'tpl', dependencies: { react: '^18.2.0' } }),
  'index.html': '<html><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
  'vite.config.js': "import { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [] });\n",
  'src/main.jsx':
    "import { createRoot } from 'react-dom/client';\nimport Home from './Home';\nimport './index.css';\ncreateRoot(document.getElementById('root')).render(<Home />);\n",
  'src/Home.jsx': 'export default function Home() { return <div>hi</div>; }\n',
  'src/index.css': 'body { margin: 0 }\n',
};

describe('PlatformBaselineService', () => {
  it('loads every platform kit file from the template sources', () => {
    for (const file of PLATFORM_KIT_FILES) {
      expect(readPlatformKitFile(file).length).toBeGreaterThan(0);
    }
  });

  it('injects the full platform kit into a template that has none of it', async () => {
    const result = await plan(BARE_TEMPLATE);
    const written = new Set(result.files.map((file) => file.path));

    expect(result.violations).toEqual([]);
    for (const file of PLATFORM_KIT_FILES) {
      expect(written.has(file.path)).toBe(true);
    }
    expect(written.has(PLATFORM_MANIFEST_PATH)).toBe(true);
    expect(result.entry).toBe('src/main.jsx');
    expect(result.appRoot).toBe('src/App.jsx');
  });

  it('mounts the platform router from the entry and re-exports the template root', async () => {
    const result = await plan(BARE_TEMPLATE);
    const entry = result.files.find((file) => file.path === 'src/main.jsx')!;
    const appRoot = result.files.find((file) => file.path === 'src/App.jsx')!;

    expect(entry.content).toContain("import { AppRouter } from './AppRouter'");
    expect(entry.content).toContain("import './index.css';");
    expect(appRoot.content).toContain("import Home from './Home'");
  });

  it('adds the deploy base path and @ alias to an existing vite config', async () => {
    const result = await plan(BARE_TEMPLATE);
    const vite = result.files.find((file) => file.path === 'vite.config.js')!;

    expect(vite.content).toContain("base: process.env.VITE_APP_BASE || '/'");
    expect(vite.content).toContain("'@':");
    expect(vite.content).toContain('plugins: []');
  });

  it('adds missing dependencies without overriding template versions', async () => {
    const result = await plan(BARE_TEMPLATE);
    const pkg = JSON.parse(
      result.files.find((file) => file.path === 'package.json')!.content,
    );

    expect(pkg.dependencies.react).toBe('^18.2.0');
    expect(pkg.dependencies['react-router-dom']).toBeDefined();
    expect(pkg.dependencies.openai).toBeDefined();
    expect(pkg.scripts.build).toBe('vite build');
  });

  it('is idempotent: a normalized revision needs no further changes', async () => {
    const { service, files } = revisionsFor(BARE_TEMPLATE);
    const baseline = new PlatformBaselineService(service);

    await baseline.applyBaseline({
      workspaceId: 'ws',
      baseRevisionId: 'rev_0',
      newRevisionId: 'rev_1',
      mode: 'seed',
    });
    const second = await baseline.planBaseline({
      workspaceId: 'ws',
      revisionId: 'rev_1',
      mode: 'seed',
    });

    expect(files['src/AppRouter.tsx']).toBeDefined();
    expect(second.violations).toEqual([]);
    expect(second.files).toEqual([]);
  });

  it('strips a router the template mounts itself', async () => {
    const result = await plan({
      ...BARE_TEMPLATE,
      'src/App.jsx':
        "import { BrowserRouter, Routes, Route } from 'react-router-dom';\n" +
        'export default function App() {\n  return (\n    <BrowserRouter>\n      <Routes><Route path="/" element={<div />} /></Routes>\n    </BrowserRouter>\n  );\n}\n',
    });
    const appRoot = result.files.find((file) => file.path === 'src/App.jsx')!;

    expect(result.violations).toEqual([]);
    expect(appRoot.content).not.toContain('BrowserRouter');
    expect(appRoot.content).toContain('<>');
    expect(appRoot.content).toContain("import { Routes, Route } from 'react-router-dom';");
  });

  it('rejects a template built on a data router', async () => {
    const result = await plan({
      ...BARE_TEMPLATE,
      'src/App.jsx':
        "import { createBrowserRouter, RouterProvider } from 'react-router-dom';\nconst router = createBrowserRouter([]);\nexport default function App() { return <RouterProvider router={router} />; }\n",
    });

    expect(result.violations.join(' ')).toMatch(/data router/);
  });
});

describe('PlatformBaselineService deploy mode', () => {
  function normalized(): Record<string, string> {
    const files: Record<string, string> = { ...BARE_TEMPLATE };
    for (const file of PLATFORM_KIT_FILES) files[file.path] = readPlatformKitFile(file);
    files['src/App.jsx'] = 'export default function App() { return <div />; }\n';
    files['src/main.jsx'] =
      "import { AppRouter } from './AppRouter';\nexport default AppRouter;\n";
    return files;
  }

  it('accepts a revision whose platform files are untouched', async () => {
    const result = await plan(normalized(), 'deploy');
    expect(result.violations).toEqual([]);
  });

  it('adds a platform file the agent deleted instead of failing', async () => {
    const files = normalized();
    delete files['src/lib/ym-diag.ts'];

    const result = await plan(files, 'deploy');
    expect(result.violations).toEqual([]);
    expect(result.files.map((file) => file.path)).toContain('src/lib/ym-diag.ts');
  });

  it('refuses auth rewritten against the YellowStorm API base', async () => {
    const files = normalized();
    files['src/lib/yellowmind-auth.tsx'] =
      "const base = import.meta.env.VITE_YM_API_BASE_URL;\nfetch(`${base}/auth/login`);\n";

    const result = await plan(files, 'deploy');
    expect(result.violations.join(' ')).toMatch(/VITE_YM_APP_DATA_URL/);
  });

  it('refuses a router that lost the deploy basename', async () => {
    const files = normalized();
    files['src/AppRouter.tsx'] =
      "export function AppRouter() { return <BrowserRouter><a href='/login'>x</a><a href='/register'>y</a></BrowserRouter>; }\n";

    const result = await plan(files, 'deploy');
    expect(result.violations.join(' ')).toMatch(/resolveRouterBasename/);
  });
});
