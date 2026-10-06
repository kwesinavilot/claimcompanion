import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { quality } from './quality.js';

import { detailedPhoto } from './fixture.js';
test('quality gate accepts detailed pixels and rejects dark, tiny, blurred and invalid inputs', async () => {
  const usable = await detailedPhoto();
  assert.equal((await quality(usable)).usable, true);
  const dark = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#000000' } }).png().toBuffer();
  assert.ok((await quality(dark)).issues.some(issue => issue.includes('dark')));
  const tiny = await sharp(usable).resize(120, 90).png().toBuffer();
  assert.ok((await quality(tiny)).issues.some(issue => issue.includes('small')));
  const blurry = await sharp(usable).blur(25).png().toBuffer();
  assert.equal((await quality(blurry)).usable, false);
  assert.equal((await quality(Buffer.from('not an image'))).usable, false);
});
