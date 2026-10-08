/** File bodies the baseline writes when a template does not provide its own. */

export const DEFAULT_VITE_CONFIG = `import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: process.env.VITE_APP_BASE || '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
`;

export const DEFAULT_TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      skipLibCheck: true,
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      jsx: 'react-jsx',
      allowJs: true,
      strict: false,
      baseUrl: '.',
      paths: { '@/*': ['src/*'] },
    },
    include: ['src'],
  },
  null,
  2,
)}\n`;

export function defaultIndexHtml(entryPath: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/${entryPath}"></script>
  </body>
</html>
`;
}

/**
 * Entry that mounts the platform router. Uses `createElement` instead of JSX so
 * the same body is valid whatever extension the template entry uses
 * (`main.js`, `main.ts`, `main.jsx`, `main.tsx`).
 */
export function buildEntrySource(cssImports: readonly string[]): string {
  const css = cssImports.length ? `${cssImports.join('\n')}\n` : '';
  return `import { StrictMode, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouter } from './AppRouter';
${css}
const container = document.getElementById('root');

createRoot(container).render(createElement(StrictMode, null, createElement(AppRouter)));
`;
}

/** Business root when the template renders a component that is not `src/App`. */
export function buildAppRootReexport(importPath: string, componentName: string): string {
  return `import ${componentName} from '${importPath}';

/**
 * Business root mounted by the platform router inside the protected route.
 * Edit the imported component, or replace this file with your own UI.
 */
export default function App() {
  return <${componentName} />;
}
`;
}

/** Fallback root when no template component could be detected. */
export const DEFAULT_APP_ROOT = `/**
 * Business root mounted by the platform router inside the protected route.
 * Replace this with the template UI.
 */
export default function App() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>App ready</h1>
      <p>Start building your screens in src/App.jsx.</p>
    </main>
  );
}
`;
