import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'

import { useTheme } from '@talyvor/ui'

// B28.134 — what a reply draws beyond text: highlighted code, formulas and diagrams.
//
// ⚠ STILL NO HTML FROM THE ANSWER. Highlighting is lowlight's syntax tree turned into React spans. A
// formula is built by KaTeX itself, node by node, with `trust` off, so \href, \url and \htmlClass are
// refused rather than drawn as links or attributes. A diagram is the one place markup reaches the page:
// Mermaid draws it at its strict level, which escapes labels and drops click handlers, with its labels
// as SVG text and every %%{…}%% directive and front-matter config taken out first, so its settings are
// only ours: Mermaid puts the SVG in the page for a moment to measure it, before anything below sees it.
// The SVG then passes DOMPurify's SVG profile and keeps no link, no url() that points outside itself and
// no CSS rule outside its own id: a diagram an answer was steered into writing can load nothing, so it
// can send nothing anywhere.
//
// Each library is fetched the first time an answer needs it, so Chat's own bundle does not carry it.
// Until it arrives, or if it never does, the source shows as written.

/** A module fetched once, the first time a component asks for it: undefined until it is in. */
function lazy<T>(load: () => Promise<T>): () => T | undefined {
  let value: T | undefined
  let pending: Promise<T> | undefined
  return function useLoaded() {
    const [, loaded] = useReducer((n: number) => n + 1, 0)
    useEffect(() => {
      if (value !== undefined) return
      pending ??= load().then((v) => (value = v))
      let live = true
      pending.then(
        () => {
          if (live) loaded()
        },
        () => undefined,
      )
      return () => {
        live = false
      }
    }, [])
    return value
  }
}

const useLowlight = lazy(() => import('lowlight').then(({ common, createLowlight }) => createLowlight(common)))
const useKatex = lazy(() => import('./katex').then((m) => m.default))

/** The few hast shapes lowlight returns. */
interface Hast {
  type: string
  value?: string
  properties?: { className?: unknown }
  children?: Hast[]
}

// Only the brand's text colours: keywords in the accent, strings and numbers in label, comments muted.
const TOKEN: Record<string, string> = {
  keyword: 'text-accent',
  built_in: 'text-accent',
  literal: 'text-accent',
  type: 'text-accent',
  name: 'text-accent',
  'selector-tag': 'text-accent',
  'template-tag': 'text-accent',
  addition: 'text-accent',
  section: 'font-semibold text-accent',
  string: 'text-label',
  regexp: 'text-label',
  number: 'font-figure text-label',
  symbol: 'text-label',
  char: 'text-label',
  bullet: 'text-label',
  link: 'text-label',
  'selector-id': 'text-label',
  'selector-class': 'text-label',
  comment: 'italic text-muted',
  quote: 'italic text-muted',
  doctag: 'text-muted',
  meta: 'text-muted',
  deletion: 'text-muted line-through',
  title: 'font-semibold',
  strong: 'font-semibold',
  emphasis: 'italic',
}

function tokenClass(className: unknown): string | undefined {
  const first = Array.isArray(className) ? String(className[0] ?? '') : ''
  return TOKEN[first.replace(/^hljs-/, '')]
}

function fromTree(nodes: Hast[], key: string): ReactNode[] {
  return nodes.map((n, i) =>
    n.type === 'text' ? (
      (n.value ?? '')
    ) : n.type === 'element' ? (
      <span key={`${key}.${i}`} className={tokenClass(n.properties?.className)}>
        {fromTree(n.children ?? [], `${key}.${i}`)}
      </span>
    ) : null,
  )
}

/** A code block's text, highlighted for its language once lowlight is in; as written for a language it does not know. */
export function Highlighted({ lang, code }: { lang: string; code: string }) {
  const lowlight = useLowlight()
  const name = lang.toLowerCase()
  const tree = useMemo(() => {
    if (lowlight === undefined || !lowlight.registered(name)) return undefined
    try {
      return lowlight.highlight(name, code).children as unknown as Hast[]
    } catch {
      return undefined
    }
  }, [lowlight, name, code])
  return <>{tree === undefined ? code : fromTree(tree, 'hl')}</>
}

