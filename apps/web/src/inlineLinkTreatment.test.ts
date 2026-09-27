import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import { focusRing, inlineLink } from '@talyvor/ui'

// EVERY INLINE LINK TAKES ONE SHAPE — `inlineLink` in @talyvor/ui (B18.26, from W1.1.16).
//
// W1.1.16 measured five treatments shipping at once — no hover (the majority, and what the front
// page did), or a hover to ink, to muted, to accent, or of the underline alone — and this file
// pinned that census rather than pick one, because both obvious answers moved the console away from
// the front door. The answer taken is the third it recorded: give the front page's links the hover
// too, so "match the site" and "every state change moves" become the same shape.
//
// That shape is one exported class, not a copied string: the underline and its offset, a 200ms
// colour move to ink on hover, and the accent focus ring. Where a link sits still decides its
// colour and size. `@talyvor/ui` had a component for every control except this one, which is how
// each new screen ended up copying its neighbour.

const WEB = join(__dirname)
const UI = join(__dirname, '../../../packages/ui/src')

function sources(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '__tests__') continue
        walk(p)
        continue
      }
      if (!p.endsWith('.tsx')) continue
      if (p.includes('.test.')) continue
      out.push(p)
    }
  }
  walk(root)
  return out
}

interface Site {
  file: string
  tag: string
  cls: string
}

/** Every className in the product — a string, a template literal, or a `cn(…)` call — with its element. */
function classNames(): Site[] {
  const out: Site[] = []
  for (const root of [WEB, UI]) {
    for (const file of sources(root)) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{(cn\([^)]*\)|inlineLink)\})/g)) {
        const at = src.lastIndexOf('<', m.index)
        out.push({
          file: relative(join(__dirname, '../../..'), file),
          tag: /^<\s*([A-Za-z][\w.]*)/.exec(src.slice(at))?.[1] ?? '',
          cls: m[1] ?? m[2] ?? m[3] ?? '',
        })
      }
    }
  }
  return out
}

const isLink = (s: Site) => s.tag === 'a' || s.tag === 'Link'
const usesInlineLink = (s: Site) => /\binlineLink\b/.test(s.cls)

/** Underlines that are not links, each with what it is. Nothing else may carry `underline` itself. */
const NOT_LINKS: Record<string, string> = {
  'apps/web/src/areas/docs/pm.tsx': 'the Docs renderer’s underline MARK — text a writer underlined, not a link',
  'packages/ui/src/components/MuNumeral.tsx': 'the µ-tail of a numeral, underlined to set it apart from the whole units',
}

describe('every inline link in the product takes the one shape', () => {
  const all = classNames()
  const links = all.filter(isLink)

  // NON-VACUITY. A collector that finds nothing passes every assertion below.
  it('the collector finds the links, and they use inlineLink', () => {
    expect(links.filter(usesInlineLink).length).toBeGreaterThanOrEqual(65)
  })

  it('no link writes its own underline or hover — it takes inlineLink', () => {
    const own = links
      .filter((s) => !usesInlineLink(s) && /\b(underline|hover:\S+)/.test(s.cls))
      .map((s) => `${s.file}: <${s.tag} className="${s.cls}">`)
    expect(
      own,
      'these links write their own underline or hover. Five treatments shipped at once because ' +
        'each screen copied its neighbour; use `inlineLink` from @talyvor/ui (context classes such ' +
        'as colour and size go beside it).',
    ).toEqual([])
  })

  it('an underline that is not a link is one of the two named ones', () => {
    const others = all
      .filter((s) => !isLink(s) && !usesInlineLink(s) && /\bunderline\b/.test(s.cls))
      .map((s) => s.file)
    expect([...new Set(others)].sort()).toEqual(Object.keys(NOT_LINKS).sort())
  })

  it('the front page’s inline links take it too — the shape is the site’s, not only the console’s', () => {
    // (Its contact address is an <a> dressed as a Button — a control, not a link in prose.)
    const landing = links.filter((s) => s.file.endsWith('areas/marketing/Landing.tsx'))
    expect(landing.filter(usesInlineLink).length).toBeGreaterThanOrEqual(5)
    expect(landing.filter((s) => !usesInlineLink(s) && /\bunderline\b/.test(s.cls)).map((s) => s.cls)).toEqual([])
  })

  it('the shape is an underline, a 200ms colour move to ink on hover, and the accent focus ring', () => {
    const toks = inlineLink.split(/\s+/)
    for (const t of ['underline', 'underline-offset-2', 'transition-colors', 'duration-200', 'hover:text-ink']) {
      expect(toks).toContain(t)
    }
    expect(inlineLink).toContain(focusRing)
  })
})
