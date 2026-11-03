#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHEET=""; COMMIT=""; BUILD_ONLY=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sheet) SHEET="$2"; shift 2 ;;
    --commit) COMMIT="$2"; shift 2 ;;
    --images) [[ "$2" == gitea ]] || exit 1; shift 2 ;;
    --build-only) BUILD_ONLY=true; shift ;;
    -h|--help) echo 'build_image.sh --sheet AMD_with_cuda|ARM_without_cuda --commit <local-source-commit> [--images gitea] [--build-only]'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done
[[ "$COMMIT" =~ ^[a-f0-9]{7,40}$ ]] || { echo 'Pass the authoritative local source commit with --commit' >&2; exit 1; }
case "$SHEET" in
  AMD_with_cuda) ARCH=amd64 ;;
  ARM_without_cuda) ARCH=arm64 ;;
  *) echo 'An explicit --sheet AMD_with_cuda or ARM_without_cuda is required' >&2; exit 1 ;;
esac
BUILD_ROOT="${GITEA_BUILD_ROOT:-$HOME/dev/build/gitea}"
mkdir -p "$BUILD_ROOT/context"
rsync -a --delete --exclude .git --exclude node_modules --exclude dist --exclude .make_evidence "$ROOT/" "$BUILD_ROOT/context/"
UPSTREAM="$(tr -d '[:space:]' < "$ROOT/ictrek.app/UPSTREAM_VERSION")"
REPOSITORY=swr.cn-southwest-2.myhuaweicloud.com/ictrek/gitea
TAG="${UPSTREAM}-${COMMIT:0:10}-${ARCH}"
IMAGE="$REPOSITORY:$TAG"
docker buildx build --load --provenance=false --sbom=false --platform "linux/$ARCH" \
  --build-arg "GITEA_VERSION=${UPSTREAM}+${COMMIT:0:10}" -t "$IMAGE" \
  -f "$BUILD_ROOT/context/docker/vos/Dockerfile" "$BUILD_ROOT/context" > "$BUILD_ROOT/build-$ARCH.log" 2>&1 </dev/null
docker run --rm --entrypoint node "$IMAGE" --test /opt/vos/gateway.test.mjs
PG_IMAGE="$(python3 "$ROOT/ictrek.app/scripts/record_image.py" --resolve --sheet "$SHEET" --component pgv --repository swr.cn-southwest-2.myhuaweicloud.com/ictrek/pgv)"
python3 "$ROOT/ictrek.app/scripts/verify_runtime.py" --image "$IMAGE" --postgres-image "$PG_IMAGE"
if [[ "$BUILD_ONLY" != true ]]; then
  docker push "$IMAGE"
  docker manifest inspect "$IMAGE" >/dev/null
  python3 "$ROOT/ictrek.app/scripts/record_image.py" --sheet "$SHEET" --component gitea --repository "$REPOSITORY" --tag "$TAG"
fi
echo "Verified image: $IMAGE"
