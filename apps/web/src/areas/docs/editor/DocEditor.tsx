import { Button, cn, focusRing } from '@talyvor/ui'
import { baseKeymap, chainCommands, exitCode, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands'
import { history, redo, undo } from 'prosemirror-history'
import { inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules'
import { keymap } from 'prosemirror-keymap'
import { Fragment, type MarkType, type Node as PMNode, type NodeType, Slice } from 'prosemirror-model'
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list'
import { type Command, EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import 'prosemirror-view/style/prosemirror.css'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

import { docsSchema } from './schema'

// THE DOCS EDITOR — B2.1. A single-writer ProseMirror editor over the Docs schema. It edits the
// canonical `content` JSON and nothing else; Docs derives `content_text` from it on save.
//
// It is UNCONTROLLED on purpose: `initial` is read once, at mount. Feeding every keystroke back
// through React state would rebuild the view and lose the caret. The parent keys this component
// by page, so a different page is a fresh mount.

const s = docsSchema

/** A stored `content` string to a document. Unreadable is reported, never thrown. */
export function docFromStored(content: string | undefined, fallbackText: string): { doc: PMNode; unreadable: boolean } {
  const raw = (content ?? '').trim()
  // `{}` is what Docs stores for a page created with no content.
  if (raw === '' || raw === '{}') return { doc: textDoc(fallbackText), unreadable: false }
  try {
    const doc = s.nodeFromJSON(JSON.parse(raw))
    doc.check()
    return { doc, unreadable: false }
  } catch {
    return { doc: textDoc(fallbackText), unreadable: true }
  }
}

/** Plain text to one paragraph per line. */
export function textDoc(text: string): PMNode {
  const lines = text === '' ? [''] : text.split(/\r?\n/)
  return s.node(
    'doc',
    null,
    lines.map((l) => s.node('paragraph', null, l === '' ? [] : [s.text(l)])),
  )
}

function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection
  if (empty) return Boolean(type.isInSet(state.storedMarks ?? $from.marks()))
  return state.doc.rangeHasMark(from, to, type)
}

function blockActive(state: EditorState, type: NodeType, attrs?: Record<string, unknown>): boolean {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type === type) {
      return attrs === undefined || Object.entries(attrs).every(([k, v]) => node.attrs[k] === v)
    }
  }
  return false
}

