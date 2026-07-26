#!/usr/bin/env bash
# Does a published image exist for each service's CURRENT main, and does :latest point at it?
# Four verdicts, because three of them need different responses:
#   OK       — :sha exists and :latest is the same image. Deploy.
#   MISSING  — no image was ever published for this commit. Re-run the image workflow.
#   STALE    — an image exists for this commit but :latest is a DIFFERENT build
#              (a re-run pushed an older commit over it). Deploy by digest, not :latest.
#   BUILDING — images.yaml is queued or running for this SHA right now. WAIT, do not investigate.
#              Builds take 8-13 minutes, so every merge leaves a window where main is ahead of the
#              registry. This is the state I first reported as MISSING; the fix is to ask GitHub,
#              because the registry cannot tell you about work in flight.
#   NO-BUILD — no run exists AND the commit touches no path images.yaml watches (docs/LICENSE
#              only). No image is expected; :latest correctly still points at the previous
#              commit, and deploying it is right.
#   UNKNOWN  — the registry lookup itself failed (network/auth/rate limit). NOT the same as
#              MISSING: treating a hiccup as "no image" is how you re-run a build you already have.
#
# "Absent" is never one state. It is at least never-existed, not-yet, not-expected, and
# lookup-failed — and each wants a different thing from you.
owner=gaboracnicolai
status=0
for svc in lens track docs; do
  repo="ghcr.io/$owner/talyvor-$svc"
  sha=$(git ls-remote "https://github.com/$owner/talyvor-$svc.git" refs/heads/main 2>/dev/null | cut -f1)
  [ -z "$sha" ] && { printf '%-6s UNKNOWN  could not read main from GitHub\n' "$svc"; status=1; continue; }

  look() { # -> digest on stdout, or the token ABSENT / ERROR
    local out rc
    out=$(docker buildx imagetools inspect "$1" --format '{{.Manifest.Digest}}' 2>&1); rc=$?
    if [ $rc -eq 0 ]; then printf '%s' "$out"; return 0; fi
    case "$out" in *"not found"*|*"NAME_UNKNOWN"*|*"MANIFEST_UNKNOWN"*) printf 'ABSENT' ;; *) printf 'ERROR' ;; esac
  }
  bysha=$(look "${repo}:${sha}")
  latest=$(look "${repo}:latest")

  # Ask GitHub about work in flight before concluding anything about absence.
  # Thresholds are DERIVED from this repo's observed runs, not guessed: 11 of 12 recent
  # builds finished in 8.3-12.2 min, and ONE took 60.1 min and still SUCCEEDED. So a flat
  # "40 min = stuck" would have condemned a healthy build. Hence two bands.
  run=$(gh run list --repo "$owner/talyvor-$svc" --workflow images.yaml --limit 20 \
          --json headSha,status,createdAt \
          --jq "[.[] | select(.headSha==\"$sha\") | select(.status!=\"completed\")][0] // empty" 2>/dev/null)
  if [ -n "$run" ]; then
    started=$(printf '%s' "$run" | sed -n 's/.*"createdAt":"\([^"]*\)".*/\1/p')
    mins=$(( ( $(date +%s) - $(date -j -f '%Y-%m-%dT%H:%M:%SZ' "$started" +%s 2>/dev/null || date -d "$started" +%s) ) / 60 ))
    if   [ "$mins" -le 15 ]; then note="normal (8-13 min typical)"
    elif [ "$mins" -le 45 ]; then note="SLOW but one observed 60-min build succeeded — keep waiting"
    else note="STUCK: past anything observed in this repo. Check the run before deploying."; fi
    printf '%-6s BUILDING %s min elapsed — %s\n         wait; do not re-run and do not deploy :latest yet\n' "$svc" "$mins" "$note"
    status=1; continue
  fi

  case "$bysha:$latest" in
    ERROR:*|*:ERROR) v="UNKNOWN  registry lookup failed — retry; do NOT read this as a missing image" ; status=1 ;;
    ABSENT:*)
      # No image AND no run in flight. Is one even expected? images.yaml is path-filtered
      # (cmd/ internal/ migrations/ go.mod go.sum Dockerfile .github/workflows/images.yaml),
      # so a docs- or LICENSE-only merge legitimately produces nothing. Verified against this
      # repo's history: a41dd89, cc67661 and 6e78c37 have no image and needed none.
      # No image AND no run in flight. Is one even expected? images.yaml is path-filtered
      # (cmd/ internal/ migrations/ go.mod go.sum Dockerfile .github/workflows/images.yaml),
      # so a docs- or LICENSE-only merge legitimately produces nothing. Verified against this
      # repo's history: a41dd89, cc67661 and 6e78c37 have no image and needed none.
      #
      # Asked via the API, NOT a local checkout: this script runs on a workstation that has the
      # SUITE cloned (you build the BFF from it) and very likely not lens/track/docs. A check
      # that silently needs a checkout you do not have is the same class of failure it exists
      # to catch.
      # Capture the EXIT CODE, not just the output: a failed `gh api` prints an error object,
      # which is non-empty and would otherwise be read as "no watched paths" — i.e. as the
      # reassuring NO-BUILD verdict. An error is not data.
      if changed=$(gh api "repos/$owner/talyvor-$svc/commits/$sha" \
                     --jq '[.files[].filename] | join(" ")' 2>/dev/null); then :; else changed=""; fi
      if [ -z "$changed" ]; then
        v="UNKNOWN  no image, no run, and the commit's file list could not be read — check by hand"; status=1
      elif printf '%s' "$changed" | grep -qE '(^| )(cmd/|internal/|migrations/|go\.(mod|sum)|Dockerfile|\.github/workflows/images\.yaml)'; then
        v="MISSING  no image and no run in flight, but this commit DOES touch a watched path"; status=1
      else
        v="NO-BUILD no image expected — this commit touches no watched path; :latest correctly lags"
      fi ;;
    *:ABSENT)        v="MISSING  :sha exists but :latest is absent — re-run the image workflow"       ; status=1 ;;
    *) if [ "$bysha" = "$latest" ]; then v="OK"
       else v="STALE    :latest is a DIFFERENT build — deploy ${repo}@${bysha}, not :latest"; status=1; fi ;;
  esac
  printf '%-6s %s\n         main=%s  :sha=%s  :latest=%s\n' \
    "$svc" "$v" "${sha:0:12}" "${bysha:0:19}" "${latest:0:19}"
done
exit $status
