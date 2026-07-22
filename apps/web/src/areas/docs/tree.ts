// Pure tree assembly over the flat []model.Page the server returns (ordered by
// depth, position, created_at — but we re-sort locally so the tree is correct even
// if a future BFF route pages or filters the flat list).
import type { DocsPage } from './api'

export interface TreeNode {
  page: DocsPage
  children: TreeNode[]
}

const byOrder = (a: DocsPage, b: DocsPage) =>
  a.position - b.position || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)

/**
 * Build the nested tree from parent_id links. A page whose parent is not in the
 * set (deleted parent, paged-out parent) is kept and promoted to the root rather
 * than dropped — a browse surface must never silently hide pages.
 */
export function buildTree(pages: DocsPage[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>()
  for (const p of pages) nodes.set(p.id, { page: p, children: [] })

  const roots: TreeNode[] = []
  for (const p of [...pages].sort(byOrder)) {
    const node = nodes.get(p.id)
    if (!node) continue
    const parent = p.parent_id ? nodes.get(p.parent_id) : undefined
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/** Count of every node in the forest — the tree's honest total for the header. */
export function countNodes(roots: TreeNode[]): number {
  let n = 0
  const walk = (t: TreeNode) => {
    n += 1
    t.children.forEach(walk)
  }
  roots.forEach(walk)
  return n
}
