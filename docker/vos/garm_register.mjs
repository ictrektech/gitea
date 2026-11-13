// Helpers behind the "register on GARM" button. The gateway owns the network
// calls; everything here is pure so it can be tested without a server.

// Gitea owner, repository and label names.
export const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const MAX_LABELS = 8;
export const MAX_LABEL_LENGTH = 50;

// parseEntityPath reads the entity from the runners settings page:
//   /app/com.ictrek.gitea/org/acme/settings/actions/runners
//   /app/com.ictrek.gitea/acme/ci-test/settings/actions/runners
export function parseEntityPath(pathname, base) {
  const path = pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
  let match = /^\/org\/([^/]+)\/settings\/actions\/runners/.exec(path);
  if (match) return {owner: match[1], repo: ''};
  match = /^\/([^/]+)\/([^/]+)\/settings\/actions\/runners/.exec(path);
  if (match) return {owner: match[1], repo: match[2]};
  return null;
}

// extractRunsOn returns the runs-on labels a workflow text asks for. Labels
// built from expressions cannot be evaluated here and are skipped.
export function extractRunsOn(text) {
  const labels = [];
  const lines = String(text || '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const match = /^(\s*)runs-on:\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const indent = match[1].length;
    const value = stripComment(match[2]).trim();
    if (value.startsWith('[')) {
      for (const item of value.replace(/^\[|\]$/g, '').split(',')) addLabel(labels, item);
      continue;
    }
    if (value) {
      addLabel(labels, value);
      continue;
    }
    for (let next = index + 1; next < lines.length; next++) {
      const item = /^(\s*)-\s+(.*)$/.exec(lines[next]);
      if (!item || item[1].length <= indent) break;
      addLabel(labels, item[2]);
    }
  }
  return labels;
}

// tokenArgs returns the arguments that mint a token for a VOS user in Gitea.
// The username comes from the session, but it is checked again before it
// reaches the command line.
export function tokenArgs(username, configPath) {
  if (!/^vos-[a-f0-9]{24}$/.test(String(username))) throw new Error('unexpected Gitea username');
  return ['admin', 'user', 'generate-access-token', '--username', username, '--token-name', 'garm-vos', '--scopes', 'all', '--raw', '--config', configPath];
}

// staleHooks returns the hooks that point at another controller of the same
// GARM instance.
export function staleHooks(hooks, wanted) {
  const normalized = String(wanted || '').replace(/\/$/, '');
  const prefix = normalized.slice(0, normalized.lastIndexOf('/') + 1);
  if (!prefix) return [];
  return (hooks || []).filter(hook => {
    const url = String(hook?.config?.url || '').replace(/\/$/, '');
    return url.toLowerCase().startsWith(prefix.toLowerCase()) && url.toLowerCase() !== normalized.toLowerCase();
  });
}

// mergeLabels deduplicates labels and applies the limits of the GARM API.
export function mergeLabels(lists) {
  const merged = [];
  for (const list of lists) {
    for (const label of list || []) {
      const value = String(label).trim();
      if (!value || value.length > MAX_LABEL_LENGTH || !NAME_PATTERN.test(value)) continue;
      if (merged.includes(value)) continue;
      if (merged.length === MAX_LABELS) return merged;
      merged.push(value);
    }
  }
  return merged;
}

function addLabel(labels, raw) {
  const value = stripComment(raw).replace(/^['"]|['"]$/g, '').trim();
  // shortcut: expressions such as ${{ matrix.os }} are not evaluated.
  if (!value || value.includes('${{') || !NAME_PATTERN.test(value)) return;
  labels.push(value);
}

function stripComment(value) {
  const hash = value.indexOf('#');
  return hash < 0 ? value : value.slice(0, hash);
}
