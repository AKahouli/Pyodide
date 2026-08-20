/**
 * Build starter-react-vite-v3 from v1 + YellowMind auth/data templates.
 *
 * Usage (from YellowStorm/back):
 *   npx ts-node scripts/materialize-starter-v3.ts
 */
import * as fs from 'fs';
import * as path from 'path';
const sourcesDir = path.resolve(
  __dirname,
  '..',
  'src',
  'modules',
  'app-data',
  'templates',
  'sources',
);

function readSource(name: string): string {
  return fs.readFileSync(path.join(sourcesDir, name), 'utf8');
}

const repoRoot = path.resolve(__dirname, '..', '..');
const v1Dir = path.join(repoRoot, 'starters', 'starter-react-vite-v1');
const v3Dir = path.join(repoRoot, 'starters', 'starter-react-vite-v3');

function copyDir(src: string, dest: string, skip = new Set<string>()): void {
  if (!fs.existsSync(src)) {
    throw new Error(`Missing source directory: ${src}`);
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to, skip);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

function write(relativePath: string, content: string): void {
  const out = path.join(v3Dir, relativePath);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, content, 'utf8');
  console.log('wrote', relativePath);
}

function main(): void {
  if (!fs.existsSync(v3Dir)) {
    fs.mkdirSync(v3Dir, { recursive: true });
    copyDir(v1Dir, v3Dir, new Set(['manifest.json']));
  }

  write('src/lib/yellowmind-data.ts', readSource('yellowmind-data.ts'));
  write('src/lib/yellowmind-auth.tsx', readSource('yellowmind-auth.tsx'));
  write('src/components/auth/ProtectedRoute.tsx', readSource('ProtectedRoute.tsx'));
  write('src/pages/AuthPages.tsx', readSource('AuthPages.tsx'));
  write('src/AppRouter.tsx', readSource('AppRouter.tsx'));

  write(
    'src/lib/utils.ts',
    `import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`,
  );

  write(
    'src/components/ui/button.tsx',
    `import * as React from 'react';
import { cn } from '@/lib/utils';

export function Button({
  className,
  type = 'button',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
`,
  );

  write(
    'src/components/ui/input.tsx',
    `import * as React from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    />
  );
}
`,
  );

  write(
    'src/components/ui/label.tsx',
    `import * as React from 'react';
import { cn } from '@/lib/utils';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-sm font-medium leading-none', className)} {...props} />;
}
`,
  );

  write(
    'src/components/ui/card.tsx',
    `import * as React from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-2xl font-semibold leading-none tracking-tight', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 pt-0', className)} {...props} />;
}
`,
  );

  write(
    'src/index.css',
    `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --card: 0 0% 100%;
  --card-foreground: 222.2 84% 4.9%;
  --primary: 222.2 47.4% 11.2%;
  --primary-foreground: 210 40% 98%;
  --muted-foreground: 215.4 16.3% 46.9%;
  --destructive: 0 84.2% 60.2%;
  --border: 214.3 31.8% 91.4%;
  --input: 214.3 31.8% 91.4%;
  --ring: 222.2 84% 4.9%;
}

body {
  margin: 0;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
`,
  );

  write(
    'tailwind.config.js',
    `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        muted: { foreground: 'hsl(var(--muted-foreground))' },
        destructive: 'hsl(var(--destructive))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
      },
    },
  },
  plugins: [],
};
`,
  );

  write(
    'postcss.config.js',
    `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`,
  );

  write(
    'tsconfig.json',
    `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"]
}
`,
  );

  write(
    'src/vite-env.d.ts',
    `/// <reference types="vite/client" />
`,
  );

  write(
    'package.json',
    JSON.stringify(
      {
        name: 'react-vite-v3',
        version: '3.0.0',
        private: true,
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: {
          clsx: '^2.1.1',
          react: '^19.1.0',
          'react-dom': '^19.1.0',
          'react-router-dom': '^7.6.0',
          'tailwind-merge': '^3.3.0',
        },
        devDependencies: {
          '@types/react': '^19.1.0',
          '@types/react-dom': '^19.1.0',
          '@vitejs/plugin-react': '^4.4.1',
          autoprefixer: '^10.4.21',
          postcss: '^8.5.3',
          tailwindcss: '^3.4.17',
          typescript: '^5.8.3',
          vite: '^6.3.5',
        },
      },
      null,
      2,
    ) + '\n',
  );

  write(
    'vite.config.js',
    `import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
`,
  );

  write(
    'index.html',
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>react-vite-v3</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
  );

  write(
    'src/main.jsx',
    `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouter } from './AppRouter';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
);
`,
  );

  write(
    'README.md',
    `# starter-react-vite-v3

React + Vite starter for YellowMind App Builder (revision \`starter_react_vite_v3\`).

Based on \`starter-react-vite-v1\` with pre-installed:

- \`src/lib/yellowmind-auth.ts\` — app-scoped register/login/session
- \`src/lib/yellowmind-data.ts\` — App Data CRUD client (Bearer JWT)
- \`src/AppRouter.tsx\` — \`/login\`, \`/register\`, protected \`App\`

Regenerate from templates:

\`\`\`bash
cd YellowStorm/back
npx ts-node scripts/materialize-starter-v3.ts
\`\`\`

Publish to Ceph:

\`\`\`bash
npx ts-node scripts/publish-starter-to-ceph.ts --dir ../starters/starter-react-vite-v3 --revision starter_react_vite_v3
\`\`\`
`,
  );

  console.log(`Starter v3 materialized at ${v3Dir}`);
}

main();
