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
  // A stale ?lang= in the address would win over the cookie on every reload, so drop it once the page has a language.
  const address = new URL(location.href);
  if (address.searchParams.has('lang') && document.documentElement.lang) {
    address.searchParams.delete('lang');
    globalThis.history?.replaceState(null, '', address);
  }
  const followCookie = value => { document.cookie = `vos_follow_locale=${value}; Path=${BASE}/; Max-Age=31536000; SameSite=Lax`; };
  // Written synchronously so the gateway already serves the platform's own reload in this language.
  const platformCookie = value => { document.cookie = `vos_locale=${value}; Path=${BASE}/; Max-Age=31536000; SameSite=Lax`; };
  const languageMenu = document.querySelector?.('.ui.dropdown .menu.language-menu');
  // The footer only marks a concrete language, so show the follow entry when it is active.
  if (languageMenu && followLocale()) {
    languageMenu.querySelector('[data-vos-follow]')?.classList.add('selected');
    for (const item of languageMenu.querySelectorAll('a[lang]')) item.classList.remove('selected');
  }
  languageMenu?.addEventListener('click', async e => {
    const item = e.target.closest('.item');
    if (!item) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (item.dataset.vosFollow) {
      followCookie('true');
      const state = await bridge?.getState?.();
      if (state) platformCookie(locale(state.locale));
      location.reload();
      return;
    }
    followCookie('false');
    location.href = item.getAttribute('data-url') || location.href;
  }, true);
  const error = () => {
    document.body.replaceChildren(Object.assign(document.createElement('p'), {textContent: '请从 VOS 重新打开 Gitea / Reopen Gitea from VOS'}));
    fetch(`${BASE}/vos/logout`, {method: 'POST'}).catch(() => {});
  };
  try {
    if (!bridge?.api?.v1000?.oauth2) throw Error('Bridge unavailable');
    const encode = b => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));
    let busy = false;
    // The platform reloads the page on a locale change, so only reload after it clearly did not.
    const recentlyReloaded = () => Date.now() - Number(globalThis.sessionStorage?.getItem('vos_reload_at') || 0) < 5000;
    const reload = () => { globalThis.sessionStorage?.setItem('vos_reload_at', String(Date.now())); location.reload(); };
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
        // A fixed language stays; following the platform only reloads when the platform did not already do it.
        if (status || session.changed || (follow && !recentlyReloaded() && document.documentElement.lang !== lang)) {
          reload(); return;
        }
        document.documentElement.dataset.theme = platform.theme === 'dark' ? 'gitea-dark' : 'gitea-light';
        document.querySelectorAll('[data-guide-lang]').forEach(el => { el.hidden = el.dataset.guideLang !== (lang.startsWith('zh') ? 'zh' : 'en'); });
      } catch { error(); } finally { busy = false; }
    }
    const offs = [bridge.broadcast?.on('locale-change', async state => {
      try {
        // The platform reloads the page itself, so the gateway only has to know the new language for that reload.
        if (followLocale()) platformCookie(locale(state.locale));
        const r = await fetch(`${BASE}/vos/locale`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({locale: state.locale})});
        if (!r.ok) throw Error('Locale failed');
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
