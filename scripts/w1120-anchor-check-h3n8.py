#!/usr/bin/env python3
"""Which control anchors no longer match the tree — decided WITHOUT running anything.

A control that cannot arm is a guard that cannot fail, and today the only way to learn that is to
run the harness: each one drives the whole vitest suite once per control, the nine-harness sweep in
`65e2833` took ~35 minutes, and a full 74-harness sweep is hours. A check that expensive gets run
once by one session and then never again — which is exactly how six controls sat unarmable from at
least 11:31Z with the answer sitting in a log nobody re-read.

An ANCHOR MISS is decidable statically: the harness will splice `old` into `file`, so `old` must
occur there exactly `count` times. This reads the harnesses with `ast` and checks that, in seconds.

⚠⚠ THE FLOOR IS THE WHOLE DESIGN, BECAUSE THE FAILURE MODE IS SILENT. The harness formats are
heterogeneous — measured over all 74: `Control(...)` dataclasses, `dict(...)` entries, bare tuples,
`(PATH, [(anchor, n, repl)])` nested lists, module-level constants spliced in, and THIRTY-ONE files
matching none of those shapes, which this run names one by one. An extractor that
cannot read a harness finds ZERO anchors in it and therefore reports ZERO misses, WHICH LOOKS
EXACTLY LIKE A HEALTHY HARNESS. So this reports, per harness, how many anchors it extracted, and
treats "none" as a FAILURE OF THE CHECKER rather than a clean bill for the harness. 43 of 74 are
read today; the other 31 are UNANSWERED, and that is the honest size of this check.

⚠ WHAT THIS DOES NOT DO, said rather than implied: it decides only whether a control CAN ARM. It
says nothing about whether the guard then catches the defect — `press` C1 arms and does not catch,
and only a real run can find that. This narrows the expensive sweep; it does not replace it.
"""
from __future__ import annotations

import ast
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def harnesses() -> list[pathlib.Path]:
    out = [p for p in ROOT.rglob("w1*controls*.py")
           if "node_modules" not in p.parts and "anchor-check" not in p.name]
    return sorted(out)


