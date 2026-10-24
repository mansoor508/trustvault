import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Use /trustvault/ for GitHub Pages deployment or custom VITE_BASE_PATH, fallback to root '/' locally
const repoBase =
  process.env.VITE_BASE_PATH ??
  (process.env.GITHUB_PAGES === 'true' || process.env.GITHUB_ACTIONS === 'true'
    ? process.env.GITHUB_REPOSITORY
      ? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}/`
      : '/trustvault/'
    : '/');

export default defineConfig({
  base: repoBase,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: false,
    minify: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: false,
    clearMocks: true,
  },
});
