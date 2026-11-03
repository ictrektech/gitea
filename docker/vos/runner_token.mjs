import { execFile } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { promisify } from 'node:util';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const execute = promisify(execFile);
const SELECT_TOKEN = 'SELECT token FROM action_runner_token WHERE owner_id = 0 AND repo_id = 0 AND is_active ORDER BY id DESC LIMIT 1';
const INVALIDATE_TOKENS = 'UPDATE action_runner_token SET is_active = false WHERE owner_id = 0 AND repo_id = 0 AND is_active';

export function newRunnerToken(random = randomInt) {
    let token = '';
    for (let i = 0; i < 40; i++) token += ALPHABET[random(ALPHABET.length)];
    return token;
}

const insertSql = (token, now) => `INSERT INTO action_runner_token (token, owner_id, repo_id, is_active, created, updated, deleted) VALUES ('${token}', 0, 0, true, ${now}, ${now}, 0)`;

async function psql(password, sql) {
    return execute('psql', ['-XAtq', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
        env: { ...process.env, PGHOST: 'pgv', PGPORT: '5432', PGUSER: 'gitea', PGDATABASE: 'gitea', PGPASSWORD: password },
    });
}

// Reuses the active global token so restarts never invalidate a registered runner.
export async function ensureGlobalRunnerToken({ password, run = sql => psql(password, sql), random = randomInt, now = () => Math.floor(Date.now() / 1000) }) {
    const token = (await run(SELECT_TOKEN)).stdout.trim();
    if (/^[A-Za-z0-9]{40}$/.test(token)) return token;
    const created = newRunnerToken(random);
    await run(`${INVALIDATE_TOKENS}; ${insertSql(created, now())}`);
    return created;
}
