#!/usr/bin/env bash
# B17.5 — THE NIGHTLY TESTERS. Installed ONCE under launchd, and left running:
#
#   scripts/e2e-nightly.sh --install    # launchd starts it at login and again if it stops (B34.2)
#   scripts/e2e-nightly.sh --status     # whether it runs, its pid, the last run and the next
#   scripts/e2e-nightly.sh --now        # one run, now, then exit with the run's status
#   nohup scripts/e2e-nightly.sh >/dev/null 2>&1 &    # by hand, with nothing to restart it
#
# Each night at E2E_NIGHTLY_AT (default 03:00, this machine's clock) it brings this checkout to main's head,
# then runs the harness — the scenarios for E2E_USERS synthetic users, then E2E_EXPLORERS AI explorers for
# E2E_EXPLORE_MINUTES each — all under ONE hard cap, E2E_CAP_USD. The day's report is appended to docs/e2e/,
# and each new failure is filed in ~/talyvor-queue/BUILD.md (B17.4), and a short summary is put at the top of
# ~/talyvor-queue/TESTERS.md (B25.5). B34.2 — a checkout that cannot be brought to main's head runs nothing:
# the night writes a TESTERS.md entry saying why and which commit it would have tested, and exits 2. Nothing
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
label=${E2E_NIGHTLY_LABEL:-com.talyvor.e2e-nightly}
plist="$HOME/Library/LaunchAgents/$label.plist"

# This checkout's nightly loop, when it is alive: a pid the system has since given to something else is not it.
alive() {
  local pid
  pid=$(cat "$state/nightly.pid" 2>/dev/null) || return 1
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  case "$(ps -p "$pid" -o command=)" in *e2e-nightly.sh*) echo "$pid" ;; *) return 1 ;; esac
}
# When the loop is in the middle of a run: the time it started.
in_run() {
  local pid since
  [ -f "$state/nightly-running" ] && read -r pid since <"$state/nightly-running" || return 1
  kill -0 "$pid" 2>/dev/null && echo "$since"
}
# The pid launchd runs the nightly as, when it does.
launchd_pid() { launchctl print "gui/$(id -u)/$label" 2>/dev/null | awk '$1 == "pid" && $2 == "=" { print $3; exit }'; }
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

status() {
  local pid lpid since runs_at last ended next today
  pid=$(alive)
  lpid=$(launchd_pid)
  if [ -z "$pid" ]; then
    echo "nightly: NOT RUNNING — no night runs until it is started: scripts/e2e-nightly.sh --install"
  elif [ "$pid" = "$lpid" ]; then
    echo "nightly: running, pid $pid, under launchd ($label): it starts at login and again if it stops"
  else
    echo "nightly: running, pid $pid, started by hand — nothing restarts it if it stops: scripts/e2e-nightly.sh --install"
  fi
  [ -n "$pid" ] && echo "started: $(ps -p "$pid" -o lstart= | sed -e 's/^ *//' -e 's/ *$//')"
  [ -z "$pid" ] && [ -n "$lpid" ] && echo "launchd: $label runs pid $lpid, which is not this checkout's nightly"
  [ -f "$plist" ] && [ -z "$lpid" ] && ! launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1 &&
    echo "launchd: $plist is written but not loaded: scripts/e2e-nightly.sh --install"
  runs_at=$(grep 'nightly started' "$state/nightly.log" 2>/dev/null | tail -1 | sed -n 's/.*runs at \([0-9:]*\).*/\1/p')
  runs_at=${runs_at:-$at}
  echo "checkout: $repo at $(git -C "$repo" rev-parse --short HEAD) on $(git -C "$repo" rev-parse --abbrev-ref HEAD); main's head when it last looked: $(git -C "$repo" rev-parse --short origin/main 2>/dev/null || echo 'not fetched')"
  since=$(in_run) && echo "now: a run is in progress, started $since"
  last=$(grep -E '\] (run starting|HELD|no settings|pnpm install failed)' "$state/nightly.log" 2>/dev/null | tail -1)
  ended=$(grep -E '\] run finished' "$state/nightly.log" 2>/dev/null | tail -1)
  echo "last run: ${last:-none in $state/nightly.log}"
  [ -n "$ended" ] && [ -z "$since" ] && echo "          $ended"
  today=$(date +%F)
  if [ -z "$pid" ]; then
    next="none — the nightly is not running"
  elif [ "$(cat "$state/nightly-last" 2>/dev/null)" = "$today" ]; then
    next="$(date -v+1d +%F 2>/dev/null || date -d tomorrow +%F) $runs_at"
  elif [ "$(date +%H:%M)" \< "$runs_at" ]; then
    next="$today $runs_at"
  else
    next="now, within the minute"
  fi
  echo "next run: $next (this Mac's clock; a Mac asleep then runs it when it wakes)"
}

