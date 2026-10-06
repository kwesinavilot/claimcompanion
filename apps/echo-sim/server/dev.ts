import { createServer } from 'vite';
import { buildApi } from './api.js';
const api = buildApi();
api.listen(Number(process.env.API_PORT ?? 3004), '127.0.0.1');
const vite = await createServer();
await vite.listen();
vite.printUrls();
console.info(`Echo simulator mode: ${process.env.ORCHESTRATOR_MODE ?? 'bedrock'}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { api.close(); void vite.close().then(() => process.exit(0)); });
