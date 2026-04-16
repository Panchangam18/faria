#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

usage() {
  cat <<'EOF'
Usage:
  RELEASE_TAG=v1.0.0-beta.2 npm run release:local

Optional environment variables:
  RELEASE_NAME         Defaults to "Faria Beta v<package-version>"
  RELEASE_NOTES        Defaults to a short local notarization note
  RELEASE_DMG_PATH     Defaults to "dist/Faria.dmg"
  R2_ENDPOINT_URL      If set with AWS credentials, also uploads the DMG to R2
  R2_BUCKET_PATH       Defaults to "s3://faria-media/Faria.dmg"
  R2_APP_BUCKET_PATH   Defaults to "s3://faria-media/Faria.app.zip" (zipped .app)
EOF
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

for cmd in gh xcrun spctl node; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
done

PACKAGE_VERSION="$(node -p "require('./package.json').version")"
RELEASE_TAG="${RELEASE_TAG:-}"
RELEASE_DMG_PATH="${RELEASE_DMG_PATH:-dist/Faria.dmg}"
APP_PATH="dist/mac-arm64/Faria.app"
RELEASE_NAME="${RELEASE_NAME:-Faria Beta v${PACKAGE_VERSION}}"
RELEASE_NOTES="${RELEASE_NOTES:-Locally signed, notarized, stapled, and uploaded from a developer machine.}"
R2_BUCKET_PATH="${R2_BUCKET_PATH:-s3://faria-media/Faria.dmg}"
R2_APP_BUCKET_PATH="${R2_APP_BUCKET_PATH:-s3://faria-media/Faria.app.zip}"

if [[ -z "$RELEASE_TAG" ]]; then
  usage
  echo >&2
  echo "RELEASE_TAG is required." >&2
  exit 1
fi

if [[ "$RELEASE_TAG" != "v${PACKAGE_VERSION}"* ]]; then
  echo "Release tag $RELEASE_TAG does not match package version ${PACKAGE_VERSION}." >&2
  exit 1
fi

if [[ ! -f "$RELEASE_DMG_PATH" ]]; then
  echo "Missing DMG at $RELEASE_DMG_PATH" >&2
  exit 1
fi

if [[ ! -d "$APP_PATH" ]]; then
  echo "Missing signed app at $APP_PATH" >&2
  exit 1
fi

gh auth status >/dev/null
xcrun stapler validate "$APP_PATH" >/dev/null
spctl -a -vv "$APP_PATH" >/dev/null

if gh release view "$RELEASE_TAG" >/dev/null 2>&1; then
  gh release edit "$RELEASE_TAG" --title "$RELEASE_NAME" --notes "$RELEASE_NOTES"
  gh release upload "$RELEASE_TAG" "$RELEASE_DMG_PATH#Faria.dmg" --clobber
else
  gh release create "$RELEASE_TAG" "$RELEASE_DMG_PATH#Faria.dmg" \
    --title "$RELEASE_NAME" \
    --notes "$RELEASE_NOTES" \
    --target "$(git rev-parse HEAD)"
fi

if [[ -n "${R2_ENDPOINT_URL:-}" && -n "${AWS_ACCESS_KEY_ID:-}" && -n "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
  if ! command -v aws >/dev/null 2>&1; then
    echo "Skipping R2 upload because aws CLI is not installed." >&2
  else
    aws s3 cp "$RELEASE_DMG_PATH" "$R2_BUCKET_PATH" \
      --endpoint-url "$R2_ENDPOINT_URL" \
      --content-type application/x-apple-diskimage

    APP_ZIP="$(mktemp -t faria-app).zip"
    ditto -c -k --keepParent "$APP_PATH" "$APP_ZIP"
    aws s3 cp "$APP_ZIP" "$R2_APP_BUCKET_PATH" \
      --endpoint-url "$R2_ENDPOINT_URL" \
      --content-type application/zip
    rm -f "$APP_ZIP"

    # Upload version metadata so the site can show the current version
    LATEST_JSON="$(mktemp).json"
    printf '{"version":"%s","tag":"%s","date":"%s"}' \
      "$PACKAGE_VERSION" "$RELEASE_TAG" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$LATEST_JSON"
    aws s3 cp "$LATEST_JSON" "s3://faria-media/latest.json" \
      --endpoint-url "$R2_ENDPOINT_URL" \
      --content-type application/json \
      --cache-control "no-cache, max-age=0"
    rm -f "$LATEST_JSON"
    echo "Uploaded latest.json → s3://faria-media/latest.json"
  fi
fi

gh release view "$RELEASE_TAG" --json url --jq '.url'
