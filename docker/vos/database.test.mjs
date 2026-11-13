import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDatabase} from './database.mjs';

const password = 'a'.repeat(64);

function setup({login = false, state = '0|0|'} = {}) {
  const calls = [];
  const written = [];
  let authenticated = login;
  const run = async (env, sql) => {
    calls.push({user: env.PGUSER, sql});
    if (sql === 'SELECT 1') {
      if (!authenticated) throw Error('password authentication failed');
      return {stdout: '1'};
    }
    return {stdout: state};
  };
  const write = async (env, statements) => {
    written.push({user: env.PGUSER, statements});
    if (statements.some(statement => statement.startsWith('ALTER ROLE') || statement.startsWith('CREATE ROLE'))) authenticated = true;
  };
  return {run, write, calls, written};
}

test.beforeEach(() => { process.env.VOS_POSTGRES_PASSWORD = 'admin-secret'; });
test.afterEach(() => { delete process.env.VOS_POSTGRES_PASSWORD; });

test('keeps an existing database when the private password works', async () => {
  const stub = setup({login: true});
  await prepareDatabase(password, stub);
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.written.length, 0);
});

test('adopts an existing role and database after losing the private configuration', async () => {
  const stub = setup({state: '1|1|gitea'});
  await prepareDatabase(password, stub);
  assert.deepEqual(stub.written[0].statements, [`ALTER ROLE gitea PASSWORD '${password}';`]);
  assert.equal(stub.written[0].user, 'postgres');
});

test('creates the role and database on a clean PGV', async () => {
  const stub = setup({state: '0|0|'});
  await prepareDatabase(password, stub);
  assert.equal(stub.written[0].statements.length, 2);
  assert.match(stub.written[0].statements[0], /^CREATE ROLE gitea LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD/);
  assert.equal(stub.written[0].statements[1], 'CREATE DATABASE gitea OWNER gitea;');
});

test('refuses to touch a database owned by another role', async () => {
  const stub = setup({state: '0|1|gitlab'});
  await assert.rejects(() => prepareDatabase(password, stub), /belongs to gitlab/);
  assert.equal(stub.written.length, 0);
});

test('rejects a malformed password before any connection', async () => {
  const stub = setup();
  await assert.rejects(() => prepareDatabase('short', stub), /Invalid generated database password/);
  assert.equal(stub.calls.length, 0);
});

test('reports an admin connection failure', async () => {
  const stub = setup();
  stub.run = async (env, sql) => { if (env.PGUSER === 'gitea') throw Error('down'); throw Error('no pg_hba.conf entry'); };
  await assert.rejects(() => prepareDatabase(password, stub), /PGV admin connection failed: no pg_hba\.conf entry/);
});
