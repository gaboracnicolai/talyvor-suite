// ⚠ LOCAL FIXTURES — not served by the BFF. The page-tree and page-read routes do
// not exist on the BFF yet (see ./BFF-GAPS.md); until they land, the tree and reader
// run against this file and every screen shows a `fixture` chip. Shapes are
// field-faithful model.Page objects; `content` is ProseMirror doc JSON exactly as
// talyvor-docs stores it (the discarded frontend's schema: schema-basic + lists +
// code_block, marks strong/em/code/link/underline/strike/highlight), so the reader
// built against these fixtures reads real rows unchanged on BFF day.
//
// Ids are prefixed `fx-` so a fixture id can never be mistaken for a live row.
import type { DocsPage } from './api'

// PM docs authored as objects, stringified below — the wire carries a string.
const gettingStartedDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Getting started' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Talyvor Docs stores every page as ' },
        { type: 'text', marks: [{ type: 'strong' }], text: 'ProseMirror JSON' },
        { type: 'text', text: ' with a plain-text projection for search. This page exercises the ' },
        { type: 'text', marks: [{ type: 'em' }], text: 'whole' },
        { type: 'text', text: ' node set the reader supports.' },
      ],
    },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Lists' }] },
    {
      type: 'bullet_list',
      content: [
        {
          type: 'list_item',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Spaces group pages per team' }] }],
        },
        {
          type: 'list_item',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Pages nest up to depth 5' }] },
            {
              type: 'bullet_list',
              content: [
                {
                  type: 'list_item',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'ordering is by position, then created_at' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'ordered_list',
      attrs: { order: 1 },
      content: [
        { type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Read' }] }] },
        { type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Verify' }] }] },
        { type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Re-attest' }] }] },
      ],
    },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Marks' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', marks: [{ type: 'code' }], text: 'inline code' },
        { type: 'text', text: ', a ' },
        {
          type: 'text',
          marks: [{ type: 'link', attrs: { href: 'https://example.com', title: 'example' } }],
          text: 'link',
        },
        { type: 'text', text: ', ' },
        { type: 'text', marks: [{ type: 'underline' }], text: 'underline' },
        { type: 'text', text: ', ' },
        { type: 'text', marks: [{ type: 'strike' }], text: 'struck' },
        { type: 'text', text: ' and ' },
        { type: 'text', marks: [{ type: 'highlight' }], text: 'highlighted' },
        { type: 'text', text: ' text.' },
      ],
    },
    {
      type: 'blockquote',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Verification is a claim about a point in time, not a property of a page.' }],
        },
      ],
    },
    { type: 'horizontal_rule' },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Code' }] },
    {
      type: 'code_block',
      attrs: { language: 'bash' },
      content: [{ type: 'text', text: 'curl -s /api/docs/spaces | jq length' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Line one' },
        { type: 'hard_break' },
        { type: 'text', text: 'line two, after a hard break.' },
      ],
    },
  ],
}

const architectureDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Architecture' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The Docs server owns storage, permissions and search; clients own the editor schema. The BFF pins the workspace and injects the gateway secret — the browser never sees either.' },
      ],
    },
  ],
}

const collabDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Collaboration protocol' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'One WebSocket per page at ' },
        { type: 'text', marks: [{ type: 'code' }], text: '/v1/collab/{pageID}/ws' },
        { type: 'text', text: '. The shipped client sends whole-document snapshots; the ops array is a forward-compat hook. See EDITOR-SIZING.md in this directory.' },
      ],
    },
  ],
}

const runbookDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'On-call runbook' }] },
    {
      type: 'ordered_list',
      attrs: { order: 1 },
      content: [
        { type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Check /healthz' }] }] },
        { type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Check the gateway secret has not rotated mid-deploy' }] }] },
      ],
    },
  ],
}

const stubDoc = (title: string) => ({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Fixture stub — replaced by real content on BFF day.' }] },
  ],
})

const base = {
  space_id: 'fx-space',
  workspace_id: 'fx-workspace',
  content_text: '',
  cover_url: '',
  is_template: false,
  created_by: 'fx-member-ada',
  updated_by: 'fx-member-ada',
  ai_cost_usd: 0,
  stale_after_days: 0,
  locked: false,
  page_type: 'document',
} satisfies Partial<DocsPage>

/** One deterministic tree, depths 0–2, ordered by (depth, position) like the server. */
export const FIXTURE_PAGES: DocsPage[] = [
  {
    ...base,
    id: 'fx-getting-started',
    parent_id: null,
    title: 'Getting started',
    slug: 'getting-started',
    icon: '🚀',
    position: 1,
    depth: 0,
    content: JSON.stringify(gettingStartedDoc),
    view_count: 128,
    last_verified_at: '2026-07-14T09:00:00Z',
    verified_by: 'fx-member-ada',
    created_at: '2026-06-02T10:00:00Z',
    updated_at: '2026-07-18T16:20:00Z',
  },
  {
    ...base,
    id: 'fx-architecture',
    parent_id: null,
    title: 'Architecture',
    slug: 'architecture',
    icon: '🏛️',
    position: 2,
    depth: 0,
    content: JSON.stringify(architectureDoc),
    view_count: 64,
    created_at: '2026-06-03T10:00:00Z',
    updated_at: '2026-07-10T11:00:00Z',
  },
  {
    ...base,
    id: 'fx-collab-protocol',
    parent_id: 'fx-architecture',
    title: 'Collaboration protocol',
    slug: 'collaboration-protocol',
    icon: '🔌',
    position: 1,
    depth: 1,
    content: JSON.stringify(collabDoc),
    view_count: 31,
    created_at: '2026-06-04T10:00:00Z',
    updated_at: '2026-07-19T08:45:00Z',
  },
  {
    ...base,
    id: 'fx-permissions',
    parent_id: 'fx-architecture',
    title: 'Permissions & tiers',
    slug: 'permissions-tiers',
    icon: '🔐',
    position: 2,
    depth: 1,
    content: JSON.stringify(stubDoc('Permissions & tiers')),
    view_count: 12,
    doc_status: 'approved',
    created_at: '2026-06-05T10:00:00Z',
    updated_at: '2026-07-01T09:30:00Z',
  },
  {
    ...base,
    id: 'fx-tier-gate',
    parent_id: 'fx-permissions',
    title: 'The collab tier gate',
    slug: 'collab-tier-gate',
    icon: '🚧',
    position: 1,
    depth: 2,
    content: JSON.stringify(stubDoc('The collab tier gate')),
    view_count: 7,
    created_at: '2026-06-06T10:00:00Z',
    updated_at: '2026-06-28T14:00:00Z',
  },
  {
    ...base,
    id: 'fx-runbooks',
    parent_id: null,
    title: 'Runbooks',
    slug: 'runbooks',
    icon: '📟',
    position: 3,
    depth: 0,
    content: JSON.stringify(stubDoc('Runbooks')),
    view_count: 45,
    created_at: '2026-06-07T10:00:00Z',
    updated_at: '2026-07-16T07:10:00Z',
  },
  {
    ...base,
    id: 'fx-oncall',
    parent_id: 'fx-runbooks',
    title: 'On-call',
    slug: 'on-call',
    icon: '🌙',
    position: 1,
    depth: 1,
    content: JSON.stringify(runbookDoc),
    view_count: 90,
    locked: true,
    locked_by: 'fx-member-lin',
    locked_at: '2026-07-20T22:00:00Z',
    created_at: '2026-06-08T10:00:00Z',
    updated_at: '2026-07-20T22:05:00Z',
  },
]
