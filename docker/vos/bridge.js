(async () => {
  const BASE = '/app/com.ictrek.gitea';
  const locale = value => /^zh-(tw|hk|hant)/i.test(value || '') ? 'zh-TW' : /^zh/i.test(value || '') ? 'zh-CN' : 'en-US';
  // The settings page mirrors the user's choice into this cookie.
  const followLocale = () => !String(document.cookie || '').split(';').map(x => x.trim()).includes('vos_follow_locale=false');
  let bridge;
  for (let i = 0; i < 100; i++) {
    bridge = window.vos_platform;
    if (bridge) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const status = document.getElementById('vos-status');
  const error = () => {
    document.body.replaceChildren(Object.assign(document.createElement('p'), {textContent: '请从 VOS 重新打开 Gitea / Reopen Gitea from VOS'}));
    fetch(`${BASE}/vos/logout`, {method: 'POST'}).catch(() => {});
  };
  try {
    if (!bridge?.api?.v1000?.oauth2) throw Error('Bridge unavailable');
    const encode = b => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));
    let busy = false;
    async function login() {
      if (busy) return;
      busy = true;
      try {
        const oauth = bridge.api.v1000.oauth2;
        const verifier = random(), state = random();
        const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
        const code = await oauth.authorize({client_id: 'com.ictrek.gitea', response_type: 'code', scope: 'openid profile email', state, nonce: random(), code_challenge: challenge, code_challenge_method: 'S256'});
        if (code.state !== state) throw Error('OAuth state mismatch');
        const tokens = await oauth.token({client_id: 'com.ictrek.gitea', grant_type: 'authorization_code', code: code.code, code_verifier: verifier});
        const platform = await bridge.getState();
        const r = await fetch(`${BASE}/vos/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({access_token: tokens.access_token, locale: platform.locale})});
        if (!r.ok) throw Error('Login failed');
        const session = await r.json();
        const lang = locale(platform.locale);
        const follow = followLocale();
        // Only the first load and an account switch apply the platform language. A user's own choice stays until the platform language changes.
        if (status || session.changed) {
          const url = new URL(location.href);
          if (follow) url.searchParams.set('lang', lang);
          location.replace(url); return;
        }
        document.documentElement.dataset.theme = platform.theme === 'dark' ? 'gitea-dark' : 'gitea-light';
        document.querySelectorAll('[data-guide-lang]').forEach(el => { el.hidden = el.dataset.guideLang !== (lang.startsWith('zh') ? 'zh' : 'en'); });
      } catch { error(); } finally { busy = false; }
    }
    const offs = [bridge.broadcast?.on('locale-change', async state => {
      try {
        const r = await fetch(`${BASE}/vos/locale`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({locale: state.locale})});
        if (!r.ok) throw Error('Locale failed');
        if (!followLocale()) return;
        const url = new URL(location.href); url.searchParams.set('lang', locale(state.locale)); location.replace(url);
      } catch { error(); }
    }), bridge.broadcast?.on('theme-change', state => { document.documentElement.dataset.theme = state.theme === 'dark' ? 'gitea-dark' : 'gitea-light'; }), bridge.broadcast?.on('user-change', async () => {
      document.body.style.visibility = 'hidden';
      try { await fetch(`${BASE}/vos/logout`, {method: 'POST'}); } finally { location.reload(); }
    })];
    await login();
    const timer = setInterval(login, 15000);
    window.addEventListener('focus', login);
    window.addEventListener('pagehide', () => { clearInterval(timer); offs.forEach(off => off?.()); }, {once: true});
  } catch { error(); }
})();
