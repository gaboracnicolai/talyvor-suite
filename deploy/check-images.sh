#!/usr/bin/env bash
# Does a published image exist for each service's CURRENT main, and does :latest point at it?
# Four verdicts, because three of them need different responses:
#   OK       — :sha exists and :latest is the same image. Deploy.
#   MISSING  — no image was ever published for this commit. Re-run the image workflow.
#   STALE    — an image exists for this commit but :latest is a DIFFERENT build
#              (a re-run pushed an older commit over it). Deploy by digest, not :latest.
#   UNKNOWN  — the registry lookup itself failed (network/auth/rate limit). NOT the same as
#              MISSING: treating a hiccup as "no image" is how you re-run a build you already have.
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

  case "$bysha:$latest" in
    ERROR:*|*:ERROR) v="UNKNOWN  registry lookup failed — retry; do NOT read this as a missing image" ; status=1 ;;
    ABSENT:*)        v="MISSING  no image published for this commit — re-run the image workflow"      ; status=1 ;;
    *:ABSENT)        v="MISSING  :sha exists but :latest is absent — re-run the image workflow"       ; status=1 ;;
    *) if [ "$bysha" = "$latest" ]; then v="OK"
       else v="STALE    :latest is a DIFFERENT build — deploy ${repo}@${bysha}, not :latest"; status=1; fi ;;
  esac
  printf '%-6s %s\n         main=%s  :sha=%s  :latest=%s\n' \
    "$svc" "$v" "${sha:0:12}" "${bysha:0:19}" "${latest:0:19}"
done
exit $status
