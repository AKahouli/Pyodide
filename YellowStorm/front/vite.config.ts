import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import nodepod from '@scelar/nodepod/vite';
import { defineConfig } from 'vite';

function getManualChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) {
    return undefined;
  }

  if (
    id.includes('/node_modules/react/')
    || id.includes('/node_modules/react-dom/')
    || id.includes('/node_modules/react-router/')
    || id.includes('/node_modules/react-router-dom/')
  ) {
    return 'vendor-react';
  }

  if (id.includes('/node_modules/@xyflow/')) {
    return 'vendor-flow';
  }

  if (
    id.includes('/node_modules/shiki/')
    || id.includes('/node_modules/@shikijs/')
  ) {
    return 'vendor-shiki';
  }

  if (
    id.includes('/node_modules/streamdown/')
    || id.includes('/node_modules/react-markdown/')
    || id.includes('/node_modules/remark-')
    || id.includes('/node_modules/rehype-')
  ) {
    return 'vendor-markdown';
  }

  if (id.includes('/node_modules/exceljs/')) {
    return 'vendor-excel';
  }

  if (
    id.includes('/node_modules/@embedpdf/')
    || id.includes('/node_modules/pdfjs-dist/')
  ) {
    return 'vendor-pdf';
  }

  if (id.includes('/node_modules/@cyntler/react-doc-viewer/')) {
    return 'vendor-doc-viewer';
  }

  if (
    id.includes('/node_modules/monaco-editor/')
  ) {
    return 'vendor-editor';
  }

  if (
    id.includes('/node_modules/ai/')
    || id.includes('/node_modules/@anthropic-ai/')
  ) {
    return 'vendor-ai';
  }

  return undefined;
}

export default defineConfig(() => {
  return {
    base: '/',
    plugins: [react(), tailwindcss(), nodepod()],
    build: {
      target: 'es2022',
      rollupOptions: {
        output: {
          manualChunks: getManualChunk,
        },
      },
    },
    server: {
      hmr: false,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      include: ['@embedpdf/react-pdf-viewer', '@embedpdf/snippet', '@cyntler/react-doc-viewer'],
      dedupe: ['react', 'react-dom'],
      esbuildOptions: {
        target: 'es2022',
      },
    },
    esbuild: {
      target: 'es2022',
    },
    define: {
      global: {
        basename: '',
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      globals: true,
      exclude: ['node_modules', 'dist', 'tests/e2e/**', 'tests/.auth/**'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov', 'html'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/test/**', 'src/**/*.d.ts', 'src/**/*.test.{ts,tsx}', 'src/main.tsx'],
      },
    },
  };
});
