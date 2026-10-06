import test from 'node:test';
import assert from 'node:assert/strict';
import { needsInput, toToolResult } from './index.js';
test('prioritizes a single question without mutating missing-field facts or adding protocol state', () => {
  const fields = Object.freeze([Object.freeze({ field: 'where', priority: 2, question: 'Where did it happen?' }), Object.freeze({ field: 'when', priority: 1, question: 'When did it happen?' })]);
  const result = needsInput({ summary: 'I need one more detail.', data: { handle: 'example' }, missing: fields });
  assert.equal(result.next_question, 'When did it happen?'); assert.equal(fields[0].field, 'where');
  assert.equal(toToolResult(result).content[0].text, result.summary);
  assert.equal('requestState' in result, false);
});
test('rejects missing questions, duplicate fields and invalid priorities', () => {
  const field = { field: 'when', priority: 1, question: 'When?' };
  for (const missing of [[], [field, field], [{ ...field, question: '' }], [{ ...field, priority: Infinity }], [{ ...field, priority: 0 }]]) assert.throws(() => needsInput({ summary: 'More information needed.', data: {}, missing }), TypeError);
});
