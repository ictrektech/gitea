import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {createGateway, BASE, verify, username, upstreamHeaders, credential} from './gateway.mjs';

test('verified VOS identity is stable across renames and rejects disabled users', async () => {
  let claims = {sub: 'account-1', preferred_username: 'alice', enable: 1, role_code: 'user'};
  const mock = async () => ({ok: true, json: async () => claims});
  const first = await verify('token', 'http://userinfo', mock);
  claims = {...claims, preferred_username: 'renamed', nickname: '新名称', role_code: 'system_admin'};
  const next = await verify('token', 'http://userinfo', mock);
  assert.equal(first.username, next.username); assert.equal(next.name, '新名称'); assert.equal(next.admin, true);
  claims.enable = 0;
  await assert.rejects(verify('token', 'http://userinfo', mock));
  await assert.rejects(verify('', 'http://userinfo', mock));
});

test('credential shares one parser between proxy and MCP entry points', () => {
  assert.equal(credential('Bearer abc'), 'abc');
  assert.equal(credential('token abc'), 'abc'); // gitea-mcp forwards credentials with this scheme
  assert.equal(credential('bearer abc'), 'abc');
  assert.equal(credential('TOKEN abc'), 'abc');
  const basic = value => `Basic ${Buffer.from(value).toString('base64')}`;
  assert.equal(credential(basic('git:abc')), 'abc');
  assert.equal(credential(basic('abc:x-oauth-basic')), 'abc');
  assert.equal(credential(basic('abc:')), 'abc');
  assert.equal(credential(basic('abc')), 'abc');
  assert.equal(credential('Digest abc'), '');
  assert.equal(credential(''), '');
  assert.equal(credential('Bearer'), '');
  assert.equal(credential(undefined), '');
});

test('browser bridge validates OAuth state and follows VOS locale and account changes', async () => {
  const script = await readFile(new URL('./bridge.js', import.meta.url), 'utf8');
  async function browser(validState) {
    const events = {}, requests = [], locations = [];
    const oauth = {authorize: async p => ({code: 'code', state: validState ? p.state : 'forged'}), token: async () => ({access_token: 'verified-token'})};
    const document = {getElementById: () => null, documentElement: {lang: 'en-US', dataset: {}}, querySelectorAll: () => [], body: {style: {}, replaceChildren: () => {}}, createElement: () => ({})};
    const window = {vos_platform: {api: {v1000: {oauth2: oauth}}, getState: async () => ({locale: 'en', theme: 'dark'}), broadcast: {on: (name, cb) => {events[name] = cb; return () => {};}}}, addEventListener: () => {}};
    const location = {href: 'https://vos.test/app/com.ictrek.gitea/', replace: value => locations.push(String(value)), reload: () => locations.push('reload')};
    await vm.runInNewContext(script, {window, document, location, URL, crypto: webcrypto, TextEncoder, Uint8Array, btoa, setTimeout, setInterval: () => 1, clearInterval: () => {}, fetch: async (path, options) => {requests.push({path, ...options}); return {ok: true, json: async () => ({changed: false})};}});
    return {events, requests, locations, document};
  }
  const good = await browser(true);
  assert.equal(good.requests[0].path, BASE + '/vos/login');
  assert.equal(JSON.parse(good.requests[0].body).access_token, 'verified-token');
  assert.equal(good.document.documentElement.dataset.theme, 'gitea-dark');
  await good.events['locale-change']({locale: 'zh-CN'});
  assert.match(good.locations[0], /lang=zh-CN/);
  await good.events['user-change']({user: null});
  assert.equal(good.document.body.style.visibility, 'hidden');
  assert.equal(good.requests.at(-1).path, BASE + '/vos/logout');
  assert.equal(good.locations.at(-1), 'reload');
  const forged = await browser(false);
  assert.equal(forged.requests.some(r => r.path.endsWith('/vos/login')), false);
});

test('client identity headers are replaced and authorization never reaches Gitea', () => {
  const h = upstreamHeaders({headers: {host: 'vos.test', authorization: 'Bearer secret', 'x-webauth-user': 'admin', 'x-vos-admin': 'true', 'x-vos-username': 'forged', 'x-forwarded-for': 'spoof'}}, {username: 'vos-real', subject: 'real', preferredUsername: 'alice', name: '中文', admin: false}, 'zh-CN');
  assert.equal(h['x-webauth-user'], 'vos-real'); assert.equal(h['x-vos-admin'], 'false');
  assert.equal(h.authorization, undefined); assert.equal(h['x-forwarded-for'], undefined);
  assert.equal(decodeURIComponent(h['x-vos-display-name']), '中文');
  assert.equal(h['x-vos-username'], 'alice');
});

