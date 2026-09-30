#!/bin/sh
# B17.3 SELF-TEST — the whole harness, end to end, on this machine: the stub Lens (selftest/stub-lens.ts),
# stub Track and Docs (selftest/stub-products.ts, B17.8), the REAL BFF built from this checkout, the REAL
# web bundle, and a headless Chromium.
#
#   pnpm --filter @talyvor/e2e selftest                   # 10 users
#   E2E_USERS=30 STUB_BREAK=price pnpm --filter @talyvor/e2e selftest   # a planted defect must FAIL
#
# The report goes beside the results, build items only to E2E_BUILD_MD and the summary only to
# E2E_TESTERS_MD — never to the real queue. Lens's routes join the coverage map when E2E_LENS_SRC names
# a checkout of talyvor-lens.
#
# Needs Go, and Chromium for Playwright (`pnpm --filter @talyvor/e2e exec playwright install chromium`).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
stub_port=${STUB_PORT:-9911}
track_port=$((stub_port + 100))
docs_port=$((stub_port + 200))
bff_port=${BFF_PORT:-8797}
key=selftest-key
gateway=selftest-gateway
tmp=$(mktemp -d)

(cd "$root/apps/bff" && go build -o "$tmp/bff" .)
[ -f "$root/apps/web/dist/index.html" ] || pnpm --dir "$root" --filter @talyvor/web build

STUB_PORT=$stub_port STUB_APP_URL="http://localhost:$bff_port" LENS_SYNTHETIC_KEY=$key node --experimental-strip-types --no-warnings "$here/stub-lens.ts" &
stub=$!
TRACK_PORT=$track_port DOCS_PORT=$docs_port GATEWAY_SECRET=$gateway node --experimental-strip-types --no-warnings "$here/stub-products.ts" &
products=$!
sleep 1
env -i PATH="$PATH" HOME="$HOME" \
  BFF_AUTH_MODE=oidc BFF_ADDR="127.0.0.1:$bff_port" BFF_PUBLIC_BASE_URL="http://localhost:$bff_port" \
  OIDC_ISSUER="http://127.0.0.1:$stub_port" OIDC_CLIENT_ID=selftest OIDC_CLIENT_SECRET=selftest OIDC_ALLOWED_EMAILS='*' \
  LENS_BASE_URL="http://127.0.0.1:$stub_port" LENS_PROVISION_SECRET=selftest LENS_SYNTHETIC_KEY=$key \
  TRACK_BASE_URL="http://127.0.0.1:$track_port" TRACK_GATEWAY_SECRET=$gateway \
  DOCS_BASE_URL="http://127.0.0.1:$docs_port" DOCS_GATEWAY_SECRET=$gateway \
  WEB_DIST="$root/apps/web/dist" "$tmp/bff" >"$tmp/bff.log" 2>&1 &
bff=$!
trap 'kill $stub $products $bff 2>/dev/null; true' EXIT
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -fs -o /dev/null "http://localhost:$bff_port/auth/me" && break
  sleep 0.5
done

LENS_SYNTHETIC_KEY=$key node --experimental-strip-types --no-warnings "$here/../src/run.ts" \
  --app "http://localhost:$bff_port" --lens "http://127.0.0.1:$stub_port" \
  --users "${E2E_USERS:-10}" --concurrency "${E2E_CONCURRENCY:-5}" --cap-usd "${E2E_CAP_USD:-1}" \
  --out "${E2E_OUT:-$here/../out}" --report-dir "${E2E_REPORT_DIR:-${E2E_OUT:-$here/../out}}" \
  --build-md "${E2E_BUILD_MD:-$tmp/BUILD.md}" --testers-md "${E2E_TESTERS_MD:-$tmp/TESTERS.md}" \
  --lens-src "${E2E_LENS_SRC:-none}" \
  --explorers "${E2E_EXPLORERS:-2}" --explore-minutes "${E2E_EXPLORE_MINUTES:-1}"
