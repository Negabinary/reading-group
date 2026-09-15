import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { validateApiUrl } from './src/api-config';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (command === 'build' && mode !== 'demo') {
    validateApiUrl(env.VITE_APPS_SCRIPT_URL || '');
  }
  return {
    base: './',
    build: { outDir: mode === 'demo' ? 'dist/demo' : 'dist/site' },
    define:
      mode === 'demo'
        ? { 'import.meta.env.VITE_APPS_SCRIPT_URL': JSON.stringify('') }
        : {},
    plugins: [react(), viteSingleFile()],
    server: {
      proxy: {
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