/**
 * A LaTeX formula, inline or on a line of its own. KaTeX owns the span's children, so React never
 * renders any: before KaTeX is in, and for TeX it refuses, the span holds the source as written.
 */
export function TexMath({ tex, display = false }: { tex: string; display?: boolean }) {
  const katex = useKatex()
  const ref = useRef<HTMLSpanElement>(null)
  const [refused, setRefused] = useState(false)
  useLayoutEffect(() => {
    const host = ref.current
    if (host === null) return
    if (katex !== undefined) {
      try {
        katex.render(tex, host, { displayMode: display, throwOnError: true, trust: false, strict: 'ignore', maxSize: 20, maxExpand: 500 })
        setRefused(false)
        return
      } catch {
        setRefused(true)
      }
    }
    host.textContent = display ? `$$${tex}$$` : `$${tex}$`
  }, [katex, tex, display])
  const raw = katex === undefined || refused
  const shape = display ? 'block overflow-x-auto overflow-y-hidden py-1' : ''
  return <span ref={ref} data-testid="math" className={raw ? `${shape} font-mono text-muted` : shape} />
}

let diagrams = 0

/** Mermaid's SVG for `code` in this theme's colours, sanitised again; null when Mermaid cannot read it. */
async function drawDiagram(code: string, host: HTMLElement, dark: boolean): Promise<DocumentFragment | null> {
  const [{ default: mermaid }, { default: DOMPurify }] = await Promise.all([import('mermaid'), import('dompurify')])
  const css = getComputedStyle(host)
  const token = (name: string) => css.getPropertyValue(`--${name}`).trim()
  const font = token('sans')
  const series = ['accent', 'lxc', 'tier3', 'label', 'tier1', 'lens', 'muted', 'faint'].map(token)
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'theme', 'themeCSS', 'themeVariables', 'fontFamily', 'htmlLabels', 'darkMode', 'dompurifyConfig'],
    htmlLabels: false,
    theme: 'base',
    fontFamily: font,
    themeVariables: {
      darkMode: dark,
      fontFamily: font,
      fontSize: '14px',
      background: token('raised'),
      primaryColor: token('accent-tint'),
      primaryBorderColor: token('accent'),
      primaryTextColor: token('ink'),
      secondaryColor: token('surface'),
      secondaryBorderColor: token('faint'),
      secondaryTextColor: token('ink'),
      tertiaryColor: token('canvas'),
      tertiaryBorderColor: token('faint'),
      tertiaryTextColor: token('ink'),
      mainBkg: token('accent-tint'),
      nodeBorder: token('accent'),
      lineColor: token('muted'),
      textColor: token('ink'),
      titleColor: token('ink'),
      edgeLabelBackground: token('raised'),
      clusterBkg: token('surface'),
      clusterBorder: token('faint'),
      noteBkgColor: token('surface'),
      noteTextColor: token('ink'),
      noteBorderColor: token('faint'),
      actorBkg: token('accent-tint'),
      actorBorder: token('accent'),
      actorTextColor: token('ink'),
      actorLineColor: token('muted'),
      signalColor: token('ink'),
      signalTextColor: token('ink'),
      labelBoxBkgColor: token('surface'),
      labelBoxBorderColor: token('faint'),
      labelTextColor: token('ink'),
      loopTextColor: token('ink'),
      activationBkgColor: token('surface'),
      activationBorderColor: token('accent'),
      pieStrokeColor: token('raised'),
      pieOuterStrokeColor: token('faint'),
      pieTitleTextColor: token('ink'),
      pieLegendTextColor: token('ink'),
      pieSectionTextColor: token('canvas'),
      ...Object.fromEntries(series.flatMap((c, i) => [[`pie${i + 1}`, c], [`pie${i + 9}`, c]])),
    },
  })
  const source = withoutConfig(code)
  if ((await mermaid.parse(source, { suppressErrors: true })) === false) return null
  const id = `tv-diagram-${++diagrams}`
  const { svg } = await mermaid.render(id, source)
  const drawn = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['a', 'image', 'foreignObject'],
    RETURN_DOM_FRAGMENT: true,
  })
  for (const el of Array.from(drawn.querySelectorAll('*'))) {
    if (el.localName === 'style') el.textContent = insideOnly(el.textContent ?? '', id)
    if (el instanceof SVGElement || el instanceof HTMLElement) {
      for (const prop of Array.from(el.style)) if (fetches(el.style.getPropertyValue(prop)) || prop.startsWith('--')) el.style.removeProperty(prop)
    }
    for (const { name, value } of Array.from(el.attributes)) {
      if (name === 'style') {
        if (el.getAttribute('style')?.trim() === '') el.removeAttribute(name)
      } else if (/^(xlink:)?href$|^src$/i.test(name) ? !value.startsWith('#') : fetches(value)) {
        el.removeAttribute(name)
      }
    }
  }
  return drawn
}

