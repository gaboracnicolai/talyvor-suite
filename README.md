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
before first paint, respecting `prefers-color-scheme`), or on any element to theme a subtree.

Type: `title 24/640 · head 17/600 · body 14/400 · caption 12/600` (+ a `micro` 12.5 for the
µ-tail). Metrics: card radius 10 · control radius 6 · pill radius 999 · row height 38 · gutter 16.

---

## The language — ported from the public site, and measured

The console and `talyvor.higgsfield.app` are one product. The dark theme is not *like* the
site's; where it can be, it **is** the site's — taken from the stylesheet the site serves
(`/assets/styles-CGSz1SmS.css`, `@theme` block, fetched 2026-08-09) rather than from a
screenshot or a description:

| token | value | site variable |
|---|---|---|
| `canvas` | `#060A12` | `--color-ink` |
| `surface` | `#0B1220` | `--color-ink-raise` |
| `ink` | `#E6EEF7` | `--color-txt` |
| `muted` | `#7E93AB` | `--color-txt-dim` |
| `accent` | `#3AD6C0` | `--color-acc` |

Everything that could **not** be taken verbatim carries its reason and its number in
`__tests__/site-parity.test.ts`, which fails if any of it drifts and fails if a new token
arrives with no stated relationship to the site at all. The three that matter:

- **`sidebar` is the canvas.** The site's own chrome is the page colour separated by a rule
  (`bg-ink/80 border-b`, measured in the served markup), not a second plane. The rail follows
  it. This also removed two AA failures the old greyer rail carried.
- **`faint` is lifted.** The site's `--color-txt-faint` measures **3.42:1** on its own page
  black — it fails AA for body text, and the site uses it only for 11px eyebrows. This console
  puts `faint` on the µ-tail of every money figure, so the value is moved along the site's own
  txt-faint → txt-dim ray to the first point clearing 4.5:1 against both dark planes
  (`#6B7F96` = 4.81 / 4.55). Minimum distance, same colour ray.
- **`accent-ink` exists at all.** Measured: `bg-acc` appears nine times in the served markup
  and every one is a 1px underline or a 6px dot — the site has **no filled accent button**. A
  console needs an unambiguous primary, so the fill stays and takes the page black as its ink
  (10.91:1). A deliberate divergence, written down rather than absorbed.

**The light theme is derived, not ported** — the site is dark-only. Same blue undertone, the
same accent hue darkened until it clears AA on a light field (`#0F7A6C`), same structure.

### Every pair is measured

`packages/ui/src/lib/contrast.ts` is WCAG 2.1 relative luminance and contrast ratio;
`__tests__/contrast.test.ts` scores **every** text token against **every** background (AA body,
4.5:1) and every affordance hue against every background (the 3:1 non-text floor), in both
themes. Every token must be given a role, so a new one cannot default into the unchecked set.

> It was written before this palette landed and it was **red**. The previous `faint` — the
> µ-tail under every money figure, at 12.5px — measured **2.98:1** on the light canvas, **2.80**
> on the light sidebar and **3.83** on the dark surface. Two of those fail even the 3:1
> large-text floor. It had been shipping. Eight pairs failed in total; all eight pass now.

The instrument is positive-controlled against the ratios published in WCAG itself (black on
white = 21, `#767676` on white = 4.54) before it is trusted to grade anything — a meter nobody
has checked against a known quantity measures nothing.

### One electric accent

`site-parity.test.ts` asserts the accent's distance to its nearest neighbour is at least the
distance between the two closest *other* hues — self-calibrating, no magic constant: *is the
accent at least as distinct from the palette as the palette is from itself?*

> Also red before the port. The old accent sat **28.4** from `tier1` while the tightest other
> pair sat **30.6** apart: the accent was closer to the routing ramp than the palette was to
> itself, and three hues crowded it. It is now 42.8 against the same 30.6 floor.
>
> Separately measured and **not** fixed here: `lens ↔ tier3` = 30.6 is tight in absolute terms —
> copper and warm amber are hard to tell apart as 2px ticks. Recorded so the next palette pass
> starts from a number rather than an impression.

### The faces

**Space Grotesk** (geometric sans) and **IBM Plex Mono**, the two the site is set in, **served
from this repo** — not from a font CDN. This console is behind an auth gate and shows a tenant's
money; a per-page-load request to a third party is a data flow, not a convenience. Both are SIL
OFL 1.1 and the licences ship beside the files in `packages/ui/src/fonts/` (132 KB, latin +
latin-ext, `font-display: swap` over a system fallback).

`__tests__/typeface.test.tsx` asserts the **files**, not the declaration: every `url()` in
`theme.css` must resolve to something on disk whose first four bytes are `wOF2`. An `@font-face`
whose file is missing does not 404 loudly — the browser falls back to the system stack and the
app renders in the wrong typeface forever.

### Numerals are mono — reversing an earlier decision