class Extractor(ast.NodeVisitor):
    """Pulls (path, anchor, expected_count) triples out of one harness."""

    def __init__(self, src: str, home: pathlib.Path | None = None):
        self.consts: dict[str, str] = {}
        self.triples: list[tuple[str, str, int | None]] = []
        self.rejected: list[tuple[str, str, str]] = []
        self.ambiguous = 0
        self._seen: set[tuple[str, str, int | None]] = set()
        self.src = src
        self.home = home
        # Filled by _prescan: module-level constants that name a real file, and, per list NAME,
        # which tuple position a `for … in NAME:` unpacking calls the anchor.
        self.file_consts: list[str] = []
        self.anchor_index: dict[str, int] = {}
        self.edit_shapes: list[tuple[int, int, int | None]] = []
        self._prescan()

    # module-level `NAME = "…"` so an anchor held in a constant resolves
    def visit_Assign(self, node: ast.Assign) -> None:
        if len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            v = self._str(node.value)
            if v is not None:
                self.consts[name] = v
            # `CONTROLS = [(cid, what, old, new, …), …]` consumed by a for-loop that NAMES the
            # positions. The anchor's index comes from the unpacking, never from the strings.
            idx = self.anchor_index.get(name)
            if idx is not None and isinstance(node.value, (ast.List, ast.Tuple)):
                home = self._single_file()
                for elt in node.value.elts:
                    if not isinstance(elt, ast.Tuple) or len(elt.elts) <= idx:
                        continue
                    path = next((self._str(e) for e in elt.elts
                                 if (t := self._str(e)) and resolve(t, self.home) is not None), home)
                    self._record(path, self._str(elt.elts[idx]), None)
        self.generic_visit(node)

    # A control that names NO file is not undecidable — the harness usually names it once, at
    # module level, and the FOR-LOOP that consumes the controls names which position is the anchor.
    ANCHOR_NAMES = frozenset({"old", "find", "anchor"})
    PATH_NAMES = frozenset({"path", "file", "target", "f"})

    def _prescan(self) -> None:
        """Two facts only the WHOLE module can answer, gathered before the walk.

        ⚠ THE TEMPTING VERSION OF THIS IS CIRCULAR AND IS NOT WHAT THIS DOES. "Take whichever
        string in the control occurs in the file" would extract only anchors that already match,
        and a checker that can never report a miss is the exact failure this whole file exists to
        catch. Nothing here looks at a string's CONTENTS to decide whether it is an anchor: the
        position comes from the unpacking `for cid, what, old, new, expect in CONTROLS:`, and the
        file comes from the module having exactly ONE constant that names one.
        """
        try:
            tree = ast.parse(self.src)
        except SyntaxError:
            return
        seen: list[str] = []
        for node in tree.body:
            if not isinstance(node, ast.Assign) or len(node.targets) != 1:
                continue
            if not isinstance(node.targets[0], ast.Name):
                continue
            v = self._str(node.value)
            if v is None:
                continue
            self.consts.setdefault(node.targets[0].id, v)
            if resolve(v, self.home) is not None and v not in seen:
                seen.append(v)
        self.file_consts = seen
        for node in ast.walk(tree):
            if not isinstance(node, ast.For) or not isinstance(node.target, ast.Tuple):
                continue
            names = [e.id if isinstance(e, ast.Name) else "" for e in node.target.elts]
            idx = next((i for i, n in enumerate(names) if n in self.ANCHOR_NAMES), None)
            if idx is None:
                continue
            # ⚠ THE EDIT LIST IS ONE LEVEL DEEPER THAN THE CONTROL, and it is where five of the
            # remaining harnesses keep their anchors: `for old, new in edits`,
            # `for path, find, repl in edits`, `for f, old, _ in edits`. The loop names the
            # positions INSIDE each edit tuple, so the shape is (arity, anchor, path?) — and ARITY
            # is the bound that stops it being applied to every list of tuples in the file.
            pidx = next((i for i, n in enumerate(names) if n in self.PATH_NAMES), None)
            self.edit_shapes.append((len(names), idx, pidx))
            if isinstance(node.iter, ast.Name):
                self.anchor_index[node.iter.id] = idx

    def _single_file(self) -> str | None:
        """The one file this harness edits, or nothing. EXACTLY one — with two, attributing an
        anchor to either is a guess, and a guess here is a false miss reported against a harness
        that is fine."""
        return self.file_consts[0] if len(self.file_consts) == 1 else None

    def _str(self, node: ast.AST | None) -> str | None:
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        if isinstance(node, ast.Name) and node.id in self.consts:
            return self.consts[node.id]
        # "a" "b" implicit concatenation arrives as a single Constant; f-strings are skipped on
        # purpose — an interpolated anchor is not statically decidable and must not be guessed at.
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            a, b = self._str(node.left), self._str(node.right)
            if a is not None and b is not None:
                return a + b
        # ⚠ `ROOT / "apps/web/src/…"` — a pathlib expression, and the commonest way these harnesses
        # name a file. The first version of this checker read only plain strings and reported 49 of
        # 74 harnesses as UNREADABLE; the floor is what turned that into a visible number instead of
        # a clean bill. Only the right-hand string is taken: the left is a directory the caller
        # already resolves, and `resolve()` below tries each root anyway.
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
            # ⚠ JOIN, DO NOT DISCARD THE LEFT. Returning only the right side reads `UI /
            # "vitest.config.ts"` as bare "vitest.config.ts" — and that file exists in BOTH
            # packages, so it silently resolved onto apps/web's and reported a miss against a file
            # the harness never touches. The anchor was present the whole time. `ROOT` is a
            # `Path(__file__).parents[n]` expression that resolves to nothing, which is correct:
            # nothing means repo-relative.
            b = self._str(node.right)
            if b is not None:
                a = self._str(node.left)
                return f"{a.rstrip('/')}/{b}" if a else b
        # Path("…") / pathlib.Path("…")
        if isinstance(node, ast.Call) and len(node.args) == 1:
            fn = node.func
            name = fn.id if isinstance(fn, ast.Name) else (fn.attr if isinstance(fn, ast.Attribute) else "")
            if name in ("Path", "resolve", "str"):
                return self._str(node.args[0])
        return None

    def _num(self, node: ast.AST | None) -> int | None:
        if isinstance(node, ast.Constant) and isinstance(node.value, int):
            return node.value
        return None

    # ⚠ THE TWO REJECTIONS BELOW WERE NOT GUESSED — each was a FALSE MISS this checker reported
    # against a harness already KNOWN GOOD, and a checker that cries wolf on a repaired harness is
    # worse than none: it teaches the reader to skim the list. Both are counted and printed.
    SENTINEL = re.compile(r"^[A-Z][A-Z0-9_]{3,}$")

    def _record(self, path: str | None, anchor: str | None, count: int | None) -> None:
        if not path or not anchor:
            return
        if len(anchor) < 8:  # too short to be a source anchor; a mode flag or a label
            self.rejected.append((path, anchor, "shorter than 8 chars"))
            return
        # A COMPANION FILE, NOT SOURCE TEXT. Many harnesses carry (target, companion) file pairs;
        # read as (file, anchor) that asks whether Overview.test.tsx contains the literal string
        # "src/glyphAudit.test.tsx" — permanently false, and it named six repaired harnesses.
        # …but NOT a relative import specifier: `'./scripts/reach-global-setup.ts'` both resolves
        # to a real file AND is text a harness legitimately splices. Rejecting those would eat a
        # real anchor silently — which is the exact failure this whole check exists to catch.
        if not anchor.startswith(("./", "../", "@/")) and resolve(anchor, self.home) is not None:
            self.rejected.append((path, anchor, "anchor is itself a file in the tree"))
            return
        # A DSL ESCAPE HATCH. `(UI_TEST, "DELETE_ONE_IT", "")` never reaches a splice — the harness
        # tests `if find == "DELETE_ONE_IT"` and does something else entirely.
        if self.SENTINEL.match(anchor):
            self.rejected.append((path, anchor, "harness directive, not spliced text"))
            return
        # ⚠ DEDUPE. The specific shapes and the after-the-path rule both find most pairs, and
        # without this the same stale anchor is REPORTED TWICE — 10 real misses read as 21, which
        # overstates the finding and would have been read as the widening discovering more.
        if (path, anchor, count) in self._seen:
            return
        self._seen.add((path, anchor, count))
        self.triples.append((path, anchor, count))

    def _after_the_path(self, elts: list[ast.AST]) -> None:
        """THE ONE RULE THAT COVERS EVERY DSL HERE: the anchor is the element right after the one
        that names a file.

        Measured across the harnesses, not assumed: `Edit(FILE, old, new)`, `(FILE, old, new, n)`,
        `file=…, old=…`, and `Control("C1", "desc", APP, HEADING_LINE, replacement, message)` all
        put the anchor immediately after the path. ⚠ AND THE LOOSER RULE IS WRONG: pairing the path
        with EVERY string in the node would take the description, the REPLACEMENT and the expected
        message too — and a replacement is by definition text that is NOT in the file, so each one
        would be reported as a miss forever.

        ⚠ EXACTLY ONE path per node, or nothing. Two paths in one node is a (target, companion)
        pair, and reading those as (file, anchor) is what made 29 of the first 31 reported misses
        false — asking whether Overview.test.tsx contains the string "src/glyphAudit.test.tsx".
        """
        hits = [i for i, e in enumerate(elts)
                if (v := self._str(e)) and resolve(v, self.home) is not None]
        if len(hits) != 1:
            if len(hits) > 1:
                self.ambiguous += 1
            return
        i = hits[0]
        if i + 1 >= len(elts):
            return
        path = self._str(elts[i])
        # ⚠ THE ELEMENT AFTER THE PATH IS SOMETIMES A LIST OF (old, new) PAIRS, NOT THE ANCHOR
        # ITSELF — `edit(CONVERT, [(old, new), …], [1])`. visit_Tuple already reads that shape when
        # the path and the list are a 2-TUPLE; as CALL ARGUMENTS it fell through `_str`, which
        # returns None for a List, and the harness read as UNREADABLE with every anchor sitting
        # there in plain source.
        after = elts[i + 1]
        if isinstance(after, (ast.List, ast.Tuple)) and after.elts:
            inners = [e for e in after.elts if isinstance(e, ast.Tuple) and e.elts]
            if inners:
                for inner in inners:
                    self._record(path, self._str(inner.elts[0]),
                                 self._num(inner.elts[1]) if len(inner.elts) > 1 else None)
                return
        self._record(path, self._str(after),
                     self._num(elts[i + 2]) if i + 2 < len(elts) else None)

    def visit_Call(self, node: ast.Call) -> None:
        kw = {k.arg: k.value for k in node.keywords if k.arg}
        # keyword form: file=…, old=…, new=…
        if "old" in kw and ("file" in kw or "path" in kw):
            self._record(self._str(kw.get("file") or kw.get("path")), self._str(kw["old"]),
                         self._num(kw.get("count")) if "count" in kw else None)
        # positional form: Edit(FILE, old, new) / (FILE, old, new[, n])
        if len(node.args) >= 2:
            self._record(self._str(node.args[0]), self._str(node.args[1]),
                         self._num(node.args[2]) if len(node.args) > 2 else None)
        self._after_the_path(list(node.args))
        self.generic_visit(node)

    def visit_List(self, node: ast.List) -> None:
        """A list of EDIT TUPLES, read through the shape its own for-loop declared.

        ⚠ ARITY IS THE BOUND, and it is doing real work: without it this rule would be applied to
        every list of tuples in the harness — the reds tables, the expected-title lists — and each
        would be asked whether some string of theirs is in a file. With it, a `for path, find, repl
        in edits` loop only ever reads 3-tuples.

        ⚠ AND WITH NO PATH POSITION THE RULE IS DELIBERATELY WEAKER, NOT GUESSIER: it falls back to
        the harness's single file constant, which returns nothing when the harness names two. A
        harness that edits two files and does not say which per edit is not decidable here, and
        reporting it as UNREADABLE is the honest answer.
        """
        if self.edit_shapes and node.elts:
            tups = [e for e in node.elts if isinstance(e, ast.Tuple)]
            if tups and len(tups) == len(node.elts):
                arity = len(tups[0].elts)
                if all(len(t.elts) == arity for t in tups):
                    for n, aidx, pidx in self.edit_shapes:
                        if n != arity or aidx >= arity:
                            continue
                        for t in tups:
                            path = (self._str(t.elts[pidx]) if pidx is not None and pidx < arity
                                    else self._single_file())
                            self._record(path, self._str(t.elts[aidx]), None)
                        break
        self.generic_visit(node)

    def visit_Dict(self, node: ast.Dict) -> None:
        """A control written as a DICT LITERAL — `{"id": …, "file": CARD, "find": …, "repl": …}`.

        ⚠ THE SAME RULE, NOT A NEW ONE: the anchor is the value right after the one that names a
        file, read in source order, which is exactly what `_after_the_path` already decides for
        call arguments and tuples. Reusing it is deliberate — it inherits the one-path-per-node
        guard, the replacement-is-not-an-anchor argument and both rejections, so this widening
        cannot introduce a false-miss shape those were bought to prevent.

        ⚠ AND THE KEYS ARE NOT MATCHED BY NAME. `"file"`/`"find"` is what two harnesses happen to
        call them; keying on those spellings would read those two and silently miss the next
        harness that says `"target"`/`"anchor"`. Whether a value RESOLVES to a file in the tree is
        the same question the rest of this extractor asks, and it does not care what the key is
        called.
        """
        before = len(self.triples)
        self._after_the_path(list(node.values))
        # ⚠ A CONTROL DICT THAT NAMES NO FILE. `{"id":…, "what":…, "old":…, "new":…}` — the file is
        # the harness's single module-level constant, and the KEY says which value is the anchor.
        # Only when `_after_the_path` found nothing, so a dict that does name its file keeps the
        # stronger rule.
        if len(self.triples) == before:
            keys = [k.value if isinstance(k, ast.Constant) else None for k in node.keys]
            for k, v in zip(keys, node.values):
                if isinstance(k, str) and k in self.ANCHOR_NAMES:
                    self._record(self._single_file(), self._str(v), None)
                    break
        self.generic_visit(node)

    def visit_Tuple(self, node: ast.Tuple) -> None:
        # `edits=[(PATH, [(anchor, count, replacement), …])]` — a path paired with a LIST. Five
        # harnesses use it, `press` among them, and the both-ways control is what named it: press
        # read UNREADABLE at both commits while the other eight reproduced their repair.
        if len(node.elts) == 2 and isinstance(node.elts[1], ast.List):
            path = self._str(node.elts[0])
            for inner in node.elts[1].elts:
                if isinstance(inner, ast.Tuple) and inner.elts:
                    self._record(path, self._str(inner.elts[0]),
                                 self._num(inner.elts[1]) if len(inner.elts) > 1 else None)
            self.generic_visit(node)
            return
        self._after_the_path(list(node.elts))
        if len(node.elts) >= 2:
            p, a = self._str(node.elts[0]), self._str(node.elts[1])
            n = self._num(node.elts[2]) if len(node.elts) > 2 else None
            if len(node.elts) > 3 and n is None:
                n = self._num(node.elts[3])
            self._record(p, a, n)
        self.generic_visit(node)


