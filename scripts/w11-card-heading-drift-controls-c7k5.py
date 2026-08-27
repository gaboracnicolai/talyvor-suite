#!/usr/bin/env python3
"""
POSITIVE CONTROLS FOR THE CARD-HEADING HARNESS'S DERIVED PREDICTIONS (W1.1.21g, tab-c7k5).

⚠ THE DEFECT, AND IT IS THE DANGEROUS DIRECTION. At `1690e4f`, `w11-card-heading-controls.py`
scored **5 of 7 controls MISPREDICTED** — and the guard was catching everything it should. Nothing
was wrong with the product. W1.1.21c names this shape as #4 of its five: *a working guard that
looks broken is a guard somebody deletes*.

THREE INDEPENDENT CAUSES, each dated, none of them a product defect:

  1. `ADDRESSES` was a hand-written twelve. `CONSOLE_ROUTES` holds FOURTEEN (`/chat` #271,
     `/earnings` #273). Derived now.
  2. The file asserted "every address in the table has at least one [card header], which is why
     the whole sweep reds together". `CARD_HEADER_CENSUS` says `/billing/cancel` renders **0**,
     and so do `/chat` and `/earnings`. An address with no card header cannot red on a
     card-header mutation, so predicting it will is a misprediction this file manufactured.
     Derived now, from the census the test itself checks against the rendered product.
  3. Two guard STRENGTHENINGS this file predates: the `CENSUS` floor (`5c5fa86`, #256) and the
     populated fixture (`9b39741`, #277, W1.1.17b) which gave the over-correction count reach it
     did not have — `/api/lxc/balance` now answers and `Overview.tsx:83` renders a `MuNumeral`,
     so C3's mutation is visible where its own note says it could not be.

⚠⚠ WHY UPDATING PREDICTIONS TO MATCH OUTPUT IS NOT CIRCULAR HERE, AND IT IS A PROPERTY OF THE
HARNESS RATHER THAN A PROMISE: it scores on SET EQUALITY. A name added to `reds` that does not
actually red shows up as `only-predicted` and MISPREDICTS. So predictions cannot be loosened —
only made exact. What set equality CANNOT check is WHY a name reds, and that is what this file is
for: every control below removes a supposed CAUSE and requires the corresponding red to disappear.

  H1  pristine -> 6 caught, 1 inert as predicted, 0 mispredicted
  H2  both derivations reverted to the hand-written twelve -> C1 and C2 MISPREDICT again
  H3  the two facts C3's dated reason rests on still hold — a CLAIM CHECK, weaker than the
      isolation I wanted, and the comment says why the harness refused the isolation
  H4  the CENSUS floor's assertion blinded -> C5 and C6 MISPREDICT with only-predicted [CENSUS],
      so that name is carried by a real assertion rather than granted
  H5  vacuity — the census reader blinded to yield nothing -> it must REFUSE, not predict less
  H6  refusal — CONSOLE_ROUTES renamed -> RAISES by name

Every file is restored from saved bytes and sha256-verified in a finally.
"""
import hashlib
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HARNESS = ROOT / "scripts/w11-card-heading-controls.py"
APP = ROOT / "apps/web/src/App.tsx"
TEST = ROOT / "apps/web/src/CardHeaderHeading.test.tsx"
OVERVIEW = ROOT / "apps/web/src/areas/lens/Overview.tsx"

DERIVED_ADDR = "ADDRESSES = _console_addresses()"
DERIVED_ADDR_OFF = '''ADDRESSES = [
    "/", "/ledger", "/billing", "/billing/success", "/billing/cancel", "/keys", "/setup",
    "/spend", "/members", "/settings", "/track", "/docs",
]'''
DERIVED_SWEEP = ('SWEEP_WITH_HEADERS = [f"{a} renders every card header it has as a heading"\n'
                 '                      for a in _addresses_with_headers()]')
