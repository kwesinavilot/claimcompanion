import test from 'node:test';
import assert from 'node:assert/strict';
import { UnavailableAnalysis, observationsSchema } from './analysis.js';

test('unconfigured analysis is unavailable and never invents photo observations', async () => {
  const analysis = new UnavailableAnalysis();
  for (const result of [await analysis.ocr(), await analysis.damage()]) {
    assert.equal(result.status, 'unavailable');
    assert.equal(result.needs_human_review, true);
    assert.equal(result.result, undefined);
  }
});
test('damage observations reject prose, extra keys and invalid confidence', () => {
  const valid = { view: 'rear', visible_damage: [{ zone: 'rear_bumper', type: 'dent', extent: 'unclear', confidence: 0.6 }], cannot_determine: ['hidden_damage'] };
  assert.ok(observationsSchema.safeParse(valid).success);
  assert.equal(observationsSchema.safeParse({ ...valid, decision: 'invented' }).success, false);
  assert.equal(observationsSchema.safeParse({ ...valid, visible_damage: [{ ...valid.visible_damage[0], confidence: 2 }] }).success, false);
  assert.equal(observationsSchema.safeParse('free-form model response').success, false);
});
