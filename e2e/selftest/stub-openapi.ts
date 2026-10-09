// talyvor-lens B28.12 — what Lens says it is: GET /openapi.json, the API reference, opening on "Agent Wallets and the
// gateway that enforces them" with the wallet operations under an "Agent Wallets" tag (lens-openapi.json, the wallet
// half of the document Lens serves, recorded from it); and the pages at / and /status, which carry the same line, /
// linking the API reference. STUB_BREAK=openapi-wallets serves all three as Lens did before B28.12: the document a
// "Production AI proxy/gateway" with no wallet operation in it, / an "Inference gateway" that links no reference, and
// /status no line at all.

import { readFileSync } from 'node:fs'

export const WALLET_LINE = 'Agent Wallets and the gateway that enforces them'

const RECORDED = readFileSync(new URL('./lens-openapi.json', import.meta.url), 'utf8')

/** The document GET /openapi.json answers. */
export function lensOpenAPI(broken: boolean): unknown {
  const doc = JSON.parse(RECORDED) as { info: { description: string }; tags?: unknown; paths: object; components: { schemas: object } }
  if (!broken) return doc
  doc.info.description = 'Production AI proxy/gateway. Multi-provider routing with cost tracking, quality scoring, attribution, and tenant isolation.'
  delete doc.tags
  doc.paths = {}
  doc.components.schemas = {}
  return doc
}

/** The page at / or /status, as a browser asks for it. */
export function lensPage(path: '/' | '/status', broken: boolean): string {
  const head = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Talyvor Lens</title></head><body><main>'
  if (path === '/status') {
    return `${head}<h1>Talyvor Lens</h1><div class="subtitle">${broken ? '' : `${WALLET_LINE} · `}<span class="num">vstub</span> · uptime <span class="num">0.01 hours</span></div></main></body></html>`
  }
  const rows = [
    ['/status', 'Service status'],
    ['https://app.talyvor.com', broken ? 'Dashboard' : 'Wallet console'],
    ...(broken ? [] : [['/openapi.json', 'API reference']]),
    ['https://docs.talyvor.com', 'Documentation'],
  ]
  return `${head}<div class="card"><div class="head"><h1>Talyvor Lens</h1><p class="sub">${broken ? 'Inference gateway' : WALLET_LINE}</p></div>` +
    rows.map(([href, label]) => `<a class="row" href="${href}"><div class="label">${label}</div></a>`).join('') +
    '</div></main></body></html>'
}
