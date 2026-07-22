// Read-only renderer for the stored page content: ProseMirror doc JSON → React.
// The node/mark set mirrors the discarded frontend's schema EXACTLY
// (talyvor-docs frontend/src/components/editor/schema.ts @ e0cf605): nodes
// paragraph · heading · blockquote · horizontal_rule · code_block · image ·
// hard_break · bullet_list · ordered_list · list_item; marks link · em · strong ·
// underline · strike · code · highlight. No table/task nodes exist upstream.
//
// This is deliberately NOT a ProseMirror runtime — reading needs no contenteditable,
// no schema object, no transactions; a recursive component over the JSON tree
// renders every stored page. An unknown node type renders as a visible chip (never
// silently dropped): the store does not validate content, so the reader must degrade
// loudly, not lie by omission. The editor question is separate — see EDITOR-SIZING.md.

interface PMMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  marks?: PMMark[]
  text?: string
}

function MarkedText({ node }: { node: PMNode }) {
  let out: React.ReactNode = node.text ?? ''
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'strong':
        out = <strong className="font-semibold">{out}</strong>
        break
      case 'em':
        out = <em>{out}</em>
        break
      case 'code':
        out = <code className="rounded bg-sidebar px-1 font-mono">{out}</code>
        break
      case 'underline':
        out = <span className="underline">{out}</span>
        break
      case 'strike':
        out = <span className="line-through">{out}</span>
        break
      case 'highlight':
        // A background wash, never a text hue — the glyphs stay ink.
        out = <span className="rounded bg-sidebar px-1">{out}</span>
        break
      case 'link': {
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '#'
        const external = href.startsWith('http')
        out = (
          <a
            href={href}
            title={typeof mark.attrs?.title === 'string' ? mark.attrs.title : undefined}
            target={external ? '_blank' : undefined}
            rel={external ? 'noreferrer' : undefined}
            className="underline decoration-rule-strong underline-offset-2 hover:decoration-accent"
          >
            {out}
          </a>
        )
        break
      }
      default:
        // Unknown mark: keep the text, skip the decoration.
        break
    }
  }
  return <>{out}</>
}

function Children({ nodes }: { nodes?: PMNode[] }) {
  if (!nodes?.length) return null
  return (
    <>
      {nodes.map((n, i) => (
        <PMNodeView key={i} node={n} />
      ))}
    </>
  )
}

const headingClass: Record<number, string> = {
  1: 'text-title text-ink',
  2: 'text-head text-ink',
  3: 'text-body font-semibold text-ink',
}

function PMNodeView({ node }: { node: PMNode }) {
  switch (node.type) {
    case 'text':
      return <MarkedText node={node} />
    case 'paragraph':
      return (
        <p className="text-body text-ink">
          <Children nodes={node.content} />
        </p>
      )
    case 'heading': {
      const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1
      const Tag = (level <= 1 ? 'h1' : level === 2 ? 'h2' : 'h3') as 'h1' | 'h2' | 'h3'
      return (
        <Tag className={headingClass[Math.min(level, 3)]}>
          <Children nodes={node.content} />
        </Tag>
      )
    }
    case 'blockquote':
      return (
        <blockquote className="flex flex-col gap-2 border-l-2 border-rule-strong pl-3 text-muted">
          <Children nodes={node.content} />
        </blockquote>
      )
    case 'horizontal_rule':
      return <hr className="border-t border-rule" />
    case 'code_block': {
      const lang = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
      return (
        <div className="overflow-hidden rounded-control border border-rule bg-sidebar">
          {lang ? (
            <div className="border-b border-rule px-3 py-1 text-caption uppercase tracking-wide text-faint">{lang}</div>
          ) : null}
          <pre className="overflow-x-auto px-3 py-2 font-mono text-body text-ink">
            <Children nodes={node.content} />
          </pre>
        </div>
      )
    }
    case 'image': {
      const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
      if (!src) return null
      return <img src={src} alt={alt} className="max-w-full rounded-control border border-rule" />
    }
    case 'hard_break':
      return <br />
    case 'bullet_list':
      return (
        <ul className="ml-5 flex list-disc flex-col gap-1">
          <Children nodes={node.content} />
        </ul>
      )
    case 'ordered_list':
      return (
        <ol
          className="ml-5 flex list-decimal flex-col gap-1"
          start={typeof node.attrs?.order === 'number' ? node.attrs.order : undefined}
        >
          <Children nodes={node.content} />
        </ol>
      )
    case 'list_item':
      return (
        <li className="text-body text-ink">
          <div className="flex flex-col gap-1">
            <Children nodes={node.content} />
          </div>
        </li>
      )
    default:
      return (
        <span className="inline-flex h-5 items-center rounded-pill border border-rule bg-canvas px-2 text-caption uppercase tracking-wide text-muted">
          unsupported block: {node.type}
        </span>
      )
  }
}

/** Renders the string-encoded ProseMirror doc a page row carries. Invalid JSON is an
 *  honest error panel, not a blank page — the store never validates content. */
export function PMDoc({ content }: { content: string }) {
  let doc: PMNode
  try {
    doc = JSON.parse(content) as PMNode
  } catch {
    return <div className="text-body text-muted">This page’s stored content is not valid JSON.</div>
  }
  if (doc?.type !== 'doc' || !Array.isArray(doc.content)) {
    return <div className="text-body text-muted">This page’s stored content is not a ProseMirror document.</div>
  }
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <Children nodes={doc.content} />
    </div>
  )
}
