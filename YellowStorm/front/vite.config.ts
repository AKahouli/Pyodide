import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    base: '/',
    plugins: [react(), tailwindcss()],
    build: {
      target: 'es2022',
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
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov', 'html'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/test/**', 'src/**/*.d.ts', 'src/**/*.test.{ts,tsx}', 'src/main.tsx'],
      },
    },
  };
});
