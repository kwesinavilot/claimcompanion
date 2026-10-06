import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { host: process.env.PHOTO_PORTAL_HOST ?? '127.0.0.1', port: 3003, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3005' } } });
