#!/usr/bin/env bash
#
# Build the deployable artifacts with their commit stamp, and PROVE the stamp landed.
#
# ── WHY THIS SCRIPT EXISTS AT ALL ────────────────────────────────────────────
#
# The stamp has to be applied by whoever builds, and there are two builders: CI and a human on a
# workstation (deploy/README.md step 2). If CI stamped and the runbook did not, CI would go green
# while every real deploy shipped unstamped — a gate passing next to the defect it was written
# for. So the stamping is defined ONCE, here, and both callers invoke it.
#
# ── THE GUARD A UNIT TEST CANNOT BE ──────────────────────────────────────────
#
# apps/bff/version_test.go checks the DEFAULT is an honest placeholder. It cannot check that the
# placeholder was ever replaced, because nothing in a test binary can see whether the link step
# ran. That check is here and in CI, against the built artifacts: remove the -X flag or the
# SUITE_COMMIT export and this script fails.
#
# Usage:
#   scripts/build-release.sh          # both artifacts (what the runbook runs)
#   scripts/build-release.sh web      # just the bundle (CI's web job)
#   scripts/build-release.sh bff      # just the binary (CI's bff job)
#
# Env:
#   GOOS/GOARCH   target for the BFF binary; defaults to linux/amd64 (the deploy target).
#   SUITE_COMMIT  overrides the derived stamp. Set by CI only if it needs to; normally unset.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}"

target="${1:-all}"
case "${target}" in
all | web | bff) ;;
*)
    echo "error: unknown target '${target}' (want: all, web, bff)" >&2
    exit 2
    ;;
esac

# ── the stamp ────────────────────────────────────────────────────────────────
#
# FAIL LOUDLY rather than falling back to the placeholder. A release built outside a git checkout
# is a release nobody can identify, and quietly stamping it "dev" would hide that at exactly the
# moment it matters. If you genuinely need to build without git, pass SUITE_COMMIT explicitly —
# that is a decision, not an accident.
if [ -z "${SUITE_COMMIT:-}" ]; then
    if ! git -C "${repo_root}" rev-parse --git-dir >/dev/null 2>&1; then
        echo "error: not a git checkout, so no commit can be derived." >&2
        echo "       set SUITE_COMMIT explicitly if you mean to build anyway." >&2
        exit 1
    fi
    SUITE_COMMIT="$(git -C "${repo_root}" rev-parse --short HEAD)"
    # ⚠ A DIRTY TREE IS NOT THE COMMIT. The runbook builds on a workstation, where uncommitted
    # edits are normal; a bare SHA there would name a commit that does not describe what was
    # built. The suffix makes that visible in every readout instead of being invisible.
    if [ -n "$(git -C "${repo_root}" status --porcelain)" ]; then
        SUITE_COMMIT="${SUITE_COMMIT}-dirty"
    fi
fi
export SUITE_COMMIT

echo "==> stamping both artifacts with: ${SUITE_COMMIT}"
case "${SUITE_COMMIT}" in
*-dirty)
    echo "    NOTE: the working tree has uncommitted changes. The stamp says so."
    echo "          What you deploy will NOT correspond to ${SUITE_COMMIT%-dirty} as pushed."
    ;;
esac

