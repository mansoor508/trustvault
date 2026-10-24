import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '..', 'dist');

const indexHtmlPath = path.join(distDir, 'index.html');

if (!fs.existsSync(indexHtmlPath)) {
  console.error(`[postbuild] Error: ${indexHtmlPath} does not exist. Did vite build run?`);
  process.exit(1);
}

const routes = [
  'dashboard',
  'register',
  'login',
  'accept-invite',
  'workspace',
  'workspace/members',
  'workspace/settings',
  'workspace/create',
  'company-admin',
  'documents',
  'history',
  'admin',
  'platform-admin',
  'platform-admin/login',
  'profile',
];

const indexContent = fs.readFileSync(indexHtmlPath, 'utf8');

for (const route of routes) {
  const targetDir = path.join(distDir, route);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'index.html'), indexContent, 'utf8');
}

// Write 404.html and 200.html for static hosts (Render, Netlify, Surge)
fs.writeFileSync(path.join(distDir, '404.html'), indexContent, 'utf8');
fs.writeFileSync(path.join(distDir, '200.html'), indexContent, 'utf8');

// Write _redirects rule file
fs.writeFileSync(path.join(distDir, '_redirects'), '/*    /index.html   200\n', 'utf8');

console.log(`[postbuild] Generated static SPA fallbacks for ${routes.length} routes + 404.html + 200.html + _redirects`);
