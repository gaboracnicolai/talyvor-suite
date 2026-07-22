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
`Select` · `Input` · `Pill` (settled / held / slashed / lens / lxc) · `MuNumeral`
(the µ-split, two scales) · `HoldBar` (the hold hairline — **blocked, see below**) ·
`TierDot` (the routing ramp) · `ThemeToggle`.
Reviewed at **`/specimen`** — every component, both themes. That route is the contract, not a
throwaway.

### MuNumeral — two scales, one rule

Money is stored as an integer count of µ-units (1e-6). MuNumeral renders it so that **the
meaningful part is always the emphasised part**:

- **≥ 1 unit:** whole units at head weight + a dimmed, underscored six-digit µ-tail —
  `12.340567 LENS` → `12` · `.340567`. The whole part carries the magnitude.
- **< 1 unit (`whole === 0`):** the decimal form would put *every* significant digit into the
  recessive tail (`0.000064 LXC`), so it switches units and renders the µ-integer the ledger
  actually stores — `64 µLXC`, `1,000 µLENS`. Same "meaning lives in the whole part" rule, at
  both scales; no second visual treatment of the decimal form.

The crossover is exactly `whole === 0` because that is precisely the set of values for which
the decimal form has nothing in its emphasised slot.

### Blocked components

**`HoldBar` is blocked — do not wire it.** It renders *how far through a hold window* a held
reward is, so it needs a window: a start and end, or a remaining duration. **The Lens ledger
exposes no such window.** A held row (`type` ending `_held`) carries only an amount, a `type`,
a `description`, `metadata`, and `created_at`; the `lens_token_ledger` schema has no window
column, and `metadata` is provenance (model, latency), not timing. The window data exists in
Lens's separate `*_held` minter tables (`finalize_after`), but those have **no workspace read
endpoint**.

So HoldBar **stays unused until Lens exposes a hold window on a read path**. It is wired into
no screen; the held *state* surfaces as a `Pill` (`held`) — which is all the ledger supports.
`/specimen` shows it with illustrative values only, clearly labelled. Wire it to the ledger
and you get nothing — that's why this is written down rather than left to be discovered.

**Quality floor:** a 2 px accent focus ring at 2 px offset on every interactive element
(`focus-visible` only); `prefers-reduced-motion` respected globally; responsive to mobile;
every control labelled for assistive tech (Radix roles + `aria-label`s).

---

## The routing ramp — two steps

The ramp was four distinct hues (cyan → green → amber → rose). It is now **two categories**:
`cheap` (cool, `tier1`) and `capable` (warm, `tier3`). The four-hue version read as *busy /
categorical, not ordered*: hue is categorical, not ordinal — four hues are four categories a
reader cannot rank without a legend, and once a `Tier N` numeral was present to rank them, the
hue was redundant chroma. Two well-separated hues (cool vs warm) are self-ranking, so:

**Decision — the numeral is dropped.** With four hues the numeral made the hue redundant; with a
binary the inverse holds — two separated hues carry the order themselves (cool reads before
warm), so a `Tier N` numeral is unnecessary. `TierDot` takes `tier="cheap" | "capable"` and an
optional **word** label (`cheap` / `capable`) that carries meaning and the accessible name — not
a numeral.

**The durable rule, so nobody re-derives four hues later:**

> **Hue encodes CATEGORY; lightness encodes ORDER.** Colour categories are unordered by nature.
> If more than two tiers are ever genuinely needed, the ordinal-correct form is **one hue at N
> lightness steps** (a pale-to-dark ramp of a single hue), **never N distinct hues**. Distinct
> hues may only be used where the axis is a small set of *categories*, not a rank.

---

## Verify

```
pnpm install
pnpm build      # tsc + vite build, clean
pnpm lint       # eslint incl. local/no-arbitrary-value; fixture proves it fails
pnpm test       # vitest — tokens drift, the invariant, renders, the lint proof, specimen both themes
pnpm dev        # http://localhost:5173  →  /specimen
```

## Running the app (BFF + web)

The BFF requires an explicit auth mode — there is no default.

**Dev, loopback only (no IdP):**

```
cd apps/bff
BFF_AUTH_MODE=disabled LENS_WORKSPACE_KEY=tlv_ws_… LENS_WORKSPACE_ID=… go run .
pnpm dev        # vite proxies /api and /auth → 127.0.0.1:8787
```

`disabled` means what it says: no authentication, so the BFF hard-refuses any
non-loopback bind (unchanged from inc2).

**Authenticated (any OIDC provider — Keycloak, Authentik, Dex, Clerk-as-IdP):**

```
BFF_AUTH_MODE=oidc \
OIDC_ISSUER=https://your-idp.example.com \
OIDC_CLIENT_ID=talyvor-suite OIDC_CLIENT_SECRET=… \
OIDC_ALLOWED_EMAILS=you@example.com \
BFF_PUBLIC_BASE_URL=http://127.0.0.1:8787 \
LENS_WORKSPACE_KEY=tlv_ws_… LENS_WORKSPACE_ID=… go run .
```

Register `BFF_PUBLIC_BASE_URL` + `/auth/callback` as the client's redirect URI
at the IdP. The browser holds one `__Host-` session cookie; tokens and the
Lens key never leave the BFF. For the production posture behind Caddy on
`app.talyvor.com`, see `deploy/README.md`.