/**
 * Could this CSS value fetch something? Read after the browser has parsed it, so an escape cannot hide a
 * function; a backslash left over, a custom property or var() (which could bring a url() in later) count.
 */
function fetches(value: string): boolean {
  const rest = value.replace(/url\(\s*["']?#[^)]*\)/gi, '')
  return rest.includes('\\') || /\b(url|image-set|image|cross-fade|element|src|var|attr|paint)\s*\(/i.test(rest)
}

/**
 * A stylesheet as the browser parses it, on a sheet no document uses, which loads nothing: each plain
 * rule on the diagram's own id, rebuilt from its selector and the declarations that cannot fetch. Nested
 * rules, @import, @font-face and every other at-rule are dropped, and where the browser cannot parse a
 * sheet this way, so is all of it.
 */
function insideOnly(css: string, id: string): string {
  if (typeof CSSStyleSheet === 'undefined' || typeof CSSStyleSheet.prototype.replaceSync !== 'function') return ''
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  const kept: string[] = []
  for (const rule of Array.from(sheet.cssRules)) {
    if (!(rule instanceof CSSStyleRule) || !rule.selectorText.split(',').every((sel) => sel.trim().startsWith(`#${id}`))) continue
    for (const prop of Array.from(rule.style)) if (fetches(rule.style.getPropertyValue(prop)) || prop.startsWith('--')) rule.style.removeProperty(prop)
    kept.push(`${rule.selectorText}{${rule.style.cssText}}`)
  }
  return kept.join('\n')
}

/**
 * The diagram without its settings: every %%{…}%% directive (to the end, if one is never closed) and the
 * front matter's config, keeping only its title.
 */
function withoutConfig(code: string): string {
  const body = code.replace(/%%\{[\s\S]*?(\}%%|$)/g, '')
  const front = /^\s*-{3}[^\S\r\n]*\r?\n([\s\S]*?)\r?\n-{3}[^\S\r\n]*(\r?\n|$)/.exec(body)
  if (front === null) return body
  const title = /^title:[^\S\r\n]*(.+)$/m.exec(front[1])
  return (title === null ? '' : `---\ntitle: ${JSON.stringify(title[1].trim())}\n---\n`) + body.slice(front[0].length)
}

/** A Mermaid diagram, drawn in the theme in use; `source` stands in for it when Mermaid cannot read it. */
export function Diagram({ code, source }: { code: string; source: ReactNode }) {
  const theme = useTheme((s) => s.theme)
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'drawing' | 'drawn' | 'unreadable'>('drawing')
  useEffect(() => {
    const host = ref.current
    if (host === null) return
    let live = true
    drawDiagram(code, host, theme === 'dark').then(
      (svg) => {
        if (!live) return
        if (svg === null) return setState('unreadable')
        host.replaceChildren(svg)
        setState('drawn')
      },
      () => {
        if (live) setState('unreadable')
      },
    )
    return () => {
      live = false
    }
  }, [code, theme])
  if (state === 'unreadable') {
    return (
      <>
        <p className="px-3 pt-3 text-body text-muted">This diagram couldn’t be drawn. Its code:</p>
        {source}
      </>
    )
  }
  return (
    <>
      {state === 'drawing' ? <p className="px-3 pt-3 text-body text-muted">Drawing the diagram…</p> : null}
      <div ref={ref} data-testid="diagram" className="flex justify-center overflow-x-auto px-3 py-3" />
    </>
  )
}
