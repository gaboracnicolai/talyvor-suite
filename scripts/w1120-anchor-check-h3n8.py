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


#: files matching the glob that are controls FOR this checker, with why each was excluded.
_self_excluded: list[tuple[str, str]] = []


def _is_control_for_this_checker(p: pathlib.Path) -> bool:
    """Does this file RUN the checker, as opposed to mentioning it?

    ⚠ THE NAMING CONVENTION WAS THE WHOLE PROTECTION AND IT DOES NOT HOLD. The glob is
    `w1*controls*.py`, so a control written FOR this checker is counted as one of the harnesses it
    checks — the instrument measuring itself, in the direction that looks like progress. That is
    recorded in W1.1.21d's own history (census 74 → 75, anchors 501 → 504) and the fix was to
    exclude the substring `anchor-check` from the name. **It happened AGAIN on 2026-08-27, to a
    tab that had read the warning**: a new control named `w1121d-write-target-controls-j8w4.py`
    pushed the census to 75 and its own baseline read `unreadable=8` where the tree had 7. A
    convention nothing enforces is a comment.

    ⚠ SO THE TEST IS WHAT THE FILE DOES, NOT WHAT IT IS CALLED — and the discriminator is exact
    rather than a substring search, which was MEASURED: `w11-uppercase-count-controls.py` names
    this checker too, in a COMMENT ("`…anchor-check…` is what noticed; nothing else did"), and it
    is a real harness whose anchors must keep being checked. A control RUNS the checker, so it
    carries the path as a STRING CONSTANT. Excluding on the raw text would have dropped a genuine
    harness from the census — the direction that looks like nothing happened.
    """
    try:
        tree = ast.parse(p.read_text())
    except (SyntaxError, OSError):
        return False
    return any(isinstance(n, ast.Constant) and isinstance(n.value, str) and CHECKER_STEM in n.value
               for n in ast.walk(tree))


CHECKER_STEM = "w1120-anchor-check"

#: the `re` functions that SPLICE. Inspecting with re.search says nothing about the anchor's
#: shape — a harness can match on a regex and still splice literally — but a harness that
#: REPLACES with re.sub has, by construction, written its anchor as a pattern.
RE_SPLICE = frozenset({"sub", "subn"})


def why_unreadable(ex: "Extractor") -> str:
    """WHICH HALF IS MISSING — derived from the extractor's own state, never hardcoded per file.

    ⚠ THE LIST THIS FEEDS USED TO SAY ONLY "Widen the extractor or run them", AND THAT SENTENCE IS
    WRONG FOR MOST OF WHAT IS ON IT. Deciding an anchor needs TWO halves: a FILE to look in and a
    SHAPE that says which string is the anchor. A harness missing the file half cannot be reached
    by any vocabulary widening, and a harness missing the shape half will not be helped by teaching
    `_str` another path expression — but the old output described both the same way, so every tab
    working this item had to instrument this file by hand to find out which. Three tabs did.

    ⚠⚠ AND THE MISREADING IS NOT FREE: acting on "widen the extractor" against a harness whose
    anchors are regexes produced 14 false misses on a font-identity guard (see regex_spliced_names,
    and W1.1.21d's record of it). Naming the missing half is what stops the next tab widening
    toward a wall — or worse, through one.

    ⚠ DERIVED, NOT LISTED. A hardcoded set of filenames would keep excusing a harness after
    somebody made it readable, which is the same stale-in-the-flattering-direction defect this
    check exists to catch. Every clause below reads state the extractor computed on this run.
    """
    files = len(ex.file_consts)
    shaped = bool(ex.edit_shapes or ex.anchor_index)
    single = ex._single_file()
    if files == 0:
        if shaped:
            return ("NO FILE HALF — an anchor shape WAS matched, so the positions are known and "
                    "the file is not: no module-level constant resolves to a file here. Widening "
                    "the anchor vocabulary cannot help. Look at how this harness names its paths")
        return ("NEITHER HALF — no module-level constant resolves to a file here, and no anchor "
                "shape matched. Anchors built at runtime look exactly like this and are not a gap "
                "to close; check that before widening anything")
    if single is None:
        return (f"NO FILE HALF — {files} constants resolve to files and none is attributable: not "
                "one file, and no single write target either, and no edit carries its own path. "
                + ("A shape IS matched, so a per-edit path is the missing piece"
                   if shaped else "No shape is matched either"))
    return (f"NO SHAPE HALF — the file is known ({single}) and nothing says which string is the "
            "anchor: no `for … in <edits>` unpacking names a position in ANCHOR_NAMES, no dict key "
            "is one, and no node pairs a path with the element after it")


