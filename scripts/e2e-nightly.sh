#!/usr/bin/env bash
# B17.5 — THE NIGHTLY TESTERS. Started ONCE, like ~/talyvor-queue/deploy.sh, and left running:
#
#   nohup scripts/e2e-nightly.sh >/dev/null 2>&1 &     # every night at E2E_NIGHTLY_AT
#   scripts/e2e-nightly.sh --now                        # one run, now, then exit
#
# Each night at E2E_NIGHTLY_AT (default 03:00, this machine's clock) it brings this checkout up to main
# (only when it is on main), then runs the harness — the scenarios for E2E_USERS synthetic users, then
# E2E_EXPLORERS AI explorers for E2E_EXPLORE_MINUTES each — all under ONE hard cap, E2E_CAP_USD. The
# day's report is appended to docs/e2e/, and each new failure is filed in ~/talyvor-queue/BUILD.md
# (B17.4), and a short summary is put at the top of ~/talyvor-queue/TESTERS.md (B25.5). It keeps a
# shallow checkout of talyvor-lens in e2e/out/lens-src so the coverage map lists Lens's routes. Nothing
# here deploys, pushes or commits.
#
# Settings are read from E2E_ENV_FILE (default ~/.config/talyvor/e2e.env) before every run:
#   LENS_SYNTHETIC_KEY=…   E2E_APP_URL=https://app.talyvor.com   E2E_LENS_URL=https://lens.talyvor.com
# and any other E2E_* setting (e2e/README.md). A night without them is logged and skipped.
set -uo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
state="$repo/e2e/out"
mkdir -p "$state"
log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$state/nightly.log"; }
at=${E2E_NIGHTLY_AT:-03:00}
env_file=${E2E_ENV_FILE:-$HOME/.config/talyvor/e2e.env}

# One nightly per checkout: a second start exits rather than doubling the spend.
if [ "${1:-}" != "--now" ]; then
  if [ -f "$state/nightly.pid" ] && kill -0 "$(cat "$state/nightly.pid")" 2>/dev/null; then
    log "already running as pid $(cat "$state/nightly.pid") — not starting a second"
    exit 0
  fi
  echo $$ >"$state/nightly.pid"
fi

run_once() {
  if [ ! -f "$env_file" ]; then
    log "no settings at $env_file — skipped (it needs LENS_SYNTHETIC_KEY, E2E_APP_URL, E2E_LENS_URL)"
    return
  fi
  (
    set -a
    # shellcheck disable=SC1090
    . "$env_file"
    set +a
    export E2E_EXPLORERS=${E2E_EXPLORERS:-10} E2E_EXPLORE_MINUTES=${E2E_EXPLORE_MINUTES:-30}
    cd "$repo" || exit 2
    if [ "$(git rev-parse --abbrev-ref HEAD)" = main ]; then
      git pull -q --ff-only origin main || log "could not bring the checkout up to main; running what is here"
    fi
    pnpm install --frozen-lockfile >>"$state/nightly.log" 2>&1 || { log "pnpm install failed — skipped"; exit 2; }
    # B25.5 — Lens's source, up to its main, so the coverage map lists every route Lens registers.
    lens_src=${E2E_LENS_SRC:-$state/lens-src}
    if [ -d "$lens_src/.git" ]; then
      { git -C "$lens_src" fetch -q --depth 1 origin main && git -C "$lens_src" reset -q --hard FETCH_HEAD; } >>"$state/nightly.log" 2>&1 ||
        log "could not bring $lens_src up to Lens's main; the map lists the routes it has"
    else
      git clone -q --depth 1 "${E2E_LENS_REPO:-https://github.com/gaboracnicolai/talyvor-lens.git}" "$lens_src" >>"$state/nightly.log" 2>&1 ||
        log "could not clone Lens into $lens_src; the map will say Lens's routes are not listed"
    fi
    export E2E_LENS_SRC=$lens_src
    pnpm --filter @talyvor/e2e exec playwright install chromium >>"$state/nightly.log" 2>&1
    log "run starting at $(git rev-parse --short HEAD): ${E2E_USERS:-100} users, $E2E_EXPLORERS explorers, cap \$${E2E_CAP_USD:-5}"
    node --experimental-strip-types --no-warnings e2e/src/run.ts >>"$state/nightly.log" 2>&1
  )
  log "run finished: exit $? (0 all passed, 1 something failed, 2 could not run)"
}

if [ "${1:-}" = "--now" ]; then
  run_once
  exit 0
fi

# Started after tonight's hour has passed: the first run is tomorrow's, not one straight away.
[ -f "$state/nightly-last" ] || { [ "$(date +%H:%M)" \< "$at" ] || date +%F >"$state/nightly-last"; }
log "nightly started (pid $$): runs at $at each night; settings from $env_file"
while :; do
  if [ "$(date +%F)" != "$(cat "$state/nightly-last" 2>/dev/null)" ] && ! [ "$(date +%H:%M)" \< "$at" ]; then
    date +%F >"$state/nightly-last"
    run_once
  fi
  sleep 60
done