def package_root(h: pathlib.Path) -> pathlib.Path:
    """The nearest ancestor of a harness holding a package.json — the root ITS paths are relative to."""
    for d in h.parents:
        if (d / "package.json").is_file():
            return d
        if d == ROOT:
            break
    return ROOT


def resolve(path: str, home: pathlib.Path | None = None) -> pathlib.Path | None:
    """A harness names files repo-relative or package-relative; try both.

    ⚠ `home` FIRST AND IT IS NOT COSMETIC: `vitest.config.ts` exists in BOTH apps/web and
    packages/ui. A fixed global order sent packages/ui's theme-storage harness to apps/web's
    config and reported a miss against a file that harness never touches.
    """
    # This is also asked of ANCHORS (is this "path" actually a file?), and an anchor is often a
    # multi-line block, so reject non-path shapes before touching the filesystem — os.stat raises
    # ENAMETOOLONG rather than returning False.
    if not path or "\n" in path or len(path) > 200:
        return None
    roots = [ROOT, ROOT / "apps/web", ROOT / "packages/ui"]
    if home is not None and home in roots:
        roots.remove(home)
    cands = ([home / path] if home is not None else []) + [r / path for r in roots]
    # ⚠ A PATH THAT STILL CARRIES THE REPO'S OWN NAME. Several harnesses anchor at
    # `ROOT = pathlib.Path.home() / "talyvor-suite"`, and `_str` cannot evaluate `Path.home()` — so
    # its Div join yields `talyvor-suite/apps/web/src/…`, which resolves under no root and made the
    # whole harness read UNREADABLE with every anchor sitting in plain source. Stripping the leading
    # segment ONLY when it equals this repo's directory name is exact; adding `ROOT.parent` to the
    # roots instead would let a bare `src/x` resolve to a sibling checkout outside this repo.
    if path.startswith(ROOT.name + "/"):
        cands.append(ROOT / path[len(ROOT.name) + 1:])
    for cand in cands:
        try:
            if cand.is_file():
                return cand
        except OSError:
            return None
    return None


