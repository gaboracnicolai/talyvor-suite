import { ApiError, UnreadableError } from '../../lib/api'

// B28.380 — the files uploaded in Chat (POST /api/documents, B18.24), kept in Lens until they are deleted here:
//
//   GET    /api/documents        every file the workspace uploaded → {"documents": [{id, media_type, filename, size_bytes, uploaded_at}]}
//   DELETE /api/documents/{id}   one deleted for good → 204; 404 once it is gone

/** One uploaded file, as Lens lists it. */
export interface UploadedFile {
  id: string
  media_type: string
  filename: string
  size_bytes: number
  uploaded_at: string
}

export const UPLOADED_FILES_KEY = ['chat-uploaded-files'] as const

const DOCUMENTS_PATH = '/api/documents'

/** Why the files could not be listed or one deleted, in a sentence the page shows as it is. */
export class UploadedFilesError extends ApiError {
  constructor(
    status: number,
    sentence: string,
    /** The deployment's Lens cannot list or delete uploaded files yet. */
    readonly unavailable = false,
  ) {
    super(status, DOCUMENTS_PATH)
    this.message = sentence
  }
}

/** The workspace's uploaded files, newest first. Throws with what went wrong when they could not be read. */
export async function fetchUploadedFiles(): Promise<UploadedFile[]> {
  const res = await fetch(DOCUMENTS_PATH, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
  const body = (await res.json().catch(() => ({}))) as { documents?: unknown; code?: unknown }
  if (body.code === 'documents_unavailable') {
    throw new UploadedFilesError(res.status, 'Uploaded files cannot be listed on this deployment yet.', true)
  }
  if (!res.ok) throw new UploadedFilesError(res.status, 'Your uploaded files could not be read just now.')
  if (!Array.isArray(body.documents)) throw new UnreadableError(DOCUMENTS_PATH)
  return (body.documents as UploadedFile[])
    .filter((d) => typeof d?.id === 'string' && d.id.startsWith('tdoc_'))
    .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))
}

/**
 * Deletes an uploaded file for good. A file already gone (404) is not an error: what the person asked for is true.
 * Throws with the BFF's or Lens's words when it was not deleted.
 */
export async function deleteUploadedFile(id: string): Promise<'deleted' | 'gone'> {
  const res = await fetch(`${DOCUMENTS_PATH}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (res.status === 204 || res.status === 200) return 'deleted'
  const body = (await res.json().catch(() => ({}))) as { error?: unknown; code?: unknown }
  if (body.code === 'documents_unavailable') {
    throw new UploadedFilesError(res.status, 'Uploaded files cannot be deleted on this deployment yet.', true)
  }
  if (res.status === 404) return 'gone'
  throw new UploadedFilesError(res.status, typeof body.error === 'string' && res.status < 500 ? `${body.error}.` : 'Lens couldn’t delete the file just now.')
}

/** "820 KB", "4.2 MB". */
export function fileSize(bytes: number): string {
  return bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`
}

/** What kind of file a media type is, in a word a person reads. */
export function fileKind(mediaType: string): string {
  const type = mediaType.split(';')[0].trim().toLowerCase()
  const known: Record<string, string> = {
    'application/pdf': 'PDF',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
    'text/markdown': 'Markdown',
    'text/plain': 'Text',
    'text/csv': 'CSV',
    'text/html': 'HTML',
    'application/json': 'JSON',
  }
  if (known[type] !== undefined) return known[type]
  if (type.startsWith('image/')) return 'Image'
  return type === '' ? 'File' : type
}
