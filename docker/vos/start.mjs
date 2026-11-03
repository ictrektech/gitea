import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createGateway, BASE} from './gateway.mjs';
import {prepareDatabase} from './database.mjs';

const secretPath = '/config/conf/secrets.json';
if (!process.env.VOS_USERINFO_URL || !process.env.VOS_USERS_URL) throw Error('VOS API endpoints are required');
const sshPort = Number(process.env.GITEA_SSH_PORT || 2222);
const sshDomain = process.env.GITEA_SSH_DOMAIN || 'localhost';
if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535 || !/^[a-zA-Z0-9.:-]+$/.test(sshDomain)) throw Error('Invalid SSH address');
const publicURL = new URL(process.env.GITEA_PUBLIC_URL || `http://gitea:8080${BASE}/`);
if (!['http:', 'https:'].includes(publicURL.protocol) || publicURL.username || publicURL.password || publicURL.search || publicURL.hash) throw Error('Invalid public URL');
if (publicURL.pathname === '/') publicURL.pathname = BASE + '/';
if (publicURL.pathname.replace(/\/$/, '') !== BASE) throw Error('Public URL must use the Gitea VOS path');
publicURL.pathname = BASE + '/';
let secrets;
try { secrets = JSON.parse(await readFile(secretPath, 'utf8')); }
catch (e) {
  if (e.code !== 'ENOENT') throw e;
  secrets = Object.fromEntries(['secret', 'internal', 'lfs'].map(key => [key, randomBytes(32).toString('hex')]));
  await writeFile(secretPath, JSON.stringify(secrets), {mode: 0o600, flag: 'wx'});
}
if (!secrets.database) {
  secrets.database = randomBytes(32).toString('hex');
  await writeFile(secretPath, JSON.stringify(secrets), {mode: 0o600});
}
await prepareDatabase(secrets.database);
delete process.env.VOS_POSTGRES_PASSWORD;
await mkdir('/config/ssh', {recursive: true, mode: 0o700});
const ini = `APP_NAME = Gitea
RUN_USER = node
RUN_MODE = prod
WORK_PATH = /data/gitea
[server]
PROTOCOL = http
HTTP_ADDR = 127.0.0.1
HTTP_PORT = 3000
ROOT_URL = ${publicURL.href}
USE_SUB_URL_PATH = true
PUBLIC_URL_DETECTION = auto
LOCAL_ROOT_URL = http://127.0.0.1:3000${BASE}/
APP_DATA_PATH = /data/gitea
DISABLE_SSH = false
START_SSH_SERVER = true
SSH_LISTEN_HOST = 0.0.0.0
SSH_LISTEN_PORT = 2222
SSH_PORT = ${sshPort}
SSH_DOMAIN = ${sshDomain}
BUILTIN_SSH_SERVER_USER = git
SSH_USER = git
SSH_ROOT_PATH = /config/ssh
SSH_SERVER_HOST_KEYS = /config/ssh/gitea.ed25519
LFS_START_SERVER = true
LFS_JWT_SECRET = ${secrets.lfs}
[database]
DB_TYPE = postgres
HOST = pgv:5432
NAME = gitea
USER = gitea
PASSWD = ${secrets.database}
SSL_MODE = disable
[repository]
ROOT = /data/git/repositories
DEFAULT_PRIVATE = private
[security]
INSTALL_LOCK = true
SECRET_KEY = ${secrets.secret}
INTERNAL_TOKEN = ${secrets.internal}
REVERSE_PROXY_AUTHENTICATION_USER = X-WEBAUTH-USER
REVERSE_PROXY_AUTHENTICATION_EMAIL = X-WEBAUTH-EMAIL
REVERSE_PROXY_TRUSTED_PROXIES = 127.0.0.1/32,::1/128
REVERSE_PROXY_LIMIT = 1
[service]
DISABLE_REGISTRATION = true
REQUIRE_SIGNIN_VIEW = true
ENABLE_PASSWORD_SIGNIN_FORM = false
ENABLE_BASIC_AUTHENTICATION = true
ENABLE_REVERSE_PROXY_AUTHENTICATION = true
ENABLE_REVERSE_PROXY_AUTHENTICATION_API = true
ENABLE_REVERSE_PROXY_AUTO_REGISTRATION = true
ENABLE_REVERSE_PROXY_EMAIL = true
DEFAULT_ALLOW_CREATE_ORGANIZATION = true
DEFAULT_KEEP_EMAIL_PRIVATE = true
[session]
PROVIDER = file
PROVIDER_CONFIG = /config/sessions
COOKIE_NAME = gitea_native_session
[log]
MODE = console
LEVEL = Warn
[actions]
ENABLED = true
`;
await writeFile('/config/conf/app.ini', ini, {mode: 0o600});
await mkdir('/config/templates/custom', {recursive: true});
await writeFile('/config/templates/custom/header.tmpl', `<script src="${BASE}/vos/bridge.js" defer></script>`);
const child = spawn('/usr/local/bin/gitea', ['web', '--config', '/config/conf/app.ini'], {stdio: 'inherit', env: {...process.env, GITEA_WORK_DIR: '/data/gitea', GITEA_CUSTOM: '/config', VOS_AUTH_ENABLED: 'true'}});
const gateway = createGateway({userinfoUrl: process.env.VOS_USERINFO_URL});
gateway.listen(8080, '0.0.0.0');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { gateway.close(); child.kill(signal); });
child.on('exit', code => { gateway.close(); process.exit(code || 0); });
