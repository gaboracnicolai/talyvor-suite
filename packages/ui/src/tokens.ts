// Token values. Single source of truth. theme.css mirrors these into CSS variables;
// tokens.test.ts asserts the two never drift.
//
// ── WHERE THE DARK VALUES COME FROM ──────────────────────────────────────────────────
//
// From the brand board of 4 Oct 2026, whose token file ships beside this package as
// brand/tokens.json. canvas/surface/sidebar/ink/muted/accent are its five board colours —
// Obsidian, Surface, Frost, Muted, Teal — byte for byte; raised and label are its themed
// tokens of the same name, in both themes. Every other token carries its relationship to
// the board in __tests__/site-parity.test.ts, which fails if any of it drifts.
//
// ⚠ THE LIGHT THEME IS NOT YET THE BOARD'S, apart from raised and label. It was derived
// when the only reference was a dark-only site: the same blue undertone, the same accent
// hue darkened until it clears AA on a light field, and the same structure (the rail is
// the canvas, separated by a rule). B29.15 is the light pass.
//
// ── THE INVARIANT ────────────────────────────────────────────────────────────────────
//
// Text is never a hue. lens/lxc/tier*/settled/held/slashed land on affordances, 2px ticks,
// small pills and 4px bars — never on a text node. See README §"The invariant".
//
// ⚠ EVERY PAIR IS MEASURED. __tests__/contrast.test.ts scores every text token against
// every background (AA body, 4.5:1) and every affordance hue against every background
// (3:1). It was written before this palette landed and it was RED: the previous `faint`
// — the µ-tail under every money figure — measured 2.98:1 on the light canvas. Do not
// change a value here without running it.
export const tokens = {
  light: {
    canvas: '#F3F6FA', surface: '#FFFFFF', raised: '#FFFFFF', sidebar: '#F3F6FA',
    rule: 'rgba(11,18,32,.10)', 'rule-strong': 'rgba(11,18,32,.20)',
    ink: '#0B1220', muted: '#46586E', faint: '#5A6E85', label: '#646B79',
    accent: '#0F7A6C', 'accent-hover': '#0A5F54', 'accent-ink': '#FFFFFF', 'accent-tint': '#C9E6E0',
    lens: '#A85A2C', lxc: '#42688C',
    // The routing ramp is TWO CATEGORIES, not four: tier1 = cheap/fast (cool),
    // tier3 = capable/expensive (warm). Hue encodes category; see README §The ramp.
    tier1: '#3E8E9C', tier3: '#B07F38',
    settled: '#1D7A45', held: '#8A6A12', slashed: '#BF3B2E',
  },
  dark: {
    canvas: '#060A12', surface: '#081220', raised: '#0E1A2A', sidebar: '#081220',
    rule: 'rgba(156,196,224,.14)', 'rule-strong': 'rgba(156,196,224,.26)',
    ink: '#E6EEF7', muted: '#7E93AB', faint: '#6B7F96', label: '#90ACC0',
    accent: '#3AD6C0', 'accent-hover': '#55DFCC', 'accent-ink': '#060A12', 'accent-tint': '#0E2B2E',
    lens: '#D08A5C', lxc: '#7FA6CC',
    tier1: '#54B4C2', tier3: '#D6A85C',
    settled: '#45C77F', held: '#D6A93C', slashed: '#F0685C',
  },
} as const

export type TokenName = keyof typeof tokens.light
