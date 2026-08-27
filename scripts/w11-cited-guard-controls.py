#!/usr/bin/env python3
"""Positive controls for the three guards added with cited_guard_test.go.

    python3 scripts/w11-cited-guard-controls.py

Two of the three PASSED ON THEIR FIRST RUN. That is the shape this queue has
shipped un-failable guards in three times, so each one is driven here against a
defect it is supposed to see, and the run must end `caught 10  survived 0`.

WHY EACH CONTROL NAMES THE TEST IT EXPECTS TO RED. A control scored on "the
suite went red" records a hole as covered whenever some OTHER test happens to
notice — which is exactly how a deletion once scored CAUGHT against a guard that
was blind to it. A control that reds the wrong test is MISATTRIBUTED here, and
that is a failure, not a pass.

K9 patches TWO files at once and that is not tidiness: patching only lens.go
points a route at a method that does not exist and the BUILD breaks, which is not
a verdict about the guard. A control that cannot compile has measured nothing.
"""
import pathlib
import re
import subprocess
import sys

BFF = pathlib.Path(__file__).resolve().parent.parent / "apps" / "bff"
LENS, SAME, CITED = BFF / "lens.go", BFF / "sameorigin_test.go", BFF / "cited_guard_test.go"
TENANT, OPERATOR, SPA = BFF / "tenant.go", BFF / "operator.go", BFF / "spa_fallback_test.go"

# (id, expected-test-to-red, description, [(file, old, new), …])
CONTROLS = [
    ("K1", "TestEveryCitedTestExists", "a comment names a test that does not exist", [
        (TENANT,
         "// Guarded by TestLensWorkspacePathBuiltInExactlyOnePlace: nothing else in this package may build",
         "// Guarded by TestSomethingNobodyEverWrote: nothing else in this package may build")]),

    ("K2", "TestEveryCitedTestExists",
     "a WRAPPED citation whose continuation makes no real name is still caught", [
         (SPA,
          "and TestClientRoutesStillFall\n// Back is what refuses it.",
          "and TestClientRoutesStillFall\n// Sideways is what refuses it.")]),

    ("K3", "TestCitedButGoneEntriesAreActuallyGone",
     "an exemption for a test that DOES exist (a stale suppression)", [
         (CITED,
          '"TestMembersProxiesPinnedTrackWorkspace": "keys_test.go records it as replaced when Track went " +',
          '"TestLogout_RefusesCrossOrigin": "x", "TestMembersProxiesPinnedTrackWorkspace": '
          '"keys_test.go records it as replaced when Track went " +')]),

    # ⚠ THIS ANCHOR QUOTES THE REASON STRING, so correcting that string breaks the control — and
    # the correction was made (the old reason claimed the docs_shared disclosure "cannot outlive
    # the pin it described"; it outlived it four times). The runner reports ANCHOR-MISS and exits
    # 1 rather than scoring an un-applied patch as a pass, which is the only reason this was
    # noticed at all. Re-anchored on the corrected text.
    ("K4", "TestCitedButGoneEntriesAreActuallyGone", "an exemption with no reason", [
        (CITED,
         '"TestAuthMeDocsSharedIsDerivedNotHardcoded": "track_tenant_test.go records its deletion as the point: " +\n'
         '\t\t"/auth/me no longer serves docs_shared, so a test asserting how it is derived would assert " +\n'
         '\t\t"nothing. The prose describing the field is NOT covered by that and had to be swept " +\n'
         '\t\t"separately — see apps/web/src/danglingClaimAudit.test.ts.",',
         '"TestAuthMeDocsSharedIsDerivedNotHardcoded": "",')]),

    ("K5", "TestCitedTestCensusFindsAPopulation",
     "the declaration scan reads nothing (the census would pass vacuously)", [
         (CITED,
          "testDeclRe = regexp.MustCompile(`(?m)^func (Test[A-Za-z0-9_]+)`)",
          "testDeclRe = regexp.MustCompile(`(?m)^func (ZzzNeverMatches[A-Za-z0-9_]+)`)")]),

    ("K6", "TestEveryMutatingRoute_IsGuardedOrExplicitlyExempt",
     "A NEW WRITE ROUTE IS MOUNTED WITH NO LINE IN THE SWEPT LIST", [
         (LENS,
          '\ta.mux.HandleFunc("/api/", a.requireSession(a.handleAPINotFound))',
          '\ta.mux.HandleFunc("/api/zzz-control", a.requireTenant(a.handlePoolingChoice))\n'
          '\ta.mux.HandleFunc("/api/", a.requireSession(a.handleAPINotFound))')]),

    # ⚠ K7 HAD BEEN APPLYING NOTHING, AND IT IS NOT A CONTROL THAT WENT WRONG — IT IS THE SHAPE
    # THE WHOLE FILE IS ABOUT, ONE LEVEL UP. The anchor quotes a route's REQUEST BODY verbatim,
    # and the convert route's field was renamed `lxc` → `lxc_amount_ulxc` in production source
    # with no reason for anyone to look here. From that commit on, K7 patched nothing, the suite
    # went green, and the run printed `invalid 1` — loudly, which is the only reason this was
    # caught. Found at 8ba994f by running the script, not by reading it. Re-anchored on the
    # method and path only: the body is not what the control is about, and quoting it again
    # would re-arm the same decay.
    ("K7", "TestEveryMutatingRoute_IsGuardedOrExplicitlyExempt",
     "a real write route is REMOVED from the swept list", [
         (SAME, '\t\t{method: http.MethodPost, path: "/api/lens/convert", body: `{"lxc_amount_ulxc":100000}`},\n', "")]),

    # ⚠ RE-AIMED 2026-08-27 (tab-j8w4), NOT DELETED, AND THE OLD ANCHOR IS WHY THIS COMMENT EXISTS.
    # It read `re := regexp.MustCompile(`a\.mux\.Handle(?:Func)?\("([^"]+)"`)` — the regex-over-
    # source-text that mountedPatterns USED to be. #274 replaced that with a real AST walk of the
    # package, which was the right repair and is recorded in the function's own docstring; the
    # anchor pointed at the deleted line from that moment and THIS CONTROL COULD NOT ARM. Nothing
    # noticed for the same reason twice over: nothing runs this harness, and the anchor check that
    # exists to catch exactly this could not READ this harness at all until the same day, because
    # its path constants are declared by TUPLE UNPACKING (`LENS, SAME, CITED = BFF / …`).
    # ⚠ The new anchor is the file filter inside mountedPatterns, and it was VERIFIED BY RUNNING
    # rather than by reading: `return false` there makes ParseDir see no file, and
    # TestEveryMutatingRoute_IsGuardedOrExplicitlyExempt fails with "mounted patterns found = 0,
    # want at least 20 — the route-table scan read almost nothing", which is this control's stated
    # intent word for word.
    ("K8", "TestEveryMutatingRoute_IsGuardedOrExplicitlyExempt",
     "the route-table scan reads nothing (the sweep would check no route)", [
         (SAME,
          '\t\treturn strings.HasSuffix(fi.Name(), ".go") && !strings.HasSuffix(fi.Name(), "_test.go")',
          '\t\treturn false')]),

    ("K9", "TestOperatorExemptionHoldsOnlyWhileAdminIsNotWired",
     "an exempted operator route is WIRED to a real handler (two files, so it BUILDS)", [
         (OPERATOR,
          "func (a *app) adminNotWired(w http.ResponseWriter, r *http.Request, _ session) {",
          "func (a *app) adminHeldMintsWired(w http.ResponseWriter, r *http.Request, s session) {\n"
          "\ta.adminNotWired(w, r, s)\n}\n\n"
          "func (a *app) adminNotWired(w http.ResponseWriter, r *http.Request, _ session) {"),
         (LENS,
          'a.mux.HandleFunc("/api/admin/held-mints", a.requireOperator(a.adminNotWired))',
          'a.mux.HandleFunc("/api/admin/held-mints", a.requireOperator(a.adminHeldMintsWired))')]),

    ("K10", "TestOperatorExemptionHoldsOnlyWhileAdminIsNotWired",
     "the operator scan stops seeing the operator surface", [
         (SAME,
          'admin := regexp.MustCompile(`a\\.mux\\.HandleFunc\\("(/api/admin/[^"]+)",\\s*a\\.requireOperator\\(([^)]*)\\)\\)`)',
          'admin := regexp.MustCompile(`a\\.zzz\\.HandleFunc\\("(/api/admin/[^"]+)",\\s*a\\.requireOperator\\(([^)]*)\\)\\)`)')]),
]


