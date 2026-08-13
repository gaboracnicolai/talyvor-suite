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
// The shapes below are a DECLARED SUBSET of talyvor-docs internal/model/model.go, not a copy of
// it. Each interface names the upstream fields it does not mirror (`UPSTREAM-ONLY <Interface>: …`,
// `?` meaning the upstream tag carries omitempty); interface fields ∪ that list = the whole
// upstream struct, and deploy/decision-expiry.sh tells a deployer to check that union against the
// Go source. mirrorSubsetRegister.test.ts keeps the two halves equal.
//
// ⚠ THE SENTENCE THAT USED TO BE HERE WAS FALSE. It read "Shapes mirror talyvor-docs
// internal/model/model.go VERBATIM (field-for-field, at e0cf605), so wiring the tree and reader is
// adding a fetch — the types already speak the upstream shape". MEASURED at talyvor-docs d89a005:
// `DocsPage` held 29 of `model.Page`'s 31 json fields, and both missing ones — `own_ai_cost_usd`
// and `total_ai_cost_usd` — carry NO omitempty, so they are on every page response. One of them
// is the column suite #204 registered an entire front-page premise about, added upstream while
// this header went on saying the types already spoke the upstream shape. Nothing broke (the BFF
// streams the body and the extra keys are invisible to TypeScript); the promise was what was
// false, and no change in this repository could have made it go red.
import { ApiError } from '../../lib/api'

/** talyvor-docs model.Space (model.go).
 *  UPSTREAM-ONLY DocsSpace: none */
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

/** talyvor-docs model.Page (model.go). `content` is the canonical ProseMirror doc JSON
 *  (string-encoded); `content_text` is the plain-text projection the server derives for search.
 *
 *  ⚠ THE TWO OMITTED FIELDS ARE THE PER-PAGE AI SPEND, AND THEY ARE NOT MIRRORED ON PURPOSE.
 *  `own_ai_cost_usd` is a documented LOWER BOUND upstream (docs-ai-ask and docs-search have no
 *  single page and are excluded by design) and `ai_cost_usd`, which IS mirrored, is recomputed
 *  and overwritten from the linked issues on every sweep. Rendering either as "the cost of this
 *  document" is a claim decision this app has not made — see deploy/decision-expiry.sh, where
 *  that premise is already registered. Mirroring them here would put the number one `.tsx` away
 *  from a screen, which is not a shape decision.
 *  UPSTREAM-ONLY DocsPage: own_ai_cost_usd, total_ai_cost_usd */
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

  /**
   * Creates a space in the SESSION's workspace.
   *
   * ⚠ `name` is the field Docs reads (model.Space, `json:"name"`) — it is required, and a wrong key
   * would not error, it would decode to "" and be refused as an empty name. `slug`, `icon` and
   * `color` are DERIVED and defaulted by Docs' own store, so nothing is invented here.
   *
   * ⚠ NO workspace_id. Docs takes it from the body on this route and the BFF injects the pinned one
   * — a workspace this client named would be a workspace the browser chose.
   */
  createSpace: (name: string) => send<DocsSpace>('/api/docs/spaces', 'POST', { name }),

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
