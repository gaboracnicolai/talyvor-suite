// Docs-area API layer.
//
// ── THE CLAIM THIS FILE USED TO MAKE ─────────────────────────────────────────
//
// "ONE route is live today … everything else a read-only Docs UI needs does NOT exist on the
// BFF yet". Both halves were false: the BFF registers /api/docs/spaces/{spaceID},
// /api/docs/spaces/{spaceID}/pages and /api/docs/spaces/{spaceID}/pages/{pageID} — the exact
// two reads the tree and the reader claimed were missing. The page tree and page reader ran on
// seven fabricated pages (with view counts of 128, 64, 31, …) under a footnote asserting the
// routes did not exist.
//
// The routes exist. What does not exist is a Docs UPSTREAM on this deployment: no DOCS_*
// variables, and the service is not in the compose stack, so all four routes answer 503. So
// the fixtures are deleted rather than re-captioned, and the screens probe instead — see
// lib/productState.ts for why the "not configured" state must be detected rather than written
// down, and areas/docs/BFF-GAPS.md for the Tier-2/3 reads that genuinely do not exist yet.
//
// Shapes mirror talyvor-docs internal/model/model.go VERBATIM (field-for-field, at e0cf605),
// so wiring the tree and reader is adding a fetch — the types already speak the upstream shape.
import { ApiError } from '../../lib/api'

/** talyvor-docs model.Space (model.go), verbatim. */
export interface DocsSpace {
  id: string
  workspace_id: string
  name: string
  slug: string
  description: string
  /** Emoji identifier. Rendered as-is. */
  icon: string
  /** Upstream stores a space colour; this UI deliberately never renders it
   *  (text is never a hue, and a per-space accent is a hue looking for text). */
  color: string
  private: boolean
  created_by: string
  created_at: string
  updated_at: string
}

/** talyvor-docs model.Page (model.go), verbatim. `content` is the canonical
 *  ProseMirror doc JSON (string-encoded); `content_text` is the plain-text
 *  projection the server derives for search. */
export interface DocsPage {
  id: string
  space_id: string
  workspace_id: string
  parent_id?: string | null
  title: string
  slug: string
  content: string
  content_text: string
  icon: string
  cover_url: string
  position: number
  depth: number
  is_template: boolean
  created_by: string
  updated_by: string
  linked_issues?: string[]
  ai_cost_usd: number
  view_count: number
  last_viewed_at?: string | null
  last_verified_at?: string | null
  verified_by?: string | null
  stale_after_days: number
  doc_status?: string
  locked: boolean
  locked_by?: string | null
  locked_at?: string | null
  page_type?: string
  created_at: string
  updated_at: string
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  // The shared ApiError, so a 401 here trips App.tsx's QueryCache handler and
  // re-probes the auth gate exactly like every live area.
  if (!res.ok) throw new ApiError(res.status, path)
  return (await res.json()) as T
}

/** A page as the list route returns it (content projected away by the BFF). */
export interface DocsPageRow {
  id: string
  title: string
}

async function send<T>(path: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, path)
  return res.json() as Promise<T>
}

export const docsApi = {
  /** LIVE — spaces in the SESSION's workspace (the BFF no longer pins one). */
  spaces: (): Promise<DocsSpace[]> => getJSON<DocsSpace[]>('/api/docs/spaces'),

  page: (spaceId: string, pageId: string): Promise<DocsPageRow & { content_text?: string }> =>
    getJSON(`/api/docs/spaces/${encodeURIComponent(spaceId)}/pages/${encodeURIComponent(pageId)}`),

  pages: (spaceId: string): Promise<DocsPageRow[]> =>
    getJSON<DocsPageRow[]>(`/api/docs/spaces/${encodeURIComponent(spaceId)}/pages`),

  /** Docs owns the schema; the BFF forwards this body verbatim. */
  createPage: (spaceId: string, title: string) =>
    send<DocsPageRow>(`/api/docs/spaces/${encodeURIComponent(spaceId)}/pages`, 'POST', { title }),

  updatePage: (spaceId: string, pageId: string, patch: { title?: string; content_text?: string }) =>
    send<DocsPageRow>(
      `/api/docs/spaces/${encodeURIComponent(spaceId)}/pages/${encodeURIComponent(pageId)}`,
      'PATCH',
      patch,
    ),
}