# ⚠ MEASURED AT 74 ON 2ed28a1, AND THE FLOOR IS HERE BECAUSE THE FIRST DRAFT DID NOT HAVE ONE:
# blind the glob below and this file printed `harnesses: 0`, no misses, no unreadable, and EXITED
# 0 — a clean bill of health from a check that opened nothing. Its own control found that, not a
# reading of it. A census with no floor reports perfect health on an empty population.
MIN_HARNESSES = 70


def main() -> int:
    found = len(harnesses())
    if found < MIN_HARNESSES:
        print(f"⚠ THE HARNESS CENSUS COLLAPSED: {found} found, floor is {MIN_HARNESSES} "
              f"(74 at 2ed28a1). Every verdict below is drawn from a population this small.")
        return 1

    unreadable: list[str] = []
    misses: list[str] = []
    checked = 0
    rejected: dict[str, int] = {}
    ambiguous = 0

    for h in harnesses():
        rel = str(h.relative_to(ROOT))
        try:
            home = package_root(h)
            ex = Extractor(h.read_text(), home)
            ex.visit(ast.parse(h.read_text()))
        except SyntaxError as e:
            unreadable.append(f"{rel}: does not parse ({e})")
            continue

        ambiguous += ex.ambiguous
        for _p, _a, why in ex.rejected:
            rejected[why] = rejected.get(why, 0) + 1
        # only triples whose PATH resolves to a real file are anchors this check can decide
        decidable = [(p, a, n) for (p, a, n) in ex.triples if resolve(p, home)]
        if not decidable:
            unreadable.append(f"{rel}: 0 anchors extracted")
            continue

        for path, anchor, want in decidable:
            f = resolve(path, home)
            assert f is not None
            got = f.read_text().count(anchor)
            checked += 1
            if want is None:
                if got == 0:
                    misses.append(f"{rel}\n    {path}: anchor absent\n    {anchor[:70]!r}")
            elif got != want:
                misses.append(f"{rel}\n    {path}: found {got}, harness expects {want}\n    {anchor[:70]!r}")

    print(f"harnesses: {len(harnesses())}   anchors decided: {checked}")
    # ⚠ SAID, NOT HIDDEN: what the extractor pulled out and then declined to check. A rejection
    # rule is how a checker goes quietly blind, so the count is on the face of every run.
    for why, n in sorted(rejected.items()):
        print(f"  candidates rejected — {why}: {n}")
    if ambiguous:
        # ⚠ COUNTED OUT LOUD. These are nodes naming TWO OR MORE files, where "the element after
        # the path" has no single answer. Skipping them is right; skipping them SILENTLY is how a
        # checker's reach quietly shrinks while its output keeps looking the same.
        print(f"  nodes skipped — more than one file named, no unambiguous anchor: {ambiguous}")
    print()
    if unreadable:
        print(f"⚠ THE CHECKER COULD NOT READ {len(unreadable)} HARNESS(ES). Each is a harness this")
        print("  check says NOTHING about — not a clean one. Widen the extractor or run them.")
        for u in unreadable:
            print(f"  {u}")
        print()
    if misses:
        print(f"⚠ {len(misses)} ANCHOR(S) NO LONGER MATCH THE TREE — each is a control that cannot arm:")
        for m in misses:
            print(f"  {m}")
    else:
        print("every decidable anchor matches the tree")

    # ⚠ BOTH ARE FAILURES, and the unreadable one is the one that would otherwise pass quietly.
    return 1 if (misses or unreadable) else 0


if __name__ == "__main__":
    sys.exit(main())
