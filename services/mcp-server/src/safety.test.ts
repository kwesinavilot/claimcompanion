import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSafety } from './safety.js';

test('injury and danger override a safe flag; omitted safety information pauses intake', () => {
  for (const narrative of ['Someone is injured.', 'There is FIRE.', 'I am trapped.', 'We are not safe.', 'A passenger cannot breathe.', 'There is bleeding.']) {
    assert.equal(checkSafety(narrative, false).level, 'emergency');
  }
  assert.equal(checkSafety('The car is parked.', true).level, 'emergency');
  assert.equal(checkSafety('The bumper is scratched.').level, 'check_needed');
  assert.equal(checkSafety('The bumper is scratched.', false).level, 'none');
  assert.equal(checkSafety('The bumper is scratched near a fireplace.', false).level, 'none');
  assert.equal(checkSafety('Nobody was hurt. No injuries.', false).level, 'none');
  assert.equal(checkSafety('No one is injured but there is a fire.', false).level, 'emergency');
  assert.equal(checkSafety('My neck hurts.', false).level, 'emergency');
});