test('gateway isolates accounts, validates machine access, rejects CSRF and revokes sessions', async t => {
  let enabled = true;
  const fetcher = async (_url, options) => {
    const token = options.headers.authorization.slice(7);
    return {ok: ['one', 'two'].includes(token), json: async () => ({sub: token, preferred_username: token, enable: enabled ? 1 : 0, role_code: 'user'})};
  };
  const upstream = http.createServer((req, res) => {
    // Gitea accepts its own PATs in both schemes and rejects every other credential
    const pat = ['Bearer gitea-pat', 'token gitea-pat'].includes(req.headers.authorization);
    if (req.headers.authorization && !pat) {res.writeHead(401); return res.end();}
    res.end(JSON.stringify({user: pat ? 'pat' : req.headers['x-webauth-user'], url: req.url, language: req.headers['x-vos-language']}));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const gateway = createGateway({userinfoUrl: 'http://userinfo', upstream: `http://127.0.0.1:${upstream.address().port}`, fetcher});
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  t.after(() => {gateway.closeAllConnections(); gateway.close(); upstream.closeAllConnections(); upstream.close();});
  const origin = `http://127.0.0.1:${gateway.address().port}`, base = origin + BASE;
  const login = token => fetch(base + '/vos/login', {method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: JSON.stringify({access_token: token, locale: 'zh-CN'})});
  const one = await login('one'), two = await login('two');
  assert.equal(one.status, 200); assert.equal(two.status, 200);
  const cookie1 = one.headers.get('set-cookie').split(';')[0], cookie2 = two.headers.get('set-cookie').split(';')[0];
  assert.notEqual(cookie1, cookie2);
  const r = await fetch(base + '/api/v1/user', {headers: {cookie: cookie1, 'x-webauth-user': 'admin'}});
  assert.deepEqual(await r.json(), {user: username('one'), url: BASE + '/api/v1/user?lang=zh-CN', language: 'zh-CN'});
  assert.equal((await fetch(base + '/api/v1/user', {headers: {cookie: cookie2}})).status, 200);
  assert.equal((await fetch(base + '/api/v1/user', {headers: {authorization: 'Bearer one'}})).status, 200);
  assert.equal((await fetch(base + '/owner/repo.git/info/refs', {headers: {authorization: `Basic ${Buffer.from('git:one').toString('base64')}`}})).status, 200);
  assert.equal((await fetch(base + '/api/v1/user', {headers: {authorization: `Basic ${Buffer.from('one:x-oauth-basic').toString('base64')}`}})).status, 200);
  assert.equal((await fetch(base + '/api/v1/user', {headers: {authorization: 'Digest one'}})).status, 401);
  // a PAT reaches Gitea untouched instead of being turned into a VOS identity
  const pat = await fetch(base + '/api/v1/user', {headers: {authorization: 'token gitea-pat'}});
  assert.equal(pat.status, 200);
  assert.equal((await pat.json()).user, 'pat');
  assert.equal((await fetch(base + '/api/v1/user', {headers: {'x-webauth-user': 'admin'}})).status, 401);
  assert.equal((await fetch(base + '/api/v1/user', {headers: {authorization: 'Bearer'}})).status, 401);
  // the locale is stored on the session, so a token caller has nothing to update
  assert.equal((await fetch(base + '/vos/locale', {method: 'POST', headers: {authorization: 'Bearer one', origin, 'content-type': 'application/json'}, body: '{"locale":"en-US"}'})).status, 403);
  assert.equal((await fetch(base + '/api/v1/repos', {method: 'POST', headers: {cookie: cookie1, origin: 'http://evil.test'}})).status, 403);
  assert.equal((await fetch(base + '/vos/login', {method: 'POST', headers: {origin: 'http://evil.test'}, body: '{}'})).status, 403);
  const nativeLogin = await fetch(base + '/user/login?redirect_to=' + encodeURIComponent(BASE + '/user/stopwatches'), {headers: {cookie: cookie1}, redirect: 'manual'});
  assert.equal(nativeLogin.status, 302);
  assert.equal(nativeLogin.headers.get('location'), BASE + '/user/stopwatches');
  assert.equal((await fetch(base + '/user/login', {headers: {cookie: cookie1}, redirect: 'manual'})).headers.get('location'), BASE + '/');
  assert.equal((await fetch(base + '/user/login?redirect_to=' + encodeURIComponent('https://evil.test/'), {headers: {cookie: cookie1}, redirect: 'manual'})).headers.get('location'), BASE + '/');
  enabled = false;
  assert.equal((await fetch(base + '/api/v1/user', {headers: {cookie: cookie1}})).status, 401);
  assert.equal((await fetch(base + '/api/v1/user', {headers: {authorization: 'Bearer one'}})).status, 401);
  enabled = true;
  assert.equal((await fetch(base + '/api/v1/user', {headers: {cookie: cookie1}})).status, 401);
});

test('MCP endpoint requires a VOS token or a valid Gitea PAT', async t => {
  let vosCalls = 0;
  const fetcher = async (url, options) => {
    const authorization = options.headers.authorization;
    // Gitea accepts its own PATs in both schemes, like the real server
    if (String(url).endsWith('/api/v1/user')) return {ok: ['Bearer gitea-pat', 'token gitea-pat'].includes(authorization)};
    vosCalls++;
    const token = authorization.slice(7);
    return {ok: token === 'vos-token', json: async () => ({sub: token, enable: 1, role_code: 'user'})};
  };
  const upstream = http.createServer((req, res) => {
    const authorization = req.headers.authorization || '';
    if (authorization === 'Bearer gitea-pat' || authorization === 'token gitea-pat') return res.end(JSON.stringify({user: 'pat'}));
    if (authorization) {res.writeHead(401); return res.end();}
    res.end(JSON.stringify({user: req.headers['x-webauth-user'] || ''}));
  });
  const mcp = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => res.end(JSON.stringify({url: req.url, authorization: req.headers.authorization || '', body})));
  });
  upstream.listen(0, '127.0.0.1'); mcp.listen(0, '127.0.0.1');
  await Promise.all([once(upstream, 'listening'), once(mcp, 'listening')]);
  const gateway = createGateway({userinfoUrl: 'http://userinfo', upstream: `http://127.0.0.1:${upstream.address().port}`, mcpUpstream: `http://127.0.0.1:${mcp.address().port}`, fetcher});
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  t.after(() => {
    for (const server of [gateway, upstream, mcp]) { server.closeAllConnections(); server.close(); }
  });
  const origin = `http://127.0.0.1:${gateway.address().port}`, base = origin + BASE;
  const call = (headers = {}, method = 'POST') => fetch(base + '/mcp', {method, headers: {'content-type': 'application/json', ...headers}, body: method === 'POST' ? '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' : undefined});
  const anonymous = await call();
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get('www-authenticate'), 'Bearer');
  assert.equal((await call({authorization: 'Bearer invalid'})).status, 401);
  assert.equal((await call({cookie: 'gitea_vos_session=forged'})).status, 401);
  assert.equal((await call({}, 'GET')).status, 405);
  const pat = await call({authorization: 'Bearer gitea-pat', origin: 'http://vos.test', host: 'vos.test'}); // the sidecar compares Origin with Host
  assert.equal(pat.status, 200);
  const patBody = await pat.json();
  assert.equal(patBody.url, '/mcp');
  assert.equal(patBody.authorization, 'Bearer gitea-pat');
  assert.equal(patBody.body, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
  assert.equal(vosCalls, 1); // a valid PAT never reaches VOS
  // Gitea accepts both schemes, so the gateway must parse the token scheme before forwarding it
  const scheme = await call({authorization: 'token gitea-pat'});
  assert.equal(scheme.status, 200);
  assert.equal((await scheme.json()).authorization, 'token gitea-pat');
  assert.equal(vosCalls, 1);
  const vos = await call({authorization: 'Bearer vos-token'});
  assert.equal(vos.status, 200);
  assert.equal((await vos.json()).authorization, 'Bearer vos-token');
  // the sidecar forwards VOS tokens with the "token" scheme, which must still resolve to the VOS identity
  const forwarded = await fetch(base + '/api/v1/user', {headers: {authorization: 'token vos-token'}});
  assert.equal(forwarded.status, 200);
  assert.equal((await forwarded.json()).user, username('vos-token'));
  const basic = `Basic ${Buffer.from('git:vos-token').toString('base64')}`;
  const wrapped = await call({authorization: basic});
  assert.equal(wrapped.status, 200);
  assert.equal((await wrapped.json()).authorization, basic);
  assert.equal((await call({authorization: 'Digest vos-token'})).status, 401);
});
