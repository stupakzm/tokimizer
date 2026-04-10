'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { calcTokenCost, calcRecencyDecay, calcScore, coldStartScore } = require('../hooks/lib/scoring');

test('calcTokenCost: size/4 ceiling, minimum 1', () => {
  assert.strictEqual(calcTokenCost(400), 100);
  assert.strictEqual(calcTokenCost(401), 101);
  assert.strictEqual(calcTokenCost(3),   1);
  assert.strictEqual(calcTokenCost(0),   1);
});

test('calcRecencyDecay: returns 1 for null or undefined', () => {
  assert.strictEqual(calcRecencyDecay(null), 1);
  assert.strictEqual(calcRecencyDecay(undefined), 1);
});

test('calcRecencyDecay: returns ~0.95 for a file accessed 1 day ago', () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const decay = calcRecencyDecay(yesterday);
  assert.ok(decay > 0.93 && decay < 0.97, `expected ~0.95, got ${decay}`);
});

test('calcRecencyDecay: returns ~0.49 for a file accessed 14 days ago', () => {
  const old = new Date(Date.now() - 86400000 * 14).toISOString();
  const decay = calcRecencyDecay(old);
  assert.ok(decay > 0.44 && decay < 0.54, `expected ~0.49, got ${decay}`);
});

test('calcScore: (reads + edits*3) * decay / tokenCost', () => {
  const entry = {
    access_count: 10,
    edit_count: 0,
    last_accessed: new Date().toISOString(),
    size_bytes: 400
  };
  // base = (10 + 0) * ~1 = 10, cost = 100, score = 0.1
  const score = calcScore(entry);
  assert.ok(score > 0.09 && score < 0.11, `expected ~0.1, got ${score}`);
});

test('calcScore: edit_count weighted 3x', () => {
  const readOnly = { access_count: 3, edit_count: 0, last_accessed: new Date().toISOString(), size_bytes: 400 };
  const withEdit = { access_count: 0, edit_count: 1, last_accessed: new Date().toISOString(), size_bytes: 400 };
  // reads: 3/100 = 0.03; edit: 3/100 = 0.03 — equal
  assert.ok(Math.abs(calcScore(readOnly) - calcScore(withEdit)) < 0.001);
});

test('coldStartScore: 1 / tokenCost', () => {
  assert.strictEqual(coldStartScore(400), 1 / 100);
  assert.strictEqual(coldStartScore(4000), 1 / 1000);
});