def regex_spliced_names(tree: ast.AST) -> list[str]:
    """Loop variables this harness feeds to `re.sub` as the PATTERN.

    ⚠ THIS IS A GUARD AGAINST A WIDENING, AND THE WIDENING IS THE OBVIOUS NEXT MOVE. `w11-face-
    identity` reads UNREADABLE, and the two things standing in the way each look like a plain gap:
    `_str` cannot evaluate `os.path.join(ROOT, 'packages/ui/src/theme.css')`, and its edit tuples
    call the anchor `pattern`, which is not in ANCHOR_NAMES. Teaching `_str` about `os.path.join`
    and adding `pattern` to the vocabulary are each locally reasonable, and MEASURED TOGETHER they
    take the census to 550 anchors and 5 unreadable — it reads as progress — while manufacturing
    **14 misses, every one against packages/ui/src/theme.css, every one a REGEX** whose `\\(` and
    `\\.` escapes can never appear literally in a CSS file. The anchors are all present and the
    harness's own `re.findall` assertion passes on every one. A tab reading that output would go
    and "repair" fourteen working anchors in a font-identity guard.

    ⚠⚠ SO THIS IS NOT A LABEL, IT IS A REFUSAL. Extraction for such a harness is DISCARDED even if
    a future vocabulary would reach it, and the harness is reported in its own bucket rather than
    under "widen the extractor" — because widening is precisely the wrong answer here. This check
    compares with `str.count`; an anchor that is a pattern is not a thing it can decide, and the
    harness already asserts its own anchor counts with `re.findall`, which is the stronger check.

    ⚠ NARROWED TO `re.sub` DELIBERATELY, AND THE WIDER VERSION WAS MEASURED AND REJECTED. Keying on
    any `re.*` call also flags `w17-keysweep-per-route`, which uses `re.search(expect, f)` on test
    OUTPUT while splicing literally — it has 3 decided anchors today, and flagging it would delete
    real coverage in the direction that looks like nothing happened.
    """
    patterns = set()
    for n in ast.walk(tree):
        if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                and isinstance(n.func.value, ast.Name) and n.func.value.id == "re"
                and n.func.attr in RE_SPLICE and n.args and isinstance(n.args[0], ast.Name)):
            patterns.add(n.args[0].id)
    if not patterns:
        return []
    out = []
    for n in ast.walk(tree):
        if isinstance(n, ast.For) and isinstance(n.target, ast.Tuple):
            for e in n.target.elts:
                if isinstance(e, ast.Name) and e.id in patterns and e.id not in out:
                    out.append(e.id)
    return out


