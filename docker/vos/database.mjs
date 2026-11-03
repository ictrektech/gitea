import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute = promisify(execFile);

export async function prepareDatabase(password) {
  const base = {...process.env, PGHOST: 'pgv', PGPORT: '5432', PGCONNECT_TIMEOUT: '5'};
  try {
    await execute('psql', ['-XAtq', '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT 1'], {env: {...base, PGUSER: 'gitea', PGDATABASE: 'gitea', PGPASSWORD: password}});
    return;
  } catch { /* Provision only a new dedicated database; existing credentials are never reset. */ }
  if (!process.env.VOS_POSTGRES_PASSWORD) throw Error('PGV bootstrap credentials are unavailable');
  const admin = {...base, PGUSER: 'postgres', PGDATABASE: 'postgres', PGPASSWORD: process.env.VOS_POSTGRES_PASSWORD};
  try {
    const {stdout} = await execute('psql', ['-XAtq', '-v', 'ON_ERROR_STOP=1', '-c', "SELECT (SELECT count(*) FROM pg_roles WHERE rolname='gitea'), (SELECT count(*) FROM pg_database WHERE datname='gitea')"], {env: admin});
    if (stdout.trim() !== '0|0') throw Error('Existing database credentials require restoration');
    if (!/^[a-f0-9]{64}$/.test(password)) throw Error('Invalid generated password');
    const child = execFile('psql', ['-Xq', '-v', 'ON_ERROR_STOP=1'], {env: admin}, () => {});
    const completed = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', code => code === 0 ? resolve() : reject(Error('Database provisioning failed')));
    });
    child.stdin.end(`CREATE ROLE gitea LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}';\nCREATE DATABASE gitea OWNER gitea;\n`);
    await completed;
  } catch { throw Error('PGV Gitea database is unavailable; check connectivity or restore its private configuration'); }
}
