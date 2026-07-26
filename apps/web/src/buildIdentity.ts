// The web half of the version surface: what commit built this bundle, and whether it was stamped
// at all.
//
// WHY THE WEB NEEDS ITS OWN, RATHER THAN ASKING THE BFF. The two are shipped by two separate
// operations against the same host — `scp` the binary and restart the service, `rsync` the bundle
// directory (deploy/README.md step 3b) — so either can be replaced without the other. A bundle
// that learned its version from /api/version would report the BFF's commit, which is exactly the
// value that can be wrong. The number has to come from the web's own build or it proves nothing.
//
// ── WHY THIS MODULE IS PURE ──────────────────────────────────────────────────
//
// It reads no environment: every function takes the raw stamp as an argument. That is what lets
// the SAME placeholder and the SAME classification rule be used from two different runtimes —
// vite.config.ts (Node, reads process.env.SUITE_COMMIT) and, if a UI surface ever wants it, the
// browser. Put an `import.meta.env` read in here and the config-side import breaks, because
// `import.meta.env` does not exist when vite is loading its own config.
//
// ⚠ THE DEFAULT IS "dev" AND THAT IS THE POINT. A placeholder that looks like a version is worse
// than one that admits it: "dev" is checkable, "0.1.0" is not. apps/web/package.json carried
// "0.1.0" from the first commit until this change — never right, never wrong, never read by
// anything. That field is now removed rather than left to be mistaken for a build identity.
//
// Nothing here can check that the stamp was APPLIED — a unit test cannot see whether the build
// step ran. scripts/build-release.sh and CI's web job assert that against dist/version.json.

/** The value a commit stamp has when nothing set it. Kept identical to the BFF's
 *  `unstampedPlaceholder` (apps/bff/version.go); buildIdentity.test.ts pins the two together,
 *  because the BFF classifies the bundle's version.json and a drifted placeholder would make it
 *  report a mismatch against a commit that does not exist. */
export const UNSTAMPED = 'dev'

/** The environment variable the build reads. No `VITE_` prefix on purpose: it is a build-time
 *  input to the emitted artifacts, not a value published into the client env object. */
export const COMMIT_ENV_VAR = 'SUITE_COMMIT'

/** Build identity. `commit` is ABSENT rather than empty when unstamped — same contract as the
 *  BFF's binaryVersion, so `jq .commit` yields null instead of the string "dev". */
export type BuildIdentity = {
  commit?: string
  stamped: boolean
  note?: string
}

/** describeBuild classifies a raw stamp value. Undefined, empty, whitespace and the placeholder
 *  all mean UNSTAMPED: none of them identifies a commit, and reporting any of them as one would
 *  be the defect this surface replaces. */
export function describeBuild(raw: string | undefined): BuildIdentity {
  const commit = (raw ?? '').trim()
  if (commit === '' || commit === UNSTAMPED) {
    return {
      stamped: false,
      note:
        `this bundle carries no commit stamp (${COMMIT_ENV_VAR} was unset at build time), so ` +
        `which commit produced the app being served cannot be determined — build with ` +
        `scripts/build-release.sh, which sets it`,
    }
  }
  return { commit, stamped: true }
}

/** The payload written to dist/version.json.
 *
 *  ⚠ `service` is present so this cannot be confused with the BFF's /api/version payload. An
 *  operator reads both within seconds of each other during a deploy, and two unlabelled JSON
 *  blobs with the same field names is how you end up comparing a value with itself. */
export function bundleVersionPayload(raw: string | undefined): BuildIdentity & { service: 'web' } {
  return { service: 'web', ...describeBuild(raw) }
}