def harnesses() -> list[pathlib.Path]:
    _self_excluded.clear()
    out = []
    for p in sorted(ROOT.rglob("w1*controls*.py")):
        if "node_modules" in p.parts:
            continue
        if CHECKER_STEM in p.name or "anchor-check" in p.name:
            _self_excluded.append((p.name, "named as a control for this checker"))
            continue
        if _is_control_for_this_checker(p):
            _self_excluded.append((p.name, "RUNS this checker — a control for it, not a harness it checks"))
            continue
        out.append(p)
    return out


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
        self._tree: ast.AST = ast.Module(body=[], type_ignores=[])
        self.written_file: str | None = None
        self.counted_names: set[str] = set()
        self._prescan()

    @staticmethod
    def _bindings(node: ast.Assign) -> list[tuple[str, ast.AST]]:
        """The (name, value) pairs this assignment binds — including a TUPLE UNPACKING.

        ⚠ `LENS, SAME, CITED = BFF / "lens.go", BFF / "…", BFF / "…"` BOUND NOTHING HERE, because
        both readers required `targets[0]` to be a Name and this one is a Tuple. `w11-cited-guard`
        declares every path it edits on exactly two such lines, so it had `BFF` and nothing else in
        `consts`, its per-edit path element resolved to nothing, and it read UNREADABLE with a
        shape already correctly detected (arity 3, anchor 1, PATH AT 0). The path was in plain
        source the whole time, one syntax form away.

        ⚠ ONLY WHEN THE ARITIES MATCH AND THE RIGHT SIDE IS A LITERAL TUPLE. `a, b = f()` and
        `a, *rest = xs` bind names to things this cannot evaluate, and guessing there would attach
        a path to the wrong name — which is a false miss against a harness that is fine.
        """
        t = node.targets[0]
        if isinstance(t, ast.Name):
            return [(t.id, node.value)]
        if (isinstance(t, ast.Tuple) and isinstance(node.value, ast.Tuple)
                and len(t.elts) == len(node.value.elts)
                and all(isinstance(e, ast.Name) for e in t.elts)):
            return [(e.id, v) for e, v in zip(t.elts, node.value.elts)]
        return []

    def _path_bindings(self, node: ast.Assign) -> list[tuple[str, ast.AST]]:
        """`_bindings`, restricted to values that name a real file.

        ⚠ THE UNRESTRICTED VERSION MANUFACTURED THREE FALSE MISSES AND THE RUN IS WHAT SAID SO.
        `w11-pointer-pins` writes `CAUGHT, MISSED = 'CAUGHT', 'NOT CAUGHT'` — two LABELS, unpacked
        exactly like a path pair — and binding them put `'NOT CAUGHT'` in `consts`, from where it
        was paired with a file and reported as an anchor absent from `src/caseAudit.test.tsx`.
        ⚠⚠ AND THE EXISTING SENTINEL REJECTION CANNOT CATCH IT: `^[A-Z][A-Z0-9_]{3,}$` has no
        space in the class, so `NOT CAUGHT` is not a sentinel by that rule. Widening the sentinel
        instead would have been the wrong repair — an all-caps phrase is a shape real source text
        can have, and rejecting it would silently drop real anchors.
        ⚠ So the tuple form is admitted ONLY for values that RESOLVE to a file here, which is the
        entire reason it was added: `LENS, SAME, CITED = BFF / "lens.go", …`. An anchor stored in
        a tuple-unpacked constant is not reached, and that is the conservative direction — fewer
        triples, never a miss against a file the harness never touches.
        """
        return [(n, v) for n, v in self._bindings(node)
                if isinstance(self.__class__._bindings(node), list)
                and (lambda x: x is not None and resolve(x, self.home) is not None)(self._str(v))]

    # module-level `NAME = "…"` so an anchor held in a constant resolves
    def visit_Assign(self, node: ast.Assign) -> None:
        if len(node.targets) == 1 and not isinstance(node.targets[0], ast.Name):
            for _n, _v in self._path_bindings(node):
                _s = self._str(_v)
                if _s is not None:
                    self.consts[_n] = _s
        if len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            # ⚠ RESTORED DELIBERATELY. Refactoring the binding into `_bindings` dropped this line,
            # and MEASURED it costs nothing today — 558 anchors either way, because every constant
            # these harnesses use for an anchor happens to be module-level and `_prescan` already
            # has it. But this walk reaches assignments INSIDE functions and `_prescan` does not,
            # so dropping it is a narrowing that no current harness exercises. Deleting behaviour
            # because today's tree does not need it is how reach shrinks quietly.
            _v = self._str(node.value)
            if _v is not None:
                self.consts[name] = _v
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
        self._tree = tree
        seen: list[str] = []
        for node in tree.body:
            if not isinstance(node, ast.Assign) or len(node.targets) != 1:
                continue
            for name, value in (self._bindings(node)
                                if isinstance(node.targets[0], ast.Name)
                                else self._path_bindings(node)):
                v = self._str(value)
                if v is None:
                    continue
                self.consts.setdefault(name, v)
                if resolve(v, self.home) is not None and v not in seen:
                    seen.append(v)
        self.file_consts = seen
        # ⚠ THE ANCHOR POSITION WITHOUT A VOCABULARY. Every name this module hands to `.count(…)`.
        # A harness that writes `original.count(o) == 1` has DECLARED that element 0 is a literal
        # whose occurrences in the file's text are the thing that matters — which is the question
        # this checker asks, phrased by the harness itself.
        #
        # ⚠⚠ AND IT IS WHY `o` DID NOT GO INTO ANCHOR_NAMES. `w1118-money-name` reads UNREADABLE
        # only because its loop says `for o, n in edits`. Measured across all 74: `for o, …`
        # appears in exactly TWO harnesses, so adding the letter would have worked — and it would
        # have been a guess about a single letter, with the same argument due again for `needle`
        # (w1113-landmark-id spells it that way) and for whatever the next harness calls it. The
        # `.count` signal covers all three spellings and 38 harnesses without naming any of them.
        #
        # ⚠ BOTH RULES ARE KEPT AND NEITHER SUBSUMES THE OTHER — MEASURED, NOT ASSUMED, BECAUSE
        # "the new rule replaces the old one" is the tidy answer and it is false here:
        #     ANCHOR_NAMES alone     530 anchors
        #     counted_names alone    526
        #     both                   537
        # The vocabulary carries 11 the count signal does not (harnesses that assert their anchors
        # some other way, or not at all), and the count signal carries 7 the vocabulary does not.
        # Deleting either loses real coverage in the direction that looks like a simplification.
        #
        # ⚠ IT LOOKS AT NO STRING'S CONTENTS, which is the line this file draws everywhere: the
        # evidence is a call the harness makes, never whether a candidate happens to be in the file.
        self.counted_names = {n.args[0].id for n in ast.walk(tree)
                              if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                              and n.func.attr == "count" and n.args
                              and isinstance(n.args[0], ast.Name)}
        for node in ast.walk(tree):
            if not isinstance(node, ast.For) or not isinstance(node.target, ast.Tuple):
                continue
            names = [e.id if isinstance(e, ast.Name) else "" for e in node.target.elts]
            idx = next((i for i, n in enumerate(names) if n in self.ANCHOR_NAMES), None)
            # ⚠ SECOND, AND IT IS NOT A VOCABULARY. `self.counted_names` is every name this module
            # passes to `.count(…)` — the harness saying, in its own code, "this element is a
            # string whose occurrences in the text I count". That is exactly the question this
            # checker asks, so it is the strongest evidence available and it needs no list of
            # spellings. See counted_names in _prescan for what it costs and what it is not.
            if idx is None:
                idx = next((i for i, n in enumerate(names) if n in self.counted_names), None)
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
        # after consts are known, because the write target is looked up through them
        self.written_file = self._write_target()

    def _single_file(self) -> str | None:
        """The one file this harness edits, or nothing. EXACTLY one — with two, attributing an
        anchor to either is a guess, and a guess here is a false miss reported against a harness
        that is fine.

        ⚠ …UNLESS THE HARNESS SAYS WHICH ONE BY WRITING TO IT. Naming two files and EDITING two
        files are different facts, and the second is the one this rule needs. `w11-scroll-reset`
        names `src/App.tsx` and `src/scrollReset.test.tsx`, and the test file is the suite it RUNS,
        never a file it splices — only `APP.write_text(...)` appears. Measured across all 74
        harnesses: 59 name more than one file, and this carries exactly 3 of them.

        ⚠⚠ AND IT IS NOT "the one it writes to" — it is "it writes to exactly one thing and every
        write target is a module constant that resolves". `w171-docs-search-register` writes
        through `GUARD` AND through a local `path` variable, so its write targets cannot be
        enumerated from here and it declines rather than attributing anchors that belong in
        `apps/bff/docs_search.go` and `deploy/decision-expiry.sh` to `src/docsSearchRegister.test.ts`.

        ⚠⚠⚠ AND BOTH DECLINES ARE UNEXERCISED ON TODAY'S TREE — MEASURED, AND SAID HERE RATHER
        THAN IMPLIED AWAY. Their populations are large: of the 59 harnesses naming more than one
        file, 19 write through something that is not a bare Name and 37 write through a name that
        is not a module constant (`path`, `p`, `f` — a loop variable). But REMOVING EITHER DECLINE,
        OR BOTH, CHANGES NO ANCHOR AND NO VERDICT: 530 decided and 7 unreadable, before and after.
        The reason is that `_single_file()` only reaches an anchor through a shape — an edit-list
        arity, an ANCHOR_NAMES dict key, a for-loop unpacking — and no harness in either declining
        group also has one. **So these are conservatism, not a guard that has been demonstrated to
        catch anything**, and the safety of this rule today rests on the shapes above it. When a
        harness lands with BOTH a multi-file constant set AND an edit shape, re-measure: that is
        the first run on which these can be wrong, and it will not announce itself.

        ⚠ IT LOOKS AT NO STRING'S CONTENTS. The evidence is the harness's own write calls, not
        which candidate happens to contain the anchor — that circular version yields a checker
        that can never report a miss, and is written down elsewhere in this file as the thing not
        to do."""
        if len(self.file_consts) == 1:
            return self.file_consts[0]
        return self.written_file

    def _write_target(self) -> str | None:
        """The single file every write in this module goes to, or nothing."""
        names: set[str | None] = set()
        for node in ast.walk(self._tree):
            if not isinstance(node, ast.Call):
                continue
            if isinstance(node.func, ast.Attribute) and node.func.attr in ("write_text", "write_bytes"):
                v = node.func.value
                names.add(v.id if isinstance(v, ast.Name) else None)
            elif isinstance(node.func, ast.Name) and node.func.id == "open":
                mode = None
                if len(node.args) > 1 and isinstance(node.args[1], ast.Constant):
                    mode = node.args[1].value
                else:
                    mode = next((k.value.value for k in node.keywords
                                 if k.arg == "mode" and isinstance(k.value, ast.Constant)), "r")
                if isinstance(mode, str) and ("w" in mode or "a" in mode) and node.args:
                    a = node.args[0]
                    names.add(a.id if isinstance(a, ast.Name) else None)
        # a write through anything this analysis cannot name — a local, a subscript, an f-string —
        # means there are write targets it cannot enumerate, so it declines rather than guesses.
        if not names or None in names:
            return None
        paths = [self.consts.get(n) for n in names]
        if any(pth is None for pth in paths):
            return None
        distinct = list(dict.fromkeys(paths))
        if len(distinct) != 1 or resolve(distinct[0], self.home) is None:
            return None
        return distinct[0]

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
        # `os.path.join(ROOT, "apps/bff", "lens.go")` — the same join the Div branch below reads,
        # spelled the other way, and it obeys the same rule.
        #
        # ⚠ JOIN THE FIRST ARGUMENT TOO WHEN IT CAN BE EVALUATED — THIS SHIPPED DROPPING IT (#294)
        # AND THE DIV BRANCH'S OWN COMMENT, ONE SCREEN BELOW, IS THE WARNING I WALKED PAST. It
        # dropped args[0] on the reasoning that it is "a root the caller already resolves", which
        # is true of `ROOT = os.path.dirname(...)` and FALSE of everything built from it:
        # `w17-mounted-patterns` writes `BFF = os.path.join(ROOT, "apps/bff")` and then
        # `LENS = os.path.join(BFF, "lens.go")`, and dropping the first argument yielded the bare
        # `"lens.go"`. That harness stayed UNREADABLE with its paths apparently learned.
        #
        # ⚠⚠ AND UNREADABLE WAS THE LUCKY OUTCOME. `lens.go` happens to exist under none of the
        # roots, so it resolved to nothing. The Div branch records what happens when the bare name
        # DOES exist somewhere: `UI / "vitest.config.ts"` read as bare "vitest.config.ts" resolved
        # onto apps/web's copy and reported a miss against a file the harness never touches. Same
        # bug, same file, one branch apart, and the second time it was written by someone who had
        # read the first. An unevaluable first argument still yields nothing, which is correct:
        # nothing means repo-relative.
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "join" and len(node.args) >= 2):
            parts = [self._str(a) for a in node.args]
            if all(x is not None for x in parts[1:]):
                head = parts[0]
                tail = "/".join(x.strip("/") for x in parts[1:])
                return f"{head.rstrip('/')}/{tail}" if head else tail
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
    pattern_anchored: list[tuple[str, list[str], int]] = []

    for h in harnesses():
        rel = str(h.relative_to(ROOT))
        try:
            home = package_root(h)
            ex = Extractor(h.read_text(), home)
            ex.visit(ast.parse(h.read_text()))
        except SyntaxError as e:
            unreadable.append(f"{rel}: does not parse ({e})")
            continue

        spliced = regex_spliced_names(ast.parse(h.read_text()))
        if spliced:
            # ⚠ DISCARDED, NOT MERELY UNLABELLED. Whatever the extractor found here is a regex, and
            # comparing a regex with str.count reports a control that arms perfectly as one that
            # cannot arm.
            pattern_anchored.append((rel, spliced, len(ex.triples)))
            continue

        ambiguous += ex.ambiguous
        for _p, _a, why in ex.rejected:
            rejected[why] = rejected.get(why, 0) + 1
        # only triples whose PATH resolves to a real file are anchors this check can decide
        decidable = [(p, a, n) for (p, a, n) in ex.triples if resolve(p, home)]
        if not decidable:
            unreadable.append(f"{rel}\n    {why_unreadable(ex)}")
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
    # ⚠ ON THE FACE OF EVERY RUN, for the same reason the rejection counts are: a file quietly
    # dropped from the census is how this instrument's reach shrinks while its output looks
    # unchanged — and one quietly ADDED is how it starts measuring itself.
    for name, why in _self_excluded:
        print(f"  excluded from the census — {why}: {name}")
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
    if pattern_anchored:
        # ⚠ ITS OWN BUCKET, AND NOT UNDER "widen the extractor". These are not a gap to close; they
        # are outside what a literal comparison can decide, and saying so is the whole point — the
        # measured cost of not saying it is 14 false misses on a font-identity guard.
        print(f"⚠ {len(pattern_anchored)} HARNESS(ES) ANCHOR ON REGEXES, NOT LITERALS — this check")
        print("  compares with str.count and CANNOT decide them. Do NOT widen the extractor to")
        print("  reach these: each asserts its own anchor counts with re.findall, which is the")
        print("  stronger check. Widening reaches them and reports every anchor as a miss.")
        for rel, names, found in pattern_anchored:
            print(f"  {rel}: spliced with re.sub via {names} ({found} candidate(s) discarded)")
        print()
    if unreadable:
        print(f"⚠ THE CHECKER COULD NOT READ {len(unreadable)} HARNESS(ES). Each is a harness this")
        print("  check says NOTHING about — not a clean one. The missing half is named per harness:")
        print("  a FILE half cannot be closed by widening the anchor vocabulary, and a SHAPE half")
        print("  cannot be closed by teaching _str another path expression.")
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
