import {GET} from '../modules/fetch.ts';
import {registerGlobalInitFunc} from '../modules/observer.ts';
import {showElem} from '../utils/dom.ts';

const key = 'gitea.vos.garm-url';
const vosRunnerPath = '/#/app/app-drawer/com.ictrek.garm/runners';

export function parseGarmURL(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

export function initVosGarm() {
  registerGlobalInitFunc('initVosGarmChoices', (element: HTMLElement) => {
    const local = element.querySelector<HTMLAnchorElement>('a[data-garm-local]')!;
    const form = element.querySelector<HTMLFormElement>('form')!;
    const input = form.querySelector<HTMLInputElement>('input')!;

    void GET('/app/com.ictrek.garm/ui/', {
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(2000),
    }).then(async (response) => {
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return;
      if (!(await response.text()).includes('/app/com.ictrek.garm/ui/_app/')) return;
      local.href = vosRunnerPath;
      showElem(local);
    }).catch(() => { /* GARM is optional. */ });

    try {
      input.value = localStorage.getItem(key) || '';
    } catch { /* Storage is optional. */ }
    input.addEventListener('input', () => {
      input.setCustomValidity('');
      if (!input.value.trim()) {
        try { localStorage.removeItem(key); } catch { /* Storage is optional. */ }
      }
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const url = parseGarmURL(input.value);
      if (!url) {
        input.setCustomValidity(input.getAttribute('data-invalid-url')!);
        input.reportValidity();
        return;
      }
      try { localStorage.setItem(key, url.href); } catch { /* Storage is optional. */ }
      window.open(url.href, '_blank', 'noopener,noreferrer');
    });
  });
}
