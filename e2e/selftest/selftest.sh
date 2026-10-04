#!/bin/sh
# B17.3 SELF-TEST — the whole harness, end to end, on this machine: the stub Lens (selftest/stub-lens.ts),
# stub Track and Docs (selftest/stub-products.ts, B17.8), the REAL BFF built from this checkout, the REAL
# web bundle, and a headless Chromium.
#
#   pnpm --filter @talyvor/e2e selftest                   # 10 users
#   E2E_USERS=30 STUB_BREAK=price pnpm --filter @talyvor/e2e selftest   # a planted defect must FAIL
#   E2E_FAULTS=1 pnpm --filter @talyvor/e2e selftest      # B26.18: the run's browser is killed mid-run, then
#                                                         # Lens; the report and summary must still be written
#                                                         # and name both
#
# The report goes beside the results, build items only to E2E_BUILD_MD and the summary only to
# E2E_TESTERS_MD — never to the real queue. Lens's routes join the coverage map, and lens-reads reads each
# from the stub, from a checkout of talyvor-lens's main the run clones beside the results (or the one
# E2E_LENS_SRC names).
#
# B26.24: the stub answers each read as a real Lens does (test/stubLens.test.ts holds it to
# lens-shapes.json). A route the app reads that the stub does not know fails the self-test by name.
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
moderator=tlv_mod_selftest
gateway=selftest-gateway
tmp=$(mktemp -d)

(cd "$root/apps/bff" && go build -o "$tmp/bff" .)
[ -f "$root/apps/web/dist/index.html" ] || pnpm --dir "$root" --filter @talyvor/web build

STUB_PORT=$stub_port STUB_APP_URL="http://localhost:$bff_port" LENS_SYNTHETIC_KEY=$key STUB_MODERATOR_KEY=$moderator node --experimental-strip-types --no-warnings "$here/stub-lens.ts" >"$tmp/stub.log" 2>&1 &
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
head -1 "$tmp/stub.log"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -fs -o /dev/null "http://localhost:$bff_port/auth/me" && break
  sleep 0.5
done

if [ "${E2E_FAULTS:-}" = 1 ]; then
  out=$tmp/faults
  LENS_SYNTHETIC_KEY=$key LENS_MODERATOR_KEY=$moderator node --experimental-strip-types --no-warnings "$here/../src/run.ts" \
    --app "http://localhost:$bff_port" --lens "http://127.0.0.1:$stub_port" \
    --users "${E2E_USERS:-10}" --concurrency "${E2E_CONCURRENCY:-5}" --cap-usd "${E2E_CAP_USD:-1}" \
    --out "$out" --report-dir "$out" --build-md "$tmp/BUILD.md" --testers-md "$out/TESTERS.md" \
    --lens-src none --explorers 2 --explore-minutes 1 >"$tmp/run.log" 2>&1 &
  run=$!
  count() { grep -cE "$1" "$tmp/run.log" || true; }
  until_count() { # until_count <what> <pattern> <n>
    waited=0
    until [ "$(count "$2")" -ge "$3" ]; do
      waited=$((waited + 1))
      if [ $waited -gt 600 ] || ! kill -0 $run 2>/dev/null; then cat "$tmp/run.log"; echo "selftest: the run never reached $3 $1"; exit 1; fi
      sleep 1
    done
  }
  until_count verdicts '^(PASS|FAIL|ERROR|SKIP) ' 3
  passed=$(count '^PASS ')
  pkill -9 -P $run # the run's browser: the only process the run starts (--lens-src none clones nothing)
  echo "selftest: killed the run's browser after $passed passes"
  # Every scenario in the dead browser errors, so a new PASS is a user's on the browser that replaced it.
  until_count 'passes on a new browser' '^PASS ' $((passed + 1))
  kill $stub
  echo "selftest: stopped the stub Lens after $(count '^PASS ') passes"
  code=0
  wait $run || code=$?
  cat "$tmp/run.log"
  failed=0
  check() { # check <what> <file> <text>
    if grep -qF "$3" "$2" 2>/dev/null; then echo "selftest: ok — $1"; else echo "selftest: FAILED — $1: no \"$3\" in $2"; failed=1; fi
  }
  report=$(ls "$out"/report-*.md 2>/dev/null | head -1)
  check 'the report says the run stopped early' "$report" 'STOPPED EARLY'
  check 'the report names Lens as the cause' "$report" 'ECONNREFUSED'
  check 'the report names the browser that went away' "$report" 'the browser went away mid-run'
  check 'the report states the spend so far' "$report" 'Cost: about $'
  check 'TESTERS.md says the run stopped early' "$out/TESTERS.md" 'STOPPED EARLY'
  check 'TESTERS.md names Lens as the cause' "$out/TESTERS.md" 'ECONNREFUSED'
  check 'TESTERS.md names the browser that went away' "$out/TESTERS.md" 'the browser went away mid-run'
  check 'TESTERS.md states the spend so far' "$out/TESTERS.md" 'spent before it stopped'
  if [ "$code" -ne 1 ]; then echo "selftest: FAILED — the run exited $code, not 1"; failed=1; fi
  exit $failed
fi

code=0
LENS_SYNTHETIC_KEY=$key LENS_MODERATOR_KEY=$moderator node --experimental-strip-types --no-warnings "$here/../src/run.ts" \
  --app "http://localhost:$bff_port" --lens "http://127.0.0.1:$stub_port" \
  --users "${E2E_USERS:-10}" --concurrency "${E2E_CONCURRENCY:-5}" --cap-usd "${E2E_CAP_USD:-1}" \
  --out "${E2E_OUT:-$here/../out}" --report-dir "${E2E_REPORT_DIR:-${E2E_OUT:-$here/../out}}" \
  --build-md "${E2E_BUILD_MD:-$tmp/BUILD.md}" --testers-md "${E2E_TESTERS_MD:-$tmp/TESTERS.md}" \
  ${E2E_LENS_SRC:+--lens-src "$E2E_LENS_SRC"} \
  --explorers "${E2E_EXPLORERS:-2}" --explore-minutes "${E2E_EXPLORE_MINUTES:-1}" || code=$?
if grep -F 'reset EVERY synthetic workspace' "$tmp/stub.log"; then
  echo "selftest: FAILED — the run reset every synthetic workspace; it must name its own users (B27.16)"
  code=1
fi
missed=$(grep -F '(asked by the BFF)' "$tmp/stub.log" | sort | uniq -c || true)
if [ -n "$missed" ]; then
  echo "selftest: FAILED — the app read routes the stub Lens does not answer. Teach selftest/stub-lens.ts each one as Lens"
  echo "answers it, and add it to READS in selftest/lens-shapes.ts (then re-record with record-lens-shapes.ts):"
  echo "$missed"
  code=1
fi
exit $code
