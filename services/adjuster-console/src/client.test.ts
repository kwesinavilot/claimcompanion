import test from 'node:test';
import assert from 'node:assert/strict';
import { operation, write } from './client.js';
test('retrying a failed action preserves its exact operation while a new action gets a new key', async () => {
  const original = globalThis.fetch; const requests: { url: string; key: string; body: string }[] = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), key: (init!.headers as Record<string, string>)['Idempotency-Key'], body: String(init!.body) });
    if (requests.length === 1) throw new Error('lost response');
    return new Response(JSON.stringify({ status: 'ok', data: {} }), { status: 201 });
  };
  try {
    const op = operation('clm/a', 'task', { owner: 'CUSTOMER', text: 'Add one clear photo.' });
    await assert.rejects(write(op), /lost response/); await write(op);
    assert.deepEqual(requests[0], requests[1]); assert.match(requests[0].url, /clm%2Fa\/tasks$/);
    assert.notEqual(op.key, operation(op.claimId, 'task', op.body).key);
  } finally { globalThis.fetch = original; }
});
