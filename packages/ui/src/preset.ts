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