/** Markdown-style shortcuts: `# `, `## `, `- `, `1. `, `> `, three backticks. */
function shortcuts() {
  return inputRules({
    rules: [
      textblockTypeInputRule(/^(#{1,3})\s$/, s.nodes.heading, (m) => ({ level: m[1].length })),
      wrappingInputRule(/^\s*([-+*])\s$/, s.nodes.bullet_list),
      wrappingInputRule(
        /^(\d+)\.\s$/,
        s.nodes.ordered_list,
        (m) => ({ order: +m[1] }),
        (m, node) => node.childCount + node.attrs.order === +m[1],
      ),
      wrappingInputRule(/^\s*>\s$/, s.nodes.blockquote),
      textblockTypeInputRule(/^```$/, s.nodes.code_block),
    ],
  })
}

export interface DocEditorHandle {
  focus: () => void
}

/** The non-empty selection, as plain text, with the positions it was read at. */
export interface EditorSelection {
  from: number
  to: number
  text: string
}

/** What a slot below the toolbar may do to the document (B2.3's AI on the selection). */
export interface SelectionControls {
  selection: EditorSelection | null
  /** Where the caret is — Write with AI inserts below it. */
  cursor: number | null
  /** The whole document as plain text, for context. */
  docText: string
  /** Puts new text where the selection was. REFUSED (false) when those positions no longer hold
   *  the selected words, so a suggestion never overwrites words it was not written for. */
  replace: (sel: EditorSelection, text: string) => boolean
  /** Adds new text, as paragraphs, after the block the selection ends in. */
  insertAfter: (sel: EditorSelection, text: string) => boolean
}

/** Model text to paragraphs: one per non-empty line. */
function paragraphs(text: string): PMNode[] {
  return text
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((l) => s.node('paragraph', null, [s.text(l)]))
}

function replaceSelection(view: EditorView | null, sel: EditorSelection, text: string): boolean {
  if (view === null) return false
  const doc = view.state.doc
  if (sel.to > doc.content.size || doc.textBetween(sel.from, sel.to, '\n') !== sel.text) return false
  const nodes = paragraphs(text)
  if (nodes.length < 1) return false
  // Open on both sides, so the first and last paragraphs join the text around the selection.
  view.dispatch(view.state.tr.replaceRange(sel.from, sel.to, new Slice(Fragment.from(nodes), 1, 1)))
  view.focus()
  return true
}

function insertAfterSelection(view: EditorView | null, sel: EditorSelection, text: string): boolean {
  if (view === null) return false
  const doc = view.state.doc
  const nodes = paragraphs(text)
  if (nodes.length < 1 || sel.to > doc.content.size) return false
  view.dispatch(view.state.tr.insert(doc.resolve(sel.to).after(1), nodes))
  view.focus()
  return true
}

export interface DocEditorProps {
  initial: PMNode
  /** Called with the new document on every change. */
  onChange: (doc: PMNode) => void
  /** Mod-S. */
  onSave: () => void
  /** The accessible name of the writing surface. */
  label: string
  /** Pinned at the toolbar's end, so it stays in view while writing (B2.2's cost readout). */
  aside?: React.ReactNode
  /** Rendered under the toolbar, inside its sticky band, with the selection and what may be done
   *  to it. Re-rendered on every transaction. */
  below?: (controls: SelectionControls) => React.ReactNode
}

export const DocEditor = forwardRef<DocEditorHandle, DocEditorProps>(function DocEditor(
  { initial, onChange, onSave, label, aside, below },
  ref,
) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // The toolbar reads the view's state; this re-renders it after each transaction.
  const [, setTick] = useState(0)
  // The latest callbacks, read by the view without rebuilding it.
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  onChangeRef.current = onChange
  onSaveRef.current = onSave

  useImperativeHandle(ref, () => ({ focus: () => viewRef.current?.focus() }), [])

  useEffect(() => {
    if (host.current === null) return
    const save: Command = () => {
      onSaveRef.current()
      return true
    }
    const state = EditorState.create({
      doc: initial,
      plugins: [
        shortcuts(),
        history(),
        keymap({
          'Mod-z': undo,
          'Shift-Mod-z': redo,
          'Mod-y': redo,
          'Mod-b': toggleMark(s.marks.strong),
          'Mod-i': toggleMark(s.marks.em),
          'Mod-`': toggleMark(s.marks.code),
          'Mod-s': save,
          Enter: splitListItem(s.nodes.list_item),
          Tab: sinkListItem(s.nodes.list_item),
          'Shift-Tab': liftListItem(s.nodes.list_item),
          'Shift-Enter': chainCommands(exitCode, (st, dispatch) => {
            dispatch?.(st.tr.replaceSelectionWith(s.nodes.hard_break.create()).scrollIntoView())
            return true
          }),
        }),
        keymap(baseKeymap),
      ],
    })
    const view = new EditorView(host.current, {
      state,
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        // The ring is on the contenteditable, because that is the element that takes focus.
        class: cn('flex min-h-60 flex-col gap-3 rounded-b-control px-4 py-3 text-body text-ink', focusRing),
      },
      dispatchTransaction(tr) {
        const next = view.state.apply(tr)
        view.updateState(next)
        if (tr.docChanged) onChangeRef.current(next.doc)
        setTick((t) => t + 1)
      },
    })
    viewRef.current = view
    // The toolbar and the slot below it read the view during render, and the view only exists
    // from here — so render once more now, or they read nothing until the first keystroke.
    setTick((t) => t + 1)
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Read once, at mount — see the file header. The parent re-keys this on a new page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = (cmd: Command) => {
    const view = viewRef.current
    if (view === null) return
    cmd(view.state, view.dispatch, view)
    view.focus()
  }
  const state = viewRef.current?.state

  const selection: EditorSelection | null =
    state === undefined || state.selection.empty
      ? null
      : {
          from: state.selection.from,
          to: state.selection.to,
          text: state.doc.textBetween(state.selection.from, state.selection.to, '\n'),
        }
  const controls: SelectionControls = {
    selection,
    cursor: state === undefined ? null : state.selection.head,
    docText: state === undefined ? '' : state.doc.textBetween(0, state.doc.content.size, '\n'),
    replace: (sel, text) => replaceSelection(viewRef.current, sel, text),
    insertAfter: (sel, text) => insertAfterSelection(viewRef.current, sel, text),
  }

  const tools: Array<{ name: string; active: boolean; cmd: Command }> = [
    { name: 'Bold', active: state ? markActive(state, s.marks.strong) : false, cmd: toggleMark(s.marks.strong) },
    { name: 'Italic', active: state ? markActive(state, s.marks.em) : false, cmd: toggleMark(s.marks.em) },
    {
      name: 'Heading',
      active: state ? blockActive(state, s.nodes.heading, { level: 2 }) : false,
      cmd: (st, d) =>
        blockActive(st, s.nodes.heading, { level: 2 })
          ? setBlockType(s.nodes.paragraph)(st, d)
          : setBlockType(s.nodes.heading, { level: 2 })(st, d),
    },
    { name: 'List', active: state ? blockActive(state, s.nodes.bullet_list) : false, cmd: wrapInList(s.nodes.bullet_list) },
    {
      name: 'Numbered list',
      active: state ? blockActive(state, s.nodes.ordered_list) : false,
      cmd: wrapInList(s.nodes.ordered_list),
    },
    { name: 'Quote', active: state ? blockActive(state, s.nodes.blockquote) : false, cmd: wrapIn(s.nodes.blockquote) },
    {
      name: 'Code',
      active: state ? blockActive(state, s.nodes.code_block) : false,
      cmd: (st, d) =>
        blockActive(st, s.nodes.code_block)
          ? setBlockType(s.nodes.paragraph)(st, d)
          : setBlockType(s.nodes.code_block)(st, d),
    },
  ]

  return (
    <div className="rounded-control border border-rule bg-surface transition-colors duration-200 hover:border-rule-strong">
      {/* Sticky, so the toolbar — and what is pinned in it — stays in view down a long page.
          `top-12` is the shell's sticky header (a 32px control + py-2), so the two stack rather
          than overlap. `z-10` is needed over the text: ProseMirror's stylesheet positions the editable
          relatively, which would otherwise paint the page's words across the toolbar. */}
      <div className="sticky top-12 z-10 flex flex-wrap items-center gap-1 rounded-t-control border-b border-rule bg-surface px-2 py-2">
        <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Formatting">
          {tools.map((t) => (
            <Button
              key={t.name}
              aria-pressed={t.active}
              className={t.active ? 'bg-accent-tint' : undefined}
              // Keeps the caret in the document: a click that moved focus to the button would
              // apply the command to a selection the reader can no longer see.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(t.cmd)}
            >
              {t.name}
            </Button>
          ))}
        </div>
        {aside !== undefined ? <div className="ml-auto pl-2">{aside}</div> : null}
        {below !== undefined ? <div className="basis-full">{below(controls)}</div> : null}
      </div>
      <div ref={host} />
    </div>
  )
})
