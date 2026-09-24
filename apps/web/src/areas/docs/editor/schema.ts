import { type MarkSpec, type NodeSpec, Schema } from 'prosemirror-model'

// THE DOCS DOCUMENT SCHEMA — B2.1. Ported node-for-node from talyvor-docs
// `frontend/src/components/editor/schema.ts` (the discarded Docs frontend, read at `e0cf605`).
//
// ⚠ EVERY NODE IS PORTED, INCLUDING THE ONES THIS EDITOR CANNOT INSERT. Docs never parses
// `pages.content` — "servers ship without a ProseMirror runtime" (its ot.go) — so this file IS the
// contract for what a stored document may contain. `Node.fromJSON` throws on a node type the
// schema does not know, and an editor that could not open a page holding a callout or an issue
// embed would be worse than the textarea it replaces. Atoms render as labelled placeholders and
// survive a save untouched.
//
// The one deliberate difference from the original is `toDOM`'s classes, which are ../pm.tsx's — so
// a page reads the same in the editor as in the renderer. toDOM decides nothing about the stored
// JSON.

const headingClass: Record<number, string> = {
  1: 'text-title text-ink',
  2: 'text-head text-ink',
  3: 'text-body font-semibold text-ink',
}
const listClass = 'ml-5 flex flex-col gap-1'
const placeholderClass = 'rounded-control border border-rule bg-canvas px-2 text-caption text-muted'

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },

  paragraph: {
    content: 'inline*',
    group: 'block',
    parseDOM: [{ tag: 'p' }],
    toDOM: () => ['p', { class: 'text-body text-ink' }, 0],
  },

  blockquote: {
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: () => ['blockquote', { class: 'flex flex-col gap-2 border-l-2 border-rule-strong pl-3 text-muted' }, 0],
  },

  horizontal_rule: {
    group: 'block',
    parseDOM: [{ tag: 'hr' }],
    toDOM: () => ['hr', { class: 'border-t border-rule' }],
  },

  heading: {
    attrs: { level: { default: 1 } },
    content: 'inline*',
    group: 'block',
    defining: true,
    parseDOM: [
      { tag: 'h1', attrs: { level: 1 } },
      { tag: 'h2', attrs: { level: 2 } },
      { tag: 'h3', attrs: { level: 3 } },
    ],
    toDOM: (node) => [
      `h${node.attrs.level}`,
      { class: headingClass[Math.min(Number(node.attrs.level) || 1, 3)] },
      0,
    ],
  },

  code_block: {
    attrs: { language: { default: '' } },
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    defining: true,
    parseDOM: [
      {
        tag: 'pre',
        preserveWhitespace: 'full',
        getAttrs: (n) => ({ language: (n as HTMLElement).getAttribute('data-language') ?? '' }),
      },
    ],
    toDOM: (node) => [
      'pre',
      {
        'data-language': node.attrs.language,
        class: 'overflow-x-auto rounded-control border border-rule bg-sidebar px-3 py-2 font-mono text-body text-ink',
      },
      ['code', 0],
    ],
  },

  text: { group: 'inline' },

  image: {
    inline: true,
    group: 'inline',
    draggable: true,
    attrs: { src: {}, alt: { default: '' }, title: { default: '' } },
    parseDOM: [
      {
        tag: 'img[src]',
        getAttrs: (n) => {
          const el = n as HTMLImageElement
          return {
            src: el.getAttribute('src') ?? '',
            alt: el.getAttribute('alt') ?? '',
            title: el.getAttribute('title') ?? '',
          }
        },
      },
    ],
    toDOM: (node) => [
      'img',
      {
        src: node.attrs.src,
        alt: node.attrs.alt,
        title: node.attrs.title,
        class: 'max-w-full rounded-control border border-rule',
      },
    ],
  },

  hard_break: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM: () => ['br'],
  },

  ordered_list: {
    content: 'list_item+',
    group: 'block',
    attrs: { order: { default: 1 } },
    parseDOM: [
      {
        tag: 'ol',
        getAttrs: (n) => {
          const start = (n as HTMLOListElement).getAttribute('start')
          return { order: start ? +start : 1 }
        },
      },
    ],
    toDOM: (node) =>
      node.attrs.order === 1
        ? ['ol', { class: `${listClass} list-decimal` }, 0]
        : ['ol', { start: node.attrs.order, class: `${listClass} list-decimal` }, 0],
  },

  bullet_list: {
    content: 'list_item+',
    group: 'block',
    parseDOM: [{ tag: 'ul' }],
    toDOM: () => ['ul', { class: `${listClass} list-disc` }, 0],
  },

  list_item: {
    content: 'paragraph block*',
    defining: true,
    attrs: { checked: { default: null } },
    parseDOM: [
      {
        tag: 'li',
        getAttrs: (n) => {
          const c = (n as HTMLElement).getAttribute('data-checked')
          return c === null ? {} : { checked: c === 'true' }
        },
      },
    ],
    toDOM: (node) =>
      node.attrs.checked === null
        ? ['li', { class: 'text-body text-ink' }, 0]
        : ['li', { class: 'text-body text-ink', 'data-checked': String(node.attrs.checked) }, 0],
  },

  callout: {
    content: 'block+',
    group: 'block',
    defining: true,
    attrs: { tone: { default: 'info' } },
    // Marked by a data attribute rather than the original's `callout` class, which styles nothing
    // here; `div.callout` still parses, for HTML pasted from the old frontend.
    parseDOM: ['div[data-callout]', 'div.callout'].map((tag) => ({
      tag,
      getAttrs: (n: string | HTMLElement) => ({ tone: (n as HTMLElement).getAttribute('data-tone') ?? 'info' }),
    })),
    toDOM: (node) => [
      'div',
      {
        class: 'flex flex-col gap-2 rounded-control border border-rule bg-sidebar px-3 py-2',
        'data-callout': '',
        'data-tone': node.attrs.tone,
      },
      0,
    ],
  },

  issue_embed: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: { issue_id: {}, identifier: { default: '' }, title: { default: '' } },
    parseDOM: [
      {
        tag: 'span.issue-embed',
        getAttrs: (n) => {
          const el = n as HTMLElement
          return {
            issue_id: el.getAttribute('data-issue') ?? '',
            identifier: el.getAttribute('data-identifier') ?? '',
            title: el.getAttribute('data-title') ?? '',
          }
        },
      },
    ],
    toDOM: (node) => [
      'span',
      {
        class: `issue-embed ${placeholderClass}`,
        'data-issue': node.attrs.issue_id,
        'data-identifier': node.attrs.identifier,
        'data-title': node.attrs.title,
      },
      node.attrs.identifier || node.attrs.issue_id,
    ],
  },

  toc_block: {
    group: 'block',
    atom: true,
    selectable: true,
    attrs: {},
    parseDOM: [{ tag: 'div.toc-block' }],
    toDOM: () => ['div', { class: `toc-block ${placeholderClass}` }, 'Table of contents'],
  },

  database_block: {
    group: 'block',
    atom: true,
    selectable: true,
    attrs: { database_id: { default: '' } },
    parseDOM: [
      {
        tag: 'div.database-block',
        getAttrs: (n) => ({ database_id: (n as HTMLElement).getAttribute('data-database') ?? '' }),
      },
    ],
    toDOM: (node) => [
      'div',
      { class: `database-block ${placeholderClass}`, 'data-database': node.attrs.database_id },
      'Database',
    ],
  },
}