Every numeral renders in **`font-figure`**: `var(--mono)` with `font-feature-settings: "tnum" 1`
— which is, exactly, the site's own `.font-instrument`.

This **reverses** design-fixes correction 1 ("numerals are SANS with tabular figures; mono is
for identifiers"), so the old reasoning is answered rather than deleted. That rule rested on
mono being a *foreign* face here, appearing only on SHAs and key prefixes, so seeing it meant
"machine string you might copy". True of a system-font stack; false of this one, where mono is
the face of every small label on every screen. Mono no longer says *identifier* — it says
*measured*, and a money figure is the most measured thing in the product. Tracking and size
step still separate a label from a figure; the family no longer does.

`tabular-nums` is consequently gone from non-test source, and a test asserts it stays gone —
across **both** packages, because scoping that sweep to `packages/ui` would have scored green
while eight app call sites kept the old face. (The detector matched its own explanatory prose on
its first run, and is positive-controlled in both directions.)

---

## Stack

React 18.3 · **Vite 6** · TypeScript · **Tailwind 3.4** · **TanStack Query 5** (provider wired,
no queries yet) · **Zustand 5** (the theme store) · **Radix** primitives (Switch, Select, Slot) ·
**Vitest 3**. This is the core both prior Talyvor frontends independently converged on.
Type is **Space Grotesk + IBM Plex Mono**, served from `packages/ui/src/fonts/` — see
§The language.

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

> ⚠ **There is no `/specimen`.** This section, §Tokens & theme and §Verify all described it as
> the review surface — "that route is the contract, not a throwaway" — long after `App.tsx`
> deleted the route and the component. The contract is now the component tests plus the token,
> contrast, parity and typeface guards; a reader sent to a route that 404s learns nothing.
> (Re-standing up a gallery is a reasonable thing to want. Doing it is a change, not a claim.)

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
Wire it to the ledger and you get nothing — that's why this is written down rather than left
to be discovered.

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
pnpm test       # vitest — token drift, the invariant, contrast, site parity, the faces, renders, the lint proof
pnpm dev        # http://localhost:5173
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

Optional product upstreams (oidc mode only — the BFF forwards the identity it
authenticated): `TRACK_BASE_URL` + `TRACK_GATEWAY_SECRET`, and `DOCS_BASE_URL`
+ `DOCS_GATEWAY_SECRET` + `DOCS_WORKSPACE_ID`. Each secret is that service's
`GATEWAY_AUTH_SECRET`; the BFF attaches it as `X-Gateway-Auth` (the transit
proof) plus `X-User-Email`/`X-User-Id` from the session. Unconfigured →
`/api/track/*` and `/api/docs/*` answer an explicit 503.

## Directory ownership — the parallel-work contract

One area = one directory. An area tab works ONLY inside its directory:

```
apps/web/src/areas/lens/        Lens + the Workspace section (Overview, Ledger, Billing, Keys, Spend, Members)
apps/web/src/areas/track/       Track   (/track/*)
apps/web/src/areas/docs/        Docs    (/docs/*)
apps/web/src/areas/marketing/   Marketing landing (/marketing, outside the auth gate)
```

`areas/lens/` is the worked example: the real Overview and Ledger screens live
there, with their tests and lens-only helpers (`format.ts`, `Capability.tsx`).
A new screen in an area = new files in that area's directory plus a `<Route>`
already reserved for it here — nothing else.

**SHARED files — off-limits to area work.** Changing any of these requires its
own dedicated PR, because five parallel tracks depend on them not moving:

- `apps/web/src/App.tsx` — routing, nav groups, the auth-gate mounting
- `apps/web/src/components/` — the app shell chrome (AuthGate, SessionChip)
- `apps/web/src/lib/` — the shared BFF client (`api.ts`)
- `apps/web/src/styles.css`
- `packages/ui/**` — the design system (components, tokens, preset, theme)
- `eslint.config.js`, `tsconfig.base.json`, `pnpm-workspace.yaml`, CI
- `apps/bff/**` — the BFF (new proxy routes are BFF PRs, not area commits)
- `deploy/**` — the front door

The design-system rules (text is never a hue; no arbitrary Tailwind values —
CI enforces the latter) bind area work exactly as they bind everything else.

---

## License

[Business Source License 1.1](LICENSE) (BUSL-1.1). **Not an open-source licence today.**

You may read, modify and self-host Talyvor Suite, including in production, for your own
organisation's purposes without limit, and an integrator may run it for up to **three clients
at a time**, each on its own deployment. You may **not** run one deployment serving two or more
unrelated organisations. Beyond three concurrent client engagements, or for multi-tenant use,
that is a commercial licence rather than a refusal — `hello@talyvor.com`. See the `Additional Use Grant` in [LICENSE](LICENSE)
for the exact boundary, and the `Change Date`, on which this converts to Apache License 2.0.
