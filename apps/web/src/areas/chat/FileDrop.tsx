import { useRef, useState, type DragEvent } from 'react'

/** B28.130 — whether a drag carries files, not words or a link dragged from the page. */
function carriesFiles(dt: DataTransfer | null): boolean {
  return dt !== null && Array.from(dt.types).includes('Files')
}

/**
 * B28.130 — files dragged onto the chat. While they are over it `dragging` is true and the overlay shows; dropped,
 * they go to `onFiles` as Attach sends them. A drag of words or a link is left to the browser, so text still drops
 * into the box. While Attach is disabled a dropped file is refused, never opened by the browser in place of the chat.
 */
export function useFileDrop(onFiles: (files: File[]) => void, disabled: boolean) {
  // dragenter and dragleave fire for every child the pointer crosses: counted, the overlay does not flicker.
  const depth = useRef(0)
  const [over, setOver] = useState(false)
  const handlers = {
    onDragEnter: (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return
      e.preventDefault()
      depth.current++
      setOver(true)
    },
    onDragOver: (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
    },
    onDragLeave: (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setOver(false)
    },
    onDrop: (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return
      e.preventDefault()
      depth.current = 0
      setOver(false)
      const files = Array.from(e.dataTransfer.files)
      if (!disabled && files.length > 0) onFiles(files)
    },
  }
  return { dragging: over && !disabled, handlers }
}

/**
 * B28.130 — the files a paste carries, attached in its place: a screenshot, an image copied from a page, a file copied
 * from the desktop. A paste that brings words pastes the words, since a copy from a document often carries a picture
 * of them too; a file copied from the desktop may bring only its own name as words.
 */
export function pastedFiles(dt: DataTransfer): File[] {
  const files = Array.from(dt.files)
  const words = dt.getData('text/plain').trim()
  return words === '' || words.split(/\r?\n/).every((l) => files.some((f) => f.name === l.trim())) ? files : []
}

/** B28.130 — over the chat while files are dragged onto it. */
export function DropOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed border-accent bg-accent-tint px-gutter text-center"
      data-testid="drop-overlay"
      aria-hidden="true"
    >
      <p className="text-body font-medium text-ink">Drop to attach to your question</p>
      <p className="text-caption text-muted">
        PDF, Word, Excel, PowerPoint, CSV, HTML, JSON, XML, text and Markdown files, and PNG, JPEG, GIF and WebP images
      </p>
    </div>
  )
}
