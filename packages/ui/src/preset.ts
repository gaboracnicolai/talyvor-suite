import type { Config } from 'tailwindcss'

/**
 * The locked preset. Every value the components may use is a NAMED token here;
 * arbitrary values (text-[#…], p-[13px]) are forbidden by local/no-arbitrary-value
 * so this file is the only door to the palette, scale, spacing and radii.
 */
const preset = {
  theme: {
    extend: {
      // Named breakpoint so the Shell can stack under 840px without an arbitrary value.
      screens: { wide: '840px' },
      colors: {
        canvas: 'var(--canvas)',
        surface: 'var(--surface)',
        sidebar: 'var(--sidebar)',
        rule: { DEFAULT: 'var(--rule)', strong: 'var(--rule-strong)' },
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        accent: { DEFAULT: 'var(--accent)', hover: 'var(--accent-hover)', ink: 'var(--accent-ink)', tint: 'var(--accent-tint)' },
        lens: 'var(--lens)',
        lxc: 'var(--lxc)',
        tier1: 'var(--tier1)',
        tier3: 'var(--tier3)',
        settled: 'var(--settled)',
        held: 'var(--held)',
        slashed: 'var(--slashed)',
      },
      fontFamily: {
        sans: ['var(--sans)'],
        mono: ['var(--mono)'],
        /**
         * THE FIGURE FACE — `font-figure`. Every numeral in the product renders here.
         *
         * The public site sets both its eyebrow labels and its quoted figures in one
         * utility whose whole definition is `font-family: var(--font-mono);
         * font-feature-settings: "tnum" 1`. This is that, named.
         *
         * ⚠ THIS REVERSES A PREVIOUS DECISION, so the previous reasoning is answered
         * rather than deleted. The system used to set numerals in the SANS with
         * `tabular-nums`, on the premise that "mono is for IDENTIFIERS — a machine
         * string you might copy — and 'this is a number' is not a message". That
         * premise was true of a system-font stack, where mono was a foreign face that
         * appeared only on SHAs and key prefixes. It is not true of this one: mono is
         * now the face of every eyebrow label on every screen, so mono no longer says
         * "machine string", it says "measured". What still separates an identifier from
         * a figure is the tracking (labels carry it, figures do not) and the size step,
         * not the family.
         */
        figure: ['var(--mono)', { fontFeatureSettings: '"tnum" 1' }],
      },
      fontSize: {
        title: ['24px', { lineHeight: '1.2', fontWeight: '640' }],
        head: ['17px', { lineHeight: '1.3', fontWeight: '600' }],
        body: ['14px', { lineHeight: '1.45', fontWeight: '400' }],
        caption: ['12px', { lineHeight: '1.35', fontWeight: '600' }],
        // the µ-tail: 12.5px, dimmed + underscored in MuNumeral (moves with the scale).
        micro: ['12.5px', { lineHeight: '1', fontWeight: '500' }],

        // ── THE EYEBROW ───────────────────────────────────────────────────────────────────────
        //
        // The small uppercase label that names a region before it says anything, and the ONE
        // small label in this system. It existed already, hand-rolled twenty-one times in four
        // shapes — `text-caption uppercase tracking-wide` with text-muted, with text-faint, with
        // font-semibold, and once with no colour at all. Four shapes is not a style, it is drift.
        //
        // Measured off the public site, which uses one shape for it everywhere: 11px, mono,
        // letter-spacing .14em–.32em, weight 400, in the faint or dim ink. Pinned at the modal
        // .24em, with the tracking IN the token — a caller who applies the size and forgets the
        // tracking gets small mono text, not an eyebrow.
        //
        // ⚠ WEIGHT IS 400, WHICH IS A DROP FROM THE CAPTION'S 600, AND THAT IS THE POINT: it
        // leaves `font-semibold` free to MEAN something. Members distinguishes owner from member
        // by weight rather than hue; at 600 the token would have silently collapsed that
        // distinction into no distinction at all.
        //
        // ⚠ THE UPPERCASE IS NOT IN HERE, deliberately. `text-transform: uppercase` maps
        // µ (U+00B5) to Greek capital Mu, and µLENS/µLXC sit inside these labels. It is applied
        // at the call site, where MuNumeral can keep its µ in a `normal-case` span.
        eyebrow: ['11px', { lineHeight: '1.2', letterSpacing: '0.24em', fontWeight: '400' }],

        // ── DISPLAY: the marketing scale ──────────────────────────────────────────────────────
        //
        // The five sizes above are a CONTROL-PANEL scale and stop at 24px on purpose — a console
        // has no use for display type, and giving it any would invite a hero headline into a
        // settings screen.
        //
        // The public page does need it, and the honest way to give it one is a named scale rather
        // than arbitrary values: `no-arbitrary-value` exists so a component cannot silently invent
        // its own type, and a marketing page is not an exemption from that — it is simply a
        // consumer with a requirement the scale had not covered yet. Fluid by design (clamp), so
        // the page holds its proportions from a phone to a wide monitor without a breakpoint per
        // size, and each entry carries its own leading and tracking so a caller cannot half-apply
        // one.
        //
        // ⚠ NOT FOR THE APP. Nothing behind the AuthGate should reach for these; if a console
        // screen ever wants display type, that is a design conversation, not an import.
        //
        // ⚠ WEIGHT AND TRACKING RECALIBRATED TO THE FACE. These were set for a system
        // neo-grotesque at 640–660. Space Grotesk is a GEOMETRIC sans and carries its
        // character in the letterforms, not the weight; the site sets every display line at
        // font-medium/semibold with -0.03em. Measured off the served markup: h1 is
        // `clamp(1.9rem,4.4vw,3.6rem) font-medium leading-[1.04] tracking-[-0.03em]`. The size
        // ramp is unchanged — only the weight and tracking move, because those are properties
        // of the typeface and the typeface changed.
        'display-1': ['clamp(34px, 6vw, 58px)', { lineHeight: '1.04', letterSpacing: '-0.03em', fontWeight: '500' }],
        'display-2': ['clamp(25px, 3.8vw, 38px)', { lineHeight: '1.06', letterSpacing: '-0.03em', fontWeight: '500' }],
        'display-3': ['clamp(23px, 3.2vw, 33px)', { lineHeight: '1.12', letterSpacing: '-0.02em', fontWeight: '500' }],
        'display-4': ['clamp(19px, 2.5vw, 26px)', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '600' }],
        // The paragraph that sits directly under a display heading.
        lede: ['clamp(15px, 1.7vw, 19px)', { lineHeight: '1.5', fontWeight: '400' }],
        // A measured figure quoted at reading size — the ledger numbers on the public page.
        figure: ['28px', { lineHeight: '1', fontWeight: '560' }],
      },
      borderColor: { DEFAULT: 'var(--rule)' },
      borderRadius: { card: '10px', control: '6px', pill: '9999px' },
      spacing: { gutter: '16px', row: '38px' },
      height: { row: '38px' },
      minHeight: { row: '38px' },
      outlineColor: { accent: 'var(--accent)' },
      ringColor: { accent: 'var(--accent)' },
    },
  },
} satisfies Partial<Config>

export default preset
