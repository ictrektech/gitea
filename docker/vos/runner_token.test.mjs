import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureGlobalRunnerToken, newRunnerToken} from './runner_token.mjs';

test('generates a 40 character alphanumeric token', () => {
  const token = newRunnerToken(() => 0);
  assert.equal(token.length, 40);
  assert.match(token, /^[A-Za-z0-9]{40}$/);
});

test('reuses the active global token', async () => {
  const sql = [];
  const token = await ensureGlobalRunnerToken({run: async statement => { sql.push(statement); return {stdout: 'A'.repeat(40) + '\n'}; }});
  assert.equal(token, 'A'.repeat(40));
  assert.equal(sql.length, 1);
});

test('invalidates stale tokens before creating a new one', async () => {
  const sql = [];
  const token = await ensureGlobalRunnerToken({
    run: async statement => { sql.push(statement); return {stdout: ''}; },
    random: () => 0,
    now: () => 1793674937,
  });
  assert.equal(token, 'A'.repeat(40));
  assert.equal(sql.length, 2);
  assert.match(sql[1], /UPDATE action_runner_token SET is_active = false/);
  assert.match(sql[1], new RegExp(`VALUES \\('${'A'.repeat(40)}', 0, 0, true, 1793674937, 1793674937, 0\\)`));
});