DERIVED_SWEEP_OFF = "SWEEP_WITH_HEADERS = SWEEP"
MU_RENDER = '<MuNumeral micros={q.data.balance_ulxc} unit="lxc" />'
MU_GONE = '<span className="text-body text-ink">{String(q.data.balance_ulxc)}</span>'
# ⚠ BLIND THE ASSERTION, NOT THE LOOP. Emptying `measured` would also trip the address-set
# comparison above it and red for a different reason, which would score H4 on the wrong failure.
CENSUS_ASSERT = "      ).toBe(CARD_HEADER_CENSUS[address])"
CENSUS_ASSERT_OFF = "      ).toBe(measured[address])"
CENSUS_READER = '    rows = re.findall(r"\'([^\']+)\':\\s*(\\d+)", m.group(1))'
CENSUS_READER_OFF = '    rows = []'
EXPORT_ANCHOR = "export const CONSOLE_ROUTES"
EXPORT_RENAMED = "export const CONSOLE_PAGES_C7K5"


def sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run() -> tuple[int, str]:
    r = subprocess.run([sys.executable, str(HARNESS)], cwd=ROOT,
                       capture_output=True, text=True, timeout=2400)
    return r.returncode, r.stdout + r.stderr


def verdicts(out: str) -> dict:
    """control id -> (verdict, only-predicted, only-actual), parsed from the blocks."""
    got, cid = {}, None
    for ln in out.split("\n"):
        m = re.match(r"^(C\d+)\s+(\S.*?)\s{2,}\(", ln)
        if m:
            cid = m.group(1)
            got[cid] = [m.group(2).strip(), [], []]
        elif cid and ln.strip().startswith("only-predicted:"):
            got[cid][1] = re.findall(r"'([^']*)'", ln)
        elif cid and ln.strip().startswith("only-actual"):
            got[cid][2] = re.findall(r"'([^']*)'", ln)
    return got


def tally(out: str) -> tuple[int, int, int]:
    m = re.search(r"(\d+) caught by the predicted set, (\d+) inert as predicted, "
                  r"(\d+) mispredicted", out)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else (-1, -1, -1)


def swap(path: pathlib.Path, old: str, new: str, cid: str) -> None:
    text = path.read_text(encoding="utf8")
    n = text.count(old)
    if n != 1:
        raise AssertionError(
            f"{cid}: the mutation anchor occurs {n} time(s) in {path.name}, expected exactly 1. "
            "This control has gone stale — it would otherwise change nothing and score a pass.")
    path.write_text(text.replace(old, new, 1), encoding="utf8")


