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
      },
      fontSize: {
        title: ['24px', { lineHeight: '1.2', fontWeight: '640' }],
        head: ['17px', { lineHeight: '1.3', fontWeight: '600' }],
        body: ['14px', { lineHeight: '1.45', fontWeight: '400' }],
        caption: ['12px', { lineHeight: '1.35', fontWeight: '600' }],
        // the µ-tail: 12.5px, dimmed + underscored in MuNumeral (moves with the scale).
        micro: ['12.5px', { lineHeight: '1', fontWeight: '500' }],

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
        'display-1': ['clamp(34px, 6vw, 58px)', { lineHeight: '1.05', letterSpacing: '-0.02em', fontWeight: '660' }],
        'display-2': ['clamp(25px, 3.8vw, 38px)', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '650' }],
        'display-3': ['clamp(23px, 3.2vw, 33px)', { lineHeight: '1.15', letterSpacing: '-0.015em', fontWeight: '640' }],
        'display-4': ['clamp(19px, 2.5vw, 26px)', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '640' }],
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
