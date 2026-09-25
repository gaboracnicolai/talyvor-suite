import { forwardRef } from 'react'

/**
 * The chat's hidden file input, opened by the composer's Attach button. It is never seen or typed
 * into, so it is not a text field (controlParity.test.ts records the exemption).
 */
export const FilePicker = forwardRef<HTMLInputElement, { accept: string; onFiles: (files: File[]) => void }>(
  function FilePicker({ accept, onFiles }, ref) {
    return (
      <input
        ref={ref}
        id="chat-attach"
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept={accept}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length > 0) onFiles(files)
        }}
      />
    )
  },
)
