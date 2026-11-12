// Registers the organization or repository of the current settings page on
// GARM. The server reads the entity from the page path, so the button needs no
// knowledge of the page data.
(() => {
  const root = document.querySelector('[data-vos-garm-register]');
  if (!root) return;
  const button = root.querySelector('[data-vos-garm-register-button]');
  const status = root.querySelector('[data-vos-garm-register-status]');
  const base = root.dataset.vosGarmRegister;
  if (!button || !status || !base) return;

  const text = key => root.dataset[key] || '';
  const describe = result => {
    const created = (result.created || []).join(', ') || '-';
    return `${text('created')}: ${created} · ${text('webhook')}: ${result.webhook || '-'}`;
  };

  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = text('working');
    try {
      const response = await fetch(`${base}/vos/garm/register`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({page: location.pathname}),
      });
      if (!response.ok) throw Error((await response.text()).slice(0, 200) || String(response.status));
      status.textContent = describe(await response.json());
    } catch (error) {
      status.textContent = `${text('failed')} ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });
})();
