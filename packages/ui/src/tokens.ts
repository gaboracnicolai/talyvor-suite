// Token values, VERBATIM from the brief. Single source of truth. theme.css mirrors
// these into CSS variables; tokens.test.ts asserts the two never drift.
//
// THE INVARIANT: text is never a hue. These colours land on affordances, 2px ticks,
// small pills and 4px bars — never on a text node. See README §"The invariant".
export const tokens = {
  light: {
    canvas: '#F4F5F6', surface: '#FFFFFF', sidebar: '#ECEEF0',
    rule: 'rgba(0,0,0,.085)', 'rule-strong': 'rgba(0,0,0,.14)',
    ink: '#1B1D1F', muted: '#6B6E73', faint: '#8B8F94',
    accent: '#0B7A85', 'accent-hover': '#096570', 'accent-ink': '#FFFFFF', 'accent-tint': '#CDE5E8',
    lens: '#A85A2C', lxc: '#42688C',
    // The routing ramp is TWO CATEGORIES, not four: tier1 = cheap/fast (cool),
    // tier3 = capable/expensive (warm). Hue encodes category; see README §The ramp.
    tier1: '#3E8E9C', tier3: '#B07F38',
    settled: '#1D7A45', held: '#8A6A12', slashed: '#BF3B2E',
  },
  dark: {
    canvas: '#141618', surface: '#1D2023', sidebar: '#0F1113',
    rule: 'rgba(255,255,255,.085)', 'rule-strong': 'rgba(255,255,255,.155)',
    ink: '#EDEFF1', muted: '#9CA1A6', faint: '#767B80',
    accent: '#3ABDC9', 'accent-hover': '#55CDD8', 'accent-ink': '#08191B', 'accent-tint': '#11333A',
    lens: '#D08A5C', lxc: '#7FA6CC',
    tier1: '#54B4C2', tier3: '#D6A85C',
    settled: '#45C77F', held: '#D6A93C', slashed: '#F0685C',
  },
} as const

export type TokenName = keyof typeof tokens.light