const marks: Record<string, MarkSpec> = {
  link: {
    attrs: { href: {}, title: { default: null } },
    inclusive: false,
    parseDOM: [
      {
        tag: 'a[href]',
        getAttrs: (n) => {
          const el = n as HTMLAnchorElement
          return { href: el.getAttribute('href') ?? '', title: el.getAttribute('title') }
        },
      },
    ],
    toDOM: (mark) => [
      'a',
      {
        href: mark.attrs.href,
        title: mark.attrs.title,
        rel: 'noopener noreferrer',
        target: '_blank',
        class: 'underline decoration-rule-strong underline-offset-2',
      },
      0,
    ],
  },
  em: {
    parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
    toDOM: () => ['em', 0],
  },
  strong: {
    parseDOM: [
      { tag: 'strong' },
      { tag: 'b', getAttrs: (n) => (n as HTMLElement).style.fontWeight !== 'normal' && null },
      { style: 'font-weight=bold' },
    ],
    toDOM: () => ['strong', { class: 'font-semibold' }, 0],
  },
  underline: {
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
    toDOM: () => ['u', { class: 'underline' }, 0],
  },
  strike: {
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
    toDOM: () => ['s', { class: 'line-through' }, 0],
  },
  code: {
    parseDOM: [{ tag: 'code' }],
    toDOM: () => ['code', { class: 'rounded-control bg-sidebar px-1 font-mono' }, 0],
  },
  highlight: {
    parseDOM: [{ tag: 'mark' }],
    toDOM: () => ['mark', { class: 'rounded-control bg-sidebar px-1 text-ink' }, 0],
  },
}

export const docsSchema = new Schema({ nodes, marks })
