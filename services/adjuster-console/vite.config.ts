import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode, command }) => {
  if (command === 'build') return { plugins: [react()] };
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.SVALINN_API_BASE_URL ?? '';
  const url = new URL(target);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/, '') !== '/v1') throw new Error('Configure a Svalinn URL ending in /v1.');
  if (!env.SVALINN_API_KEY || !env.SVALINN_TENANT_ID) throw new Error('Configure Svalinn credentials for the adjuster console.');
  return { plugins: [react()], server: { host: '127.0.0.1', port: 3006, strictPort: true,
    proxy: { '/svalinn': { target: url.origin, changeOrigin: true, rewrite: path => path.replace(/^\/svalinn/, ''),
      headers: { Authorization: `ApiKey ${env.SVALINN_API_KEY}`, 'X-Svalinn-Tenant': env.SVALINN_TENANT_ID } } } } };
});
