import http from 'node:http';
import {createHash, randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export const BASE = '/app/com.ictrek.gitea';
const ROOT = new URL('./', import.meta.url);
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
export const language = value => /^zh-(tw|hk|hant)/i.test(value || '') ? 'zh-TW' : /^zh/i.test(value || '') ? 'zh-CN' : 'en-US';
export const username = subject => `vos-${createHash('sha256').update(subject).digest('hex').slice(0, 24)}`;

export async function verify(token, userinfoUrl, fetcher = fetch) {
  if (typeof token !== 'string' || !token || token.length > 16384) throw Error('Invalid token');
  const r = await fetcher(userinfoUrl, {headers: {authorization: `Bearer ${token}`}, redirect: 'error', signal: AbortSignal.timeout(10000)});
  if (!r.ok) throw Error('Invalid token');
  const data = await r.json();
  if (data.code !== undefined && data.code !== 0) throw Error('Invalid token');
  const claims = data.data || data;
  if (typeof claims.sub !== 'string' || !claims.sub || ![true, 1].includes(claims.enable)) throw Error('Disabled or invalid user');
  return {subject: claims.sub, username: username(claims.sub), preferredUsername: typeof claims.preferred_username === 'string' ? claims.preferred_username.slice(0, 100) : '', name: String(claims.nickname || claims.preferred_username || 'VOS user').slice(0, 100), admin: claims.role_code === 'system_admin'};
}

function respond(res, code, body = '', type = 'text/plain; charset=utf-8') {
  res.writeHead(code, {'content-type': type, 'cache-control': 'no-store'}); res.end(body);
}
function sameOrigin(req) {
  try { return new URL(req.headers.origin).host === req.headers.host && /^https?:$/.test(new URL(req.headers.origin).protocol); } catch { return false; }
}
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 32768) throw Error('Body too large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString());
}
export function upstreamHeaders(req, user, locale) {
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([key]) => !HOP.has(key) && !/^(x-webauth-|x-vos-|x-forwarded-|x-real-ip$)/.test(key) && !['authorization', 'host'].includes(key)));
  if (!user) {
    delete headers.cookie;
    return {...headers, host: req.headers.host, authorization: req.headers.authorization || '', 'x-forwarded-proto': req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'};
  }
  return {...headers, host: req.headers.host, 'x-forwarded-proto': req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http',
    'x-webauth-user': user.username, 'x-webauth-email': `${user.username}@vos.invalid`, 'x-vos-subject': user.subject,
    'x-vos-username': encodeURIComponent(user.preferredUsername || ''), 'x-vos-display-name': encodeURIComponent(user.name), 'x-vos-admin': String(user.admin), 'x-vos-language': locale || ''};
}
export function credential(authorization) {
  const [scheme, value = ''] = String(authorization || '').split(' ');
  if (!value) return '';
  const method = scheme.toLowerCase();
  if (!['bearer', 'token', 'basic'].includes(method)) return '';
  if (method !== 'basic') return value;
  const decoded = Buffer.from(value, 'base64').toString();
  const colon = decoded.indexOf(':');
  if (colon < 0) return decoded;
  const name = decoded.slice(0, colon), pass = decoded.slice(colon + 1);
  return pass === '' || pass === 'x-oauth-basic' ? name : pass; // Gitea reads the username as the token for these forms
}
export function createGateway({userinfoUrl, upstream = 'http://127.0.0.1:3000', mcpUpstream = 'http://gitea-mcp:8080', fetcher = fetch}) {
  const sessions = new Map();
  const id = req => (req.headers.cookie || '').split(';').map(x => x.trim().split('=')).find(([k]) => k === 'gitea_vos_session')?.[1];
  const json = (res, data) => respond(res, 200, JSON.stringify(data), 'application/json');
  const cookie = (req, value, age = 43200) => `gitea_vos_session=${value}; Path=${BASE}/; HttpOnly; SameSite=Strict; Max-Age=${age}${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`;
  // kind names who the request is; a PAT stays unverified here and is forwarded for Gitea to judge
  async function authenticate(req) {
    const token = credential(req.headers.authorization);
    if (token) {
      try { return {kind: 'vos', user: await verify(token, userinfoUrl, fetcher)}; }
      catch { return {kind: 'pat'}; }
    }
    if (req.headers.authorization) throw Error('Invalid credential');
    const session = sessions.get(id(req));
    if (!session || session.expires < Date.now()) { sessions.delete(id(req)); throw Error('Session required'); }
    try {
      const user = await verify(session.token, userinfoUrl, fetcher);
      if (user.subject !== session.subject) throw Error('Identity changed');
      return {kind: 'session', user, locale: session.locale};
    } catch (e) { sessions.delete(id(req)); throw e; }
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/healthz') {
        try { const r = await fetcher(`${upstream}${BASE}/api/healthz`, {signal: AbortSignal.timeout(3000)}); return respond(res, r.ok ? 200 : 503, r.ok ? 'OK' : 'Starting'); }
        catch { return respond(res, 503, 'Starting'); }
      }
      if (!url.pathname.startsWith(`${BASE}/`)) return respond(res, 404);
      const path = url.pathname.slice(BASE.length);
      if (path === '/mcp') {
        // Keeps MCP from running for anonymous callers; the sidecar stores no credentials itself.
        if (req.method !== 'POST') return respond(res, 405, 'Method not allowed');
        const deny = () => { res.setHeader('www-authenticate', 'Bearer'); return respond(res, 401, 'VOS token or Gitea PAT required'); };
        const authorization = String(req.headers.authorization || '');
        const token = credential(authorization);
        if (!token) return deny();
        // PATs are cheap to check locally; VOS is only asked when Gitea rejects the credential.
        const pat = await fetcher(`${upstream}${BASE}/api/v1/user`, {headers: {authorization}, redirect: 'error', signal: AbortSignal.timeout(10000)}).catch(() => null);
        if (!pat?.ok && !await verify(token, userinfoUrl, fetcher).then(() => true, () => false)) return deny();
        const headers = Object.fromEntries(Object.entries(req.headers).filter(([key]) => !HOP.has(key)));
        // Authorization stays untouched, the sidecar forwards it to Gitea for per-user tool permissions.
        const proxy = http.request(new URL('/mcp', mcpUpstream), {method: 'POST', headers: {...headers, host: req.headers.host}}, mcpRes => {
          const out = Object.fromEntries(Object.entries(mcpRes.headers).filter(([key]) => !HOP.has(key)));
          res.writeHead(mcpRes.statusCode, out); mcpRes.pipe(res);
        });
        proxy.on('error', () => { if (!res.headersSent) respond(res, 502, 'MCP unavailable'); else res.destroy(); });
        req.on('aborted', () => proxy.destroy()); req.pipe(proxy);
        return;
      }
      if (path === '/vos/bridge.js' && req.method === 'GET') return respond(res, 200, await readFile(new URL('bridge.js', ROOT)), 'text/javascript; charset=utf-8');
      if (path === '/vos/login') {
        if (req.method !== 'POST' || !sameOrigin(req)) return respond(res, 403);
        const {access_token: token, locale} = await body(req);
        const user = await verify(token, userinfoUrl, fetcher);
        for (const [key, value] of sessions) if (value.expires < Date.now()) sessions.delete(key);
        let key = id(req), session = sessions.get(key);
        const changed = !session || session.subject !== user.subject;
        if (changed) { sessions.delete(key); key = randomBytes(32).toString('hex'); }
        if (sessions.size >= 1000 && !sessions.has(key)) return respond(res, 503);
        sessions.set(key, {token, subject: user.subject, locale: language(locale), expires: Date.now() + 43200000});
        res.setHeader('set-cookie', cookie(req, key));
        return json(res, {username: user.username, changed});
      }
      if (path === '/vos/logout') {
        if (req.method !== 'POST' || !sameOrigin(req)) return respond(res, 403);
        sessions.delete(id(req)); res.setHeader('set-cookie', cookie(req, '', 0)); return respond(res, 204);
      }
      let auth;
      try {
        // Actions calls carry their own runner token and must not be authenticated by the gateway
        auth = /^\/(api\/actions\/|api\/actions_pipeline\/|twirp\/github\.actions\.)/.test(path) ? {kind: 'actions'} : await authenticate(req);
      }
      catch {
        if (req.method === 'GET' && req.headers.accept?.includes('text/html') && !path.startsWith('/api/')) {
          return respond(res, 200, '<!doctype html><html><head><meta charset="utf-8"><title>Gitea</title><script src="' + BASE + '/vos/bridge.js" defer></script></head><body><p id="vos-status">正在连接 VOS / Connecting to VOS…</p></body></html>', 'text/html; charset=utf-8');
        }
        res.setHeader('www-authenticate', 'Basic realm="VOS access token"'); return respond(res, 401, 'VOS authentication required');
      }
      if (auth.kind === 'session' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !sameOrigin(req)) return respond(res, 403);
      if (path.startsWith('/vos/') && !auth.user) return respond(res, 401);
      if (path === '/vos/session') return json(res, {username: auth.user.username});
      if (path === '/vos/locale') {
        if (req.method !== 'POST' || !sameOrigin(req) || auth.kind !== 'session') return respond(res, 403);
        sessions.get(id(req)).locale = language((await body(req)).locale); return respond(res, 204);
      }
      if (path === '/integration-guide' && req.method === 'GET') return respond(res, 200, (await readFile(new URL('guide.html', ROOT), 'utf8')).replace('__LANG__', auth.locale || 'en-US'), 'text/html; charset=utf-8');
      if (path.startsWith('/user/login') || path.startsWith('/user/sign_up') || path.startsWith('/login/oauth')) {
        const to = url.searchParams.get('redirect_to') || '';
        res.setHeader('location', to.startsWith(`${BASE}/`) ? to : `${BASE}/`);
        return respond(res, 302, 'VOS authentication required');
      }
      if (auth.locale && req.method === 'GET') url.searchParams.set('lang', auth.locale);
      const target = new URL(url.pathname + url.search, upstream);
      const proxy = http.request(target, {method: req.method, headers: upstreamHeaders(req, auth.user, auth.locale)}, upstreamRes => {
        const headers = Object.fromEntries(Object.entries(upstreamRes.headers).filter(([key]) => !HOP.has(key)));
        res.writeHead(upstreamRes.statusCode, {...headers, 'cache-control': 'no-store'}); upstreamRes.pipe(res);
      });
      proxy.on('error', () => { if (!res.headersSent) respond(res, 502, 'Gitea unavailable'); else res.destroy(); });
      req.on('aborted', () => proxy.destroy()); req.pipe(proxy);
    } catch { if (!res.headersSent) respond(res, 403, 'VOS authentication failed'); else res.destroy(); }
  });
  server.on('upgrade', async (req, socket, head) => {
    try {
      if (!req.url.startsWith(`${BASE}/`) || !sameOrigin(req)) throw Error('Forbidden');
      const auth = await authenticate(req);
      const proxy = http.request(new URL(req.url, upstream), {headers: {...upstreamHeaders(req, auth.user, auth.locale), connection: 'Upgrade', upgrade: 'websocket'}});
      proxy.on('upgrade', (r, remote, upstreamHead) => {
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
        if (head.length) remote.write(head); if (upstreamHead.length) socket.write(upstreamHead);
        remote.pipe(socket); socket.pipe(remote);
        const check = setInterval(() => { authenticate(req).catch(() => { remote.destroy(); socket.destroy(); }); }, 15000);
        socket.on('close', () => { clearInterval(check); remote.destroy(); }); remote.on('error', () => socket.destroy());
      });
      proxy.on('response', () => socket.destroy()); proxy.on('error', () => socket.destroy()); proxy.end();
    } catch { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); }
  });
  server.on('close', () => sessions.clear());
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.VOS_USERINFO_URL) throw Error('VOS_USERINFO_URL is required');
  createGateway({userinfoUrl: process.env.VOS_USERINFO_URL}).listen(8080, '0.0.0.0');
}