def main() -> int:
    files = [HARNESS, APP, TEST, OVERVIEW]
    saved = {p: (p.read_bytes(), sha(p)) for p in files}
    results: list[tuple[str, bool, str]] = []

    def record(cid, ok, detail):
        results.append((cid, ok, detail))
        print(f"  {'OK  ' if ok else '*** FAILED ***'}  {cid}\n        {detail}")

    def restore():
        for p, (b, _s) in saved.items():
            p.write_bytes(b)

    try:
        _rc, out = run()
        t = tally(out)
        record("H1  pristine — the harness is whole again",
               t == (6, 1, 0), f"caught/inert/mispredicted = {t} (expected (6, 1, 0)); "
                               "5 of 7 mispredicted at 1690e4f against a working guard")

        # ── H2 the two derivations, reverted ──────────────────────────────────────────────────
        swap(HARNESS, DERIVED_ADDR, DERIVED_ADDR_OFF, "H2")
        swap(HARNESS, DERIVED_SWEEP, DERIVED_SWEEP_OFF, "H2")
        _rc, out = run()
        v = verdicts(out)
        back = [c for c in ("C1", "C2") if v.get(c, ["", [], []])[0] == "MISPREDICTED"
                and any("/billing/cancel" in x for x in v[c][1])]
        record("H2  derivations reverted -> C1 and C2 MISPREDICT on /billing/cancel again",
               len(back) == 2,
               f"{back} misspredict with /billing/cancel only-predicted (expected C1 and C2) — "
               "an address with no card header cannot red, and the old list said it would")
        restore()

        # ── H3 the two facts C3's recorded reason rests on ────────────────────────────────────
        # ⚠⚠ THIS IS A CLAIM CHECK, NOT THE EXPERIMENT I WANTED, AND THE DIFFERENCE IS RECORDED
        # RATHER THAN GLOSSED. The experiment was: remove the `MuNumeral` render from Overview and
        # require C3's over-correction red to DISAPPEAR, which would isolate the cause. THE
        # HARNESS REFUSED TO RUN IT — `w11-card-heading-controls.py` requires its BASELINE green
        # before scoring anything, and removing that render reds `/ renders every card header it
        # has as a heading` before any control is applied. That refusal is the harness working:
        # a campaign scored against a red baseline is noise, which is its own first line.
        #
        # ⚠ SO WHAT IS PINNED HERE IS WEAKER AND IT IS SAID SO: the two facts C3's comment rests
        # on. If `populatedBff` stops answering the balance, or Overview stops rendering a
        # `MuNumeral` from it, then the DATED REASON written into C3 is stale and this fails —
        # which is the point of writing a reason down as a claim rather than as prose. Isolating
        # the cause experimentally needs a treatment that leaves the card count untouched, and
        # that is not in this merge.
        fixture = (ROOT / "apps/web/src/populatedBff.ts").read_text(encoding="utf-8")
        overview = OVERVIEW.read_text(encoding="utf-8")
        serves_balance = "'/api/lxc/balance'" in fixture and "balance_ulxc" in fixture
        renders_mu = MU_RENDER in overview
        record("H3  C3's recorded reason is still TRUE (claim check, not isolation — see comment)",
               serves_balance and renders_mu,
               f"populatedBff serves /api/lxc/balance={serves_balance}, Overview renders "
               f"MuNumeral from balance_ulxc={renders_mu} — both must hold for C3's dated "
               "explanation (#277 populated the fixture) to be the reason it reds")

        # ── H4 the CENSUS name is carried by a real assertion ─────────────────────────────────
        swap(TEST, CENSUS_ASSERT, CENSUS_ASSERT_OFF, "H4")
        _rc, out = run()
        v = verdicts(out)
        lost = [c for c in ("C5", "C6")
                if v.get(c, ["", [], []])[0] == "MISPREDICTED"
                and any("the census is the number" in x for x in v[c][1])]
        record("H4  the CENSUS floor blinded -> C5 and C6 MISPREDICT with it only-predicted",
               len(lost) == 2,
               f"{lost} (expected C5 and C6) — the name was not granted, it is carried by an "
               "assertion that stops firing when blinded")
        restore()

        # ── H5 vacuity ────────────────────────────────────────────────────────────────────────
        swap(HARNESS, CENSUS_READER, CENSUS_READER_OFF, "H5")
        rc, out = run()
        record("H5  vacuity: the census reader yields nothing -> it must REFUSE, not predict less",
               rc != 0 and "floor is 12" in out,
               f"exit={rc}, floor fired={'floor is 12' in out} — a reader that quietly returned "
               "[] would predict an empty sweep and every control would get easier")
        restore()

        # ── H6 refusal ────────────────────────────────────────────────────────────────────────
        swap(APP, EXPORT_ANCHOR, EXPORT_RENAMED, "H6")
        rc, out = run()
        record("H6  CONSOLE_ROUTES renamed -> RAISES by name",
               rc != 0 and "could not be located" in out,
               f"exit={rc}, names the table={'could not be located' in out}")
        restore()
    finally:
        restore()
        clean = all(sha(p) == s for p, (_b, s) in saved.items())
        print(f"\n  all files restored, sha256-verified: {clean}")
        if not clean:
            results.append(("RESTORE", False, "a file did not restore byte-identically"))

    bad = [c for c, ok, _d in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} controls behaved as specified")
    if bad:
        print("NOT PROVEN: " + ", ".join(bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