install() {
  local pid since bash_path
  [ "$(uname -s)" = Darwin ] || { echo "--install needs macOS's launchd"; exit 2; }
  pid=$(alive)
  if [ -n "$pid" ] && since=$(in_run); then
    echo "the nightly (pid $pid) is in the middle of a run that started $since; nothing was changed."
    echo "Run --install again once it has finished: scripts/e2e-nightly.sh --status"
    exit 1
  fi
  for tool in git node pnpm; do
    command -v "$tool" >/dev/null || { echo "$tool is not on this shell's PATH, which launchd will give the nightly; nothing was changed"; exit 2; }
  done
  bash_path=/bin/bash
  mkdir -p "$(dirname "$plist")"
  cat >"$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$(xml "$label")</string>
  <key>ProgramArguments</key>
  <array><string>$bash_path</string><string>$(xml "$repo/scripts/e2e-nightly.sh")</string></array>
  <key>WorkingDirectory</key><string>$(xml "$repo")</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(xml "$PATH")</string>
    <key>E2E_NIGHTLY_AT</key><string>$(xml "$at")</string>
    <key>E2E_ENV_FILE</key><string>$(xml "$env_file")</string>
  </dict>
  <key>StandardOutPath</key><string>$(xml "$state/nightly-launchd.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$state/nightly-launchd.log")</string>
</dict>
</plist>
PLIST
  plutil -lint "$plist" >/dev/null || { echo "$plist is not a valid property list"; exit 2; }
  # Take over: launchd stops an earlier install; one started by hand is stopped here, then launchd starts it.
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null
  pid=$(alive)
  if [ -n "$pid" ]; then
    kill "$pid"
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    if kill -0 "$pid" 2>/dev/null; then echo "the nightly (pid $pid) did not stop within 20 seconds; launchd was not given it"; exit 1; fi
    log "--install stopped the nightly started by hand (pid $pid); launchd starts it now"
  fi
  launchctl bootstrap "gui/$(id -u)" "$plist" || { echo "launchctl could not load $plist"; exit 1; }
  for _ in 1 2 3 4 5 6 7 8 9 10; do [ -n "$(alive)" ] && break; sleep 1; done
  status
  [ -n "$(alive)" ]
}

case "${1:-}" in
  --status) status; exit 0 ;;
  --install) install; exit $? ;;
  ''|--now) ;;
  *) echo "usage: scripts/e2e-nightly.sh [--install | --status | --now]" >&2; exit 2 ;;
esac

# One nightly per checkout: a second start exits rather than doubling the spend.
if [ "${1:-}" != "--now" ]; then
  if pid=$(alive) && [ "$pid" != "$$" ]; then
    log "already running as pid $pid — not starting a second"
    exit 0
  fi
  echo $$ >"$state/nightly.pid"
fi

# B34.2 — brings the checkout to main's head. Sets want to main's head (empty when it could not be read) and
# why to the reason the checkout is not there now (empty when it is).
to_main() {
  local branch out
  why='' want=''
  if ! out=$(git fetch -q origin main 2>&1); then
    why="main's head could not be read from origin: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-300)"
    return 0
  fi
  want=$(git log -1 --format='%h "%s"' FETCH_HEAD)
  branch=$(git rev-parse --abbrev-ref HEAD)
  out=$(git status --porcelain --untracked-files=no | head -5 | tr '\n' ' ')
  if [ "$branch" != main ]; then
    why="the checkout is not on main but on $branch"
  elif [ -n "$out" ]; then
    why="the checkout has changes of its own to files main tracks: $out"
  elif ! out=$(git merge -q --ff-only FETCH_HEAD 2>&1); then
    why="main could not be fast-forwarded into the checkout: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-300)"
  elif [ "$(git rev-parse HEAD)" != "$(git rev-parse FETCH_HEAD)" ]; then
    why="the checkout is at $(git rev-parse --short HEAD), which has commits main does not"
  fi
  return 0
}

run_once() {
  local code
  if [ ! -f "$env_file" ]; then
    log "no settings at $env_file — skipped (it needs LENS_SYNTHETIC_KEY, E2E_APP_URL, E2E_LENS_URL)"
    return 0
  fi
  echo "$$ $(date -u +%FT%TZ)" >"$state/nightly-running"
  (
    set -a
    # shellcheck disable=SC1090
    . "$env_file"
    set +a
    export E2E_EXPLORERS=${E2E_EXPLORERS:-10} E2E_EXPLORE_MINUTES=${E2E_EXPLORE_MINUTES:-30}
    cd "$repo" || exit 2
    to_main
    if [ -n "$why" ]; then
      log "HELD — $why; main's head is ${want:-not known}; no scenario is run tonight"
      node --experimental-strip-types --no-warnings e2e/src/held.ts --why "$why" --would-test "${want:+main at $want}" >>"$state/nightly.log" 2>&1 ||
        log "could not write the held night into TESTERS.md (e2e/src/held.ts); this log is its only record"
      exit 2
    fi
    pnpm install --frozen-lockfile >>"$state/nightly.log" 2>&1 || { log "pnpm install failed — skipped"; exit 2; }
    pnpm --filter @talyvor/e2e exec playwright install chromium >>"$state/nightly.log" 2>&1
    log "run starting at $(git rev-parse --short HEAD): ${E2E_USERS:-100} users, $E2E_EXPLORERS explorers, cap \$${E2E_CAP_USD:-5}"
    node --experimental-strip-types --no-warnings e2e/src/run.ts >>"$state/nightly.log" 2>&1
  )
  code=$?
  rm -f "$state/nightly-running"
  log "run finished: exit $code (0 all passed, 1 something failed, 2 could not run or held behind main)"
  return "$code"
}

if [ "${1:-}" = "--now" ]; then
  run_once
  exit $?
fi

# Started after tonight's hour has passed: the first run is tomorrow's, not one straight away.
[ -f "$state/nightly-last" ] || { [ "$(date +%H:%M)" \< "$at" ] || date +%F >"$state/nightly-last"; }
log "nightly started (pid $$): runs at $at each night; settings from $env_file"
self=$(cksum <"$0")
while :; do
  if [ "$(date +%F)" != "$(cat "$state/nightly-last" 2>/dev/null)" ] && ! [ "$(date +%H:%M)" \< "$at" ]; then
    date +%F >"$state/nightly-last"
    run_once
    # A night that brought in a new copy of this script goes on under it, in the same pid.
    if [ "$(cksum <"$0")" != "$self" ]; then
      log "scripts/e2e-nightly.sh changed with main; the nightly goes on under the new one"
      exec "$BASH" "$0"
    fi
  fi
  sleep 60
done
