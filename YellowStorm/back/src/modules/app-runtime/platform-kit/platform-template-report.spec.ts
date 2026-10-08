import { analyzeTemplatePlatform } from './platform-template-report';
import { planPlatformBaseline } from './platform-baseline.planner';

function sourceFor(files: Record<string, string>) {
  return {
    paths: Object.keys(files),
    read: (path: string) => Promise.resolve(files[path] ?? null),
  };
}

const PLAIN_TEMPLATE: Record<string, string> = {
  'package.json': '{"name":"tpl"}',
  'index.html': '<script type="module" src="/src/main.jsx"></script>',
  'vite.config.js': "import { defineConfig } from 'vite';\nexport default defineConfig({});\n",
  'src/main.jsx': "import App from './App';\ncreateRoot(root).render(<App />);\n",
  'src/App.jsx': 'export default function App() { return <div />; }\n',
};

describe('analyzeTemplatePlatform', () => {
  it('reports the platform files a plain template is missing', async () => {
    const report = await analyzeTemplatePlatform(sourceFor(PLAIN_TEMPLATE));

    expect(report.status).toBe('needs_normalization');
    expect(report.injectedFiles).toContain('src/AppRouter.tsx');
    expect(report.injectedFiles).toContain('src/lib/yellowmind-auth.tsx');
    expect(report.violations).toEqual([]);
    expect(report.appRoot).toBe('src/App.jsx');
  });

  it('flags a template the normalizer cannot fix', async () => {
    const report = await analyzeTemplatePlatform(
      sourceFor({
        ...PLAIN_TEMPLATE,
        'src/App.jsx':
          "import { createBrowserRouter, RouterProvider } from 'react-router-dom';\nexport default function App() { return <RouterProvider router={createBrowserRouter([])} />; }\n",
      }),
    );

    expect(report.status).toBe('incompatible');
    expect(report.violations.join(' ')).toMatch(/data router/);
  });

  it('flags Create React App (react-scripts) as incompatible', async () => {
    const report = await analyzeTemplatePlatform(
      sourceFor({
        ...PLAIN_TEMPLATE,
        'package.json': JSON.stringify({
          name: 'landing-page-reactjs-materialui',
          scripts: { start: 'react-scripts start', build: 'react-scripts build' },
          dependencies: { 'react-scripts': '5.0.1', react: '18.2.0' },
        }),
      }),
    );

    expect(report.status).toBe('incompatible');
    expect(report.violations.join(' ')).toMatch(/react-scripts|Create React App/);
  });

  it('reports a project as ready once the plan has been applied', async () => {
    const files: Record<string, string> = { ...PLAIN_TEMPLATE };
    const plan = await planPlatformBaseline(sourceFor(files), 'seed');
    for (const file of plan.files) files[file.path] = file.content;

    await expect(analyzeTemplatePlatform(sourceFor(files))).resolves.toMatchObject({
      status: 'ready',
      injectedFiles: [],
    });
  });
});
