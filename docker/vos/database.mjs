import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute = promisify(execFile);
const PASSWORD = /^[a-f0-9]{64}$/;
const STATE = "SELECT (SELECT count(*) FROM pg_roles WHERE rolname='gitea'), (SELECT count(*) FROM pg_database WHERE datname='gitea'), coalesce((SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='gitea'), '')";

const query = (env, sql) => execute('psql', ['-XAtq', '-v', 'ON_ERROR_STOP=1', '-c', sql], {env});

function apply(env, statements) {
  const child = execFile('psql', ['-Xq', '-v', 'ON_ERROR_STOP=1'], {env}, () => {});
  const completed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(Error('Database provisioning failed')));
  });
  child.stdin.end(statements.join('\n') + '\n');
  return completed;
}

// Adopts the dedicated role when only the private configuration was lost; the password is the only secret not kept in PGV.
export async function prepareDatabase(password, {run = query, write = apply} = {}) {
  if (!PASSWORD.test(password)) throw Error('Invalid generated database password');
  const base = {...process.env, PGHOST: 'pgv', PGPORT: '5432', PGCONNECT_TIMEOUT: '5'};
  const gitea = {...base, PGUSER: 'gitea', PGDATABASE: 'gitea', PGPASSWORD: password};
  const login = () => run(gitea, 'SELECT 1').then(() => true, () => false);
  if (await login()) return;
  if (!process.env.VOS_POSTGRES_PASSWORD) throw Error('PGV bootstrap credentials are unavailable');
  const admin = {...base, PGUSER: 'postgres', PGDATABASE: 'postgres', PGPASSWORD: process.env.VOS_POSTGRES_PASSWORD};
  let state;
  try { state = (await run(admin, STATE)).stdout.trim().split('|'); }
  catch (error) { throw Error(`PGV admin connection failed: ${error.message}`); }
  const [hasRole, hasDatabase, owner] = state;
  if (hasDatabase === '1' && owner !== 'gitea') throw Error(`PGV database gitea belongs to ${owner}`);
  const statements = [hasRole === '1'
    ? `ALTER ROLE gitea PASSWORD '${password}';`
    : `CREATE ROLE gitea LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}';`];
  if (hasDatabase !== '1') statements.push('CREATE DATABASE gitea OWNER gitea;');
  try { await write(admin, statements); }
  catch (error) { throw Error(`PGV database provisioning failed: ${error.message}`); }
  if (!await login()) throw Error('PGV database credentials are still rejected after provisioning');
  if (hasRole === '1') console.warn('Reused the existing PGV gitea role with a new password');
}
