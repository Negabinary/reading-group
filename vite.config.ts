import { copyFile, mkdir } from 'node:fs/promises';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => {
  return {
    base: './',
    build: { outDir: mode === 'demo' ? 'dist/demo' : 'dist/site' },
    define: {
      'import.meta.env.VITE_DEMO': JSON.stringify(
        mode === 'demo' ? 'true' : 'false',
      ),
    },
    plugins: [
      react(),
      viteSingleFile(),
      {
        name: 'alternate-entry',
        apply: 'build',
        async closeBundle() {
          const out = mode === 'demo' ? 'dist/demo' : 'dist/site';
          await mkdir(`${out}/alt`, { recursive: true });
          await copyFile(`${out}/index.html`, `${out}/alt/index.html`);
        },
      },
    ],
    server: {
      proxy: {
        '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
        '/calendar.ics': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: false,
        },
        '/dblp-api': {
          target: 'https://dblp.org',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/dblp-api/, '/search/publ/api'),
        },
        '/crossref-api': {
          target: 'https://api.crossref.org',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/crossref-api/, '/works'),
        },
      },
    },
  };
});
