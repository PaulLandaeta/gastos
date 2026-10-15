#!/usr/bin/env bash
# Feature 006 (FR-013–FR-016): reproducible production deploy. See docs/deploy.md.
#   preflight → build (versioned) → Firestore rules + indexes → Worker → Hosting → smoke test
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ] && [ "${ALLOW_DIRTY:-}" != "1" ]; then
  echo "✗ Hay cambios sin confirmar: el despliegue se versiona con el commit (ALLOW_DIRTY=1 para forzar)."
  exit 1
fi
SHA="$(git rev-parse --short HEAD)"

echo "▸ 1/6 Preflight"
pnpm --filter ops ops preflight ${PREFLIGHT_FLAGS:-}

set -a
# shellcheck disable=SC1091
source apps/web/.env.production
set +a
APP_URL="${APP_URL:-https://${VITE_FIREBASE_PROJECT_ID}.web.app}"
API_URL="${VITE_API_URL%/v1}"

echo "▸ 2/6 Build web $SHA"
VITE_APP_VERSION="$SHA" pnpm --filter web build

echo "▸ 3/6 Firestore rules e índices"
npx -y firebase-tools@15 deploy --project prod --only firestore:rules,firestore:indexes --non-interactive

echo "▸ 4/6 Worker (API) $SHA"
pnpm --filter api exec wrangler deploy --var "API_VERSION:$SHA"

echo "▸ 5/6 Hosting"
npx -y firebase-tools@15 deploy --project prod --only hosting --non-interactive

echo "▸ 6/6 Smoke test ($APP_URL, $API_URL)"
pnpm --filter ops ops smoke --app "$APP_URL" --api "$API_URL"
echo "✓ Despliegue $SHA completado"
