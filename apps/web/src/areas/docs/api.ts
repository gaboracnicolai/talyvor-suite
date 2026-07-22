// Docs-area API layer. ONE route is live today — the BFF proxies
// GET /api/docs/spaces → talyvor-docs GET /v1/workspaces/{ws}/spaces (body verbatim,
// workspace pinned server-side). Everything else a read-only Docs UI needs does NOT
// exist on the BFF yet; those reads resolve from local fixtures and say so via the
// Sourced envelope so every screen can mark fixture data honestly. The exhaustive
// list of missing routes is ./BFF-GAPS.md — the one BFF PR that unblocks this area.
//
// Shapes mirror talyvor-docs internal/model/model.go VERBATIM (field-for-field, at
// e0cf605), so the day a BFF route lands, the fixture body of the matching function
// is deleted and nothing else changes — types, screens and tests already speak the
// upstream shape.
import { ApiError } from '../../lib/api'
import { FIXTURE_PAGES } from './fixtures'

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

/** Where a payload came from. 'fixture' renders a visible chip on every screen that
 *  shows the data — fixture-backed reads are never allowed to look live. */
export type DataSource = 'live' | 'fixture'

export interface Sourced<T> {
  source: DataSource
  data: T
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  // The shared ApiError, so a 401 here trips App.tsx's QueryCache handler and
  // re-probes the auth gate exactly like every live area.
  if (!res.ok) throw new ApiError(res.status, path)
  return (await res.json()) as T
}

export const docsApi = {
  /** LIVE — the one Docs route the BFF serves today. Bare array, upstream body verbatim. */
  spaces: (): Promise<DocsSpace[]> => getJSON<DocsSpace[]>('/api/docs/spaces'),

  /** FIXTURE — needs BFF `GET /api/docs/spaces/{spaceID}/pages` (upstream:
   *  `GET /v1/spaces/{spaceID}/pages`, → []model.Page ordered by depth, position,
   *  created_at). The fixture serves ONE deterministic tree for every space so
   *  browsing works against whatever real spaces exist. */
  pageTree: (spaceID: string): Promise<Sourced<DocsPage[]>> =>
    Promise.resolve({
      source: 'fixture',
      data: FIXTURE_PAGES.map((p) => ({ ...p, space_id: spaceID })),
    }),

  /** FIXTURE — needs BFF `GET /api/docs/spaces/{spaceID}/pages/{pageID}` (upstream:
   *  `GET /v1/spaces/{spaceID}/pages/{pageID}`, → model.Page). Resolves from the same
   *  fixture set; an unknown id rejects with the upstream-shaped 404 so the screen's
   *  error path is exercised now, not on BFF day. */
  page: (spaceID: string, pageID: string): Promise<Sourced<DocsPage>> => {
    const hit = FIXTURE_PAGES.find((p) => p.id === pageID)
    if (!hit) return Promise.reject(new ApiError(404, `fixture:/api/docs/spaces/${spaceID}/pages/${pageID}`))
    return Promise.resolve({ source: 'fixture', data: { ...hit, space_id: spaceID } })
  },
}
