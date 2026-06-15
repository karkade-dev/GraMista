import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDockConfig } from '../lib/dockConfig';

test('дефолти при порожньому query', () => {
  const c = parseDockConfig({});
  assert.equal(c.key, '');
  assert.equal(c.period, 'all');
  assert.equal(c.perPage, 20);
  assert.equal(c.page, 1);
  assert.equal(c.scale, 100);
  assert.equal(c.live, true);
});

test('k читається; preview=1 вимикає live', () => {
  assert.equal(parseDockConfig({ k: 'ABC' }).key, 'ABC');
  assert.equal(parseDockConfig({ preview: '1' }).live, false);
  assert.equal(parseDockConfig({ preview: '0' }).live, true);
});

test('period: валідні значення; невідоме → all', () => {
  for (const p of ['all', 'stream', 'today', 'week', 'month'] as const) {
    assert.equal(parseDockConfig({ period: p }).period, p);
  }
  assert.equal(parseDockConfig({ period: 'year' }).period, 'all');
});

test('perPage лише 20/30/50; інше → 20', () => {
  assert.equal(parseDockConfig({ per: '30' }).perPage, 30);
  assert.equal(parseDockConfig({ per: '50' }).perPage, 50);
  assert.equal(parseDockConfig({ per: '25' }).perPage, 20);
  assert.equal(parseDockConfig({ per: 'abc' }).perPage, 20);
});

test('page ≥ 1; сміття → 1', () => {
  assert.equal(parseDockConfig({ page: '3' }).page, 3);
  assert.equal(parseDockConfig({ page: '0' }).page, 1);
  assert.equal(parseDockConfig({ page: '-5' }).page, 1);
  assert.equal(parseDockConfig({ page: 'abc' }).page, 1);
});

test('scale обрізається в 50..200; масив бере перше значення', () => {
  assert.equal(parseDockConfig({ scale: '10' }).scale, 50);
  assert.equal(parseDockConfig({ scale: '500' }).scale, 200);
  assert.equal(parseDockConfig({ scale: '120' }).scale, 120);
  assert.equal(parseDockConfig({ period: ['week', 'month'] }).period, 'week');
});