# ── web ──────────────────────────────────────────────────────────────────────
if [ "${target}" = "all" ] || [ "${target}" = "web" ]; then
    echo "==> building the web bundle"
    # `pnpm build` is the recursive root build (typechecks packages/ui, builds apps/web) — the same
    # command CI has always run, now with SUITE_COMMIT in the environment. apps/web/vite.config.ts
    # reads it and emits dist/version.json plus a <meta name="talyvor-build"> in index.html.
    pnpm build

    echo "==> asserting the bundle reports ${SUITE_COMMIT}"
    # node, not jq: node is already required to have built this, jq may not be installed.
    # shellcheck disable=SC2016  # single quotes are deliberate: the $-expressions below are
    # node's, read from the environment at runtime. Bash must not expand them.
    node --input-type=module -e '
      import { readFileSync } from "node:fs"
      const want = process.env.SUITE_COMMIT
      const path = "apps/web/dist/version.json"
      let v
      try {
        v = JSON.parse(readFileSync(path, "utf8"))
      } catch (e) {
        console.error(`FAIL ${path} is missing or not JSON (${e.message}).`)
        console.error("     The stamping plugin did not run. Check apps/web/vite.config.ts.")
        process.exit(1)
      }
      if (v.stamped !== true || v.commit !== want) {
        console.error(`FAIL ${path} reports ${JSON.stringify(v)}`)
        console.error(`     expected commit=${want} stamped=true.`)
        console.error("     SUITE_COMMIT did not reach the build — this is the defect the")
        console.error("     version surface exists to prevent, so it fails here.")
        process.exit(1)
      }
      console.log(`    ok  dist/version.json = ${v.commit}`)
    '
    # The bundle must never ship claiming the placeholder. Checked separately from the equality
    # above so the failure message names the actual problem when someone changes the placeholder.
    if grep -q '"commit": *"dev"' apps/web/dist/version.json; then
        echo "FAIL the built bundle reports the unstamped placeholder as a commit" >&2
        exit 1
    fi
fi

# ── bff ──────────────────────────────────────────────────────────────────────
if [ "${target}" = "all" ] || [ "${target}" = "bff" ]; then
    goos="${GOOS:-linux}"
    goarch="${GOARCH:-amd64}"
    out="${repo_root}/bff-${goos}-${goarch}"

    echo "==> building the BFF binary (${goos}/${goarch})"
    (
        cd apps/bff
        GOOS="${goos}" GOARCH="${goarch}" CGO_ENABLED=0 go build \
            -trimpath \
            -ldflags="-s -w -X main.bffVersion=${SUITE_COMMIT}" \
            -o "${out}" .
    )

    host_os="$(go env GOHOSTOS)"
    host_arch="$(go env GOHOSTARCH)"
    if [ "${goos}" = "${host_os}" ] && [ "${goarch}" = "${host_arch}" ]; then
        echo "==> asserting the binary reports ${SUITE_COMMIT}"
        got="$("${out}" version)"
        echo "    built binary reports: ${got}"
        if [ "${got}" = "dev" ]; then
            echo "FAIL the release binary reports the unstamped placeholder —" >&2
            echo "     -X main.bffVersion was not applied. If bffVersion was changed to a" >&2
            echo "     const, the build would have accepted the flag and silently ignored it." >&2
            exit 1
        fi
        test "${got}" = "${SUITE_COMMIT}"
        echo "    ok  ${out##*/} = ${got}"
    else
        # ⚠ SAY SO RATHER THAN SKIP SILENTLY. Cross-compiling means the shipped artifact cannot be
        # executed here, so the strongest available local check is on the plumbing, using a
        # host-native binary built from the same source with the same flag. That is a DIFFERENT
        # BINARY from the one being shipped, and it is not a substitute.
        echo "    NOTE: cross-compiled ${goos}/${goarch} on ${host_os}/${host_arch} — the shipped"
        echo "          binary cannot be run here, so it was NOT asserted directly."
        probe="$(mktemp -d)/bff-hostprobe"
        (
            cd apps/bff
            CGO_ENABLED=0 go build \
                -ldflags="-X main.bffVersion=${SUITE_COMMIT}" -o "${probe}" .
        )
        got="$("${probe}" version)"
        rm -f "${probe}"
        test "${got}" = "${SUITE_COMMIT}" || {
            echo "FAIL host-native probe reports '${got}', expected '${SUITE_COMMIT}' —" >&2
            echo "     the -X plumbing is broken, so the shipped binary is unstamped too." >&2
            exit 1
        }
        echo "          plumbing verified on a host-native probe (${got})."
        echo "          VERIFY THE SHIPPED ARTIFACT ON THE SERVER: /opt/talyvor/bin/bff version"
        echo "          (deploy/README.md step 3b). CI asserts the real binary directly,"
        echo "          because CI's host IS linux/amd64."
    fi
fi

echo "==> done. stamp: ${SUITE_COMMIT}"