def main() -> int:
    files = {f for _, _, _, edits in CONTROLS for f, _, _ in edits}
    originals = {f: f.read_text(encoding="utf-8") for f in files}
    caught = misattributed = survived = invalid = 0
    try:
        for cid, expect, desc, edits in CONTROLS:
            ok = True
            for f, old, _ in edits:
                if originals[f].count(old) != 1:
                    print(f"{cid}: ANCHOR-MISS in {f.name} ({originals[f].count(old)}x) — {desc}")
                    ok = False
            if not ok:
                invalid += 1
                continue
            for f, old, new in edits:
                f.write_text(originals[f].replace(old, new, 1), encoding="utf-8")

            run = subprocess.run(["go", "test", "./..."], cwd=str(BFF), capture_output=True, text=True)
            fails = set(re.findall(r"--- FAIL: (\S+)", run.stdout))
            if "build failed" in run.stdout + run.stderr:
                invalid += 1
                print(f"{cid}: BUILD BROKE — the control measured nothing — {desc}")
            elif run.returncode == 0:
                survived += 1
                print(f"{cid}: *** SURVIVED — the guard cannot see this *** — {desc}")
            elif expect in fails:
                caught += 1
                extra = sorted(fails - {expect})
                print(f"{cid}: CAUGHT by {expect} — {desc}" + (f"  (+ also red: {', '.join(extra)})" if extra else ""))
            else:
                misattributed += 1
                print(f"{cid}: MISATTRIBUTED — expected {expect}, got {sorted(fails)} — {desc}")

            for f, _, _ in edits:
                f.write_text(originals[f], encoding="utf-8")
    finally:
        for f, src in originals.items():
            f.write_text(src, encoding="utf-8")

    print(f"\ncaught {caught}  misattributed {misattributed}  survived {survived}  invalid {invalid}  of {len(CONTROLS)}")
    return 0 if (caught == len(CONTROLS)) else 1


if __name__ == "__main__":
    sys.exit(main())
