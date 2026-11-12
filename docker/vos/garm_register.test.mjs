import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEntityPath, extractRunsOn, mergeLabels, MAX_LABELS} from './garm_register.mjs';

const BASE = '/app/com.ictrek.gitea';

test('parseEntityPath reads organization and repository pages', () => {
  assert.deepEqual(parseEntityPath(`${BASE}/org/acme/settings/actions/runners`, BASE), {owner: 'acme', repo: ''});
  assert.deepEqual(parseEntityPath(`${BASE}/acme/ci-test/settings/actions/runners`, BASE), {owner: 'acme', repo: 'ci-test'});
  assert.deepEqual(parseEntityPath(`${BASE}/acme/ci-test/settings/actions/runners?page=2`, BASE), {owner: 'acme', repo: 'ci-test'});
  assert.equal(parseEntityPath(`${BASE}/acme/ci-test/settings`, BASE), null);
  assert.equal(parseEntityPath(`${BASE}/user/settings/actions/runners`, BASE), null);
});

test('extractRunsOn reads scalars, inline lists and block lists', () => {
  assert.deepEqual(extractRunsOn('jobs:\n  build:\n    runs-on: garm-pools\n'), ['garm-pools']);
  assert.deepEqual(extractRunsOn('jobs:\n  build:\n    runs-on: [garm-pools, linux]\n'), ['garm-pools', 'linux']);
  assert.deepEqual(extractRunsOn('jobs:\n  build:\n    runs-on:\n      - garm-pools\n      - linux\n    steps: []\n'), ['garm-pools', 'linux']);
  assert.deepEqual(extractRunsOn('jobs:\n  build:\n    runs-on: "garm-pools" # comment\n'), ['garm-pools']);
  assert.deepEqual(extractRunsOn('jobs:\n  build:\n    runs-on: ${{ matrix.os }}\n'), []);
  assert.deepEqual(extractRunsOn('jobs:\n  build:\n    runs-on: [ "${{ matrix.os }}", linux ]\n'), ['linux']);
  assert.deepEqual(extractRunsOn(''), []);
});

test('mergeLabels deduplicates and applies the API limits', () => {
  assert.deepEqual(mergeLabels([['garm-pools'], ['linux', 'garm-pools', '']]), ['garm-pools', 'linux']);
  assert.deepEqual(mergeLabels([[], ['a b', 'ok']]), ['ok']);
  const many = Array.from({length: MAX_LABELS + 4}, (_, index) => `label${index}`);
  assert.equal(mergeLabels([many]).length, MAX_LABELS);
  assert.deepEqual(mergeLabels([['x'.repeat(51), 'y']]), ['y']);
});
