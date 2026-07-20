# talyvor-suite

The unified Talyvor frontend. **Increment 1: the design system and the app shell only** —
the token preset, the theme, and the component set. No BFF, no API calls, no product screens.

```
packages/ui     the design system (tokens, Tailwind preset, components)
apps/web        the React app shell that consumes it
apps/bff        (later — deliberately not created yet)
```

pnpm workspaces. `pnpm build` · `pnpm lint` · `pnpm test` · `pnpm dev` (serves `apps/web`).

---

## The invariant — text is never a hue

This is the one rule that makes it a **system** rather than a theme:

> **Every word renders in `ink` / `muted` / `faint`. Colour appears only in affordances,
> 2 px ticks, small pills and 4 px bars.**

Why: an interface for engineers is read, densely, all day. If status, tier, mined- and
pegged-token colours are allowed onto text, every screen becomes a ransom note and nothing
is legible at a glance. Confining colour to affordances (a dot, a tick, a bar, a filled
control) keeps the reading surface calm and makes the colour that *is* there mean something.

**How it is enforced, not merely asked:**

- Components take a semantic prop (`status`, `tier`, `variant`), **never a colour prop that
  could land on a text node**. The hue goes on a dot/tick/bar; the label stays ink.
- `packages/ui/src/__tests__/invariant.test.ts` statically fails if any component ever writes
  `text-lens` / `text-lxc` / `text-tier*` / `text-settled` / `text-held` / `text-slashed`.
- Two sanctioned exceptions, both *ink on an affordance*, not hued words: the **primary
  button** label uses `accent-ink` (a contrast ink paired with the accent fill), and small
  **icons** (the Select check, the theme glyph) use `currentColor`.

Two places this diverges from the macOS System Settings reference, on purpose:

- **Selection** (`NavItem`): a selected row is an **ink label + a 2 px accent tick**, not a
  filled-accent row with white text — white-on-accent is a hue on text.
- **Danger** (`Button`): destructive intent is a **slashed ring**, never red text — there is
  no "slashed ink", and a red label would break the invariant.

---

## The lock — no arbitrary values

The tokens live in `packages/ui/src/preset.ts` as **named scales** (colours, spacing, radii,
type). Arbitrary Tailwind values (`text-[#fff]`, `bg-[#000]`, `p-[13px]`) are how a component
silently bypasses them, so they **fail CI**:

- `eslint.config.js` ships a self-contained `local/no-arbitrary-value` rule. It flags any
  class token carrying a `[...]` **value** in `className` / `cn()` / `clsx()`. It deliberately
  **allows** arbitrary **variants** (`data-[state=checked]:bg-accent`, `[&>svg]:text-ink`) —
  a state selector that still resolves to a *named* value — because those are needed to style
  Radix and don't bypass a token.
- Proof it bites: `packages/ui/fixtures/bad-arbitrary.tsx` uses `text-[#fff] bg-[#000] p-[13px]`;
  it is excluded from `pnpm lint`, and `no-arbitrary-value.test.ts` lints it with `--no-ignore`
  and asserts the rule reports it. The design system nobody can bypass is the only kind that holds.

---

## Tokens & theme

All values live once in `packages/ui/src/tokens.ts` and are mirrored into CSS variables in
`theme.css`; `tokens.test.ts` fails if the two ever drift. Themes are **scopable**: set
`data-theme` on `<html>` for the whole app (a no-flash inline script in `index.html` does this
before first paint, respecting `prefers-color-scheme`), or on any element to theme a subtree —
which is how `/specimen` shows light and dark side by side.

Type: `title 22/640 · head 15/600 · body 13/400 · caption 11/600` (+ a `micro` 11.5 for the
µ-tail). Metrics: card radius 10 · control radius 6 · pill radius 999 · row height 38 · gutter 16.

---

## Stack

React 18.3 · **Vite 6** · TypeScript · **Tailwind 3.4** · **TanStack Query 5** (provider wired,
no queries yet) · **Zustand 5** (the theme store) · **Radix** primitives (Switch, Select, Slot) ·
**Vitest 3**. This is the core both prior Talyvor frontends independently converged on.

**Router: `react-router-dom` v7.** Track used `@tanstack/react-router` and Docs used
`react-router-dom` — that divergence is part of why both are being discarded. Picking one:
`react-router-dom` v7, because it is the more widely-known choice, Docs already ran 30 tests on
it, and the suite's routing is plain nested layouts (no need for TanStack Router's typed-route
machinery in increment 1).

## Components

`Shell` (sidebar + content, sticky nav, stacks under the `wide` 840 px breakpoint) · `NavItem` ·
`Card` (+ `proof` rule variant) · `Row` · `Button` (default / primary / danger) · `Switch` ·
`Select` · `Input` · `Pill` (settled / held / slashed / idle / lens / lxc) · `MuNumeral`
(the µ-split) · `HoldBar` (the hold hairline) · `TierDot` (the routing ramp) · `ThemeToggle`.
Reviewed at **`/specimen`** — every component, both themes. That route is the contract, not a
throwaway.

**Quality floor:** a 2 px accent focus ring at 2 px offset on every interactive element
(`focus-visible` only); `prefers-reduced-motion` respected globally; responsive to mobile;
every control labelled for assistive tech (Radix roles + `aria-label`s).

---

## The routing ramp — my read (reported, not decided)

Built and put in a dense table in the specimen (`Routing ramp — dense table`), reasoning from
the constructed rows and the four tier hues (the pixel review is yours):

**Four steps read as BUSY / categorical, not ordered — and they need a legend to mean a rank.**
The four tiers are four *distinct hues* (cyan → green → amber → rose), not one hue ramped by
lightness. Hue is categorical, not ordinal: cyan/green/amber/rose carry no innate 1 < 2 < 3 < 4.
There is a faint cool→warm drift that hints at "cheap → expensive," but a first-time reader
would not reliably order them from colour alone; across many rows, four chroma points per row is
the loudest thing on the screen.

I mitigated it in the specimen by pairing each dot with a **`Tier N` numeral** — so the *number*
carries the rank and the hue is decoration. But that exposes the real tension: **if the numeral
already orders them, the four hues are redundant chroma that only adds busyness.**

My honest recommendation: for dense tables, **two steps (cheap / capable) would read as clearly
ordered** — a binary is trivially ranked, and two hues (one cool, one warm) are legible at a
glance with no legend. Keep four only where density is low and a legend is present. If you want
to keep four in tables, drop the dot and keep the numeral + a single accent, so the rank comes
from the number, not from four competing hues.

---

## Verify

```
pnpm install
pnpm build      # tsc + vite build, clean
pnpm lint       # eslint incl. local/no-arbitrary-value; fixture proves it fails
pnpm test       # vitest — tokens drift, the invariant, renders, the lint proof, specimen both themes
pnpm dev        # http://localhost:5173  →  /specimen
```
