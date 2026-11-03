#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
[[ -z "$(git status --porcelain)" ]] || { echo 'Commit application changes before releasing' >&2; exit 1; }
current="$(tr -d '[:space:]' < ictrek.app/VERSION)"
upstream="$(tr -d '[:space:]' < ictrek.app/UPSTREAM_VERSION)"
[[ "$current" == "$upstream".vos.* ]] || { echo 'VERSION must be UPSTREAM_VERSION.vos.<revision>' >&2; exit 1; }
revision="${current##*.}"
[[ "$revision" =~ ^[0-9]+$ ]] || exit 1
version="$upstream.vos.$((10#$revision + 1))"
tag="vos-gitea-v$version"
for candidate in "$tag" "v$version"; do
  if git show-ref --quiet "refs/tags/$candidate" || git ls-remote --exit-code --tags origin "refs/tags/$candidate" >/dev/null 2>&1; then
    echo "Tag already exists: $candidate" >&2; exit 1
  fi
done
printf '%s\n' "$version" > ictrek.app/VERSION
git add ictrek.app/VERSION
git commit -m "chore: release VOS Gitea $version" -m 'Assisted-by: Codex:GPT-6'
git tag "$tag"
git push origin "$(git branch --show-current)"
git push origin "$tag"
echo "Triggered $tag; verify GitHub Actions and App Store publication."
