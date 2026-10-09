// B28.162 — a listing's new version (Lens B20.1, POST …/marketplace/listings/{id}/versions), once a run, on workspaces
// of its own.
//
// A new seller publishes a prompt listing whose version 1 answers ALPHA, then uploads version 2, which answers BRAVO, with
// a changelog — as the listing page's New version form does. Lens's read of the listing is the oracle for
// market_listing_versions: its latest version 2, version 2 with its changelog and BRAVO, version 1 still ALPHA. A buyer's
// use pinned to version 1 must run version 1 — its answer version 1 and ALPHA — and an unpinned use the new latest,
// version 2 and BRAVO.

import { fail } from './bank.ts'
import type { Listing } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario } from './scenarios.ts'

/** Each version's template, and the word its use must answer. */
const V1 = { template: 'Reply with the single word: ALPHA', word: 'ALPHA' }
const V2 = { template: 'Reply with the single word: BRAVO', word: 'BRAVO' }
const CHANGELOG = 'Answers BRAVO now'

/** Lens market.Version as the seller reads it: the artifact is shown to its owner. */
interface Version { version: number; changelog?: string; artifact?: { template?: string } }
/** Lens market.Use as the use route answers it. */
interface Use { id: string; version: number; output: string }

export function marketVersions(seed: number): Scenario {
  return {
    id: 'market-versions',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Marketplace',
    title: "a seller uploads a listing's version 2 with a changelog: the listing reads both versions, version 1 unchanged; " +
      'a use pinned to version 1 still runs version 1, and an unpinned use runs version 2',
    run: async (ctx) => {
      const { lens, judgeModel } = ctx.env
      const [seller, buyer] = await lens.createUsers(2)
      const title = `Versioned ${seed}-${RUN_SALT}`
      const pub = await lens.act<Listing>(seller, 'POST', '/v1/workspaces/{ws}/marketplace/listings', { kind: 'prompt', title, description: '',
        price_per_use_ulxc: 0, visibility: 'public', artifact: { template: V1.template, model: judgeModel }, changelog: 'First version' })
      ctx.evidence.push({ note: `the seller (${seller.workspaceID}) publishes "${title}", version 1 answering ${V1.word}`, answer: said(pub) })
      if (!pub.ok) return fail(`publishing "${title}" was refused: ${said(pub)}`)
      const id = pub.value.id
      if (pub.value.review_status !== 'approved') {
        if (!lens.canModerate) throw new CannotTest(`the listing was ${pub.value.review_status}, and approving it needs a moderator key: LENS_MODERATOR_KEY, from \`lens moderator-keys create\``)
        const ok = await lens.moderate(id, 'approve')
        if (!ok.ok) return fail(`approving the held listing ${id}: ${said(ok)}`)
      }

      const v2 = await lens.act<Version>(seller, 'POST', `/v1/workspaces/{ws}/marketplace/listings/${id}/versions`,
        { artifact: { template: V2.template, model: judgeModel }, changelog: CHANGELOG, parents: [] })
      ctx.evidence.push({ note: `the seller uploads version 2, answering ${V2.word}, "${CHANGELOG}"`, answer: said(v2) })
      if (!v2.ok || v2.value.version !== 2) return fail(`uploading version 2 should answer version 2: ${said(v2)}`)

      // market_listing_versions, as Lens reads it back to the listing's owner.
      const read = await lens.act<Listing & { latest_version: number; versions?: Version[] }>(seller, 'GET', `/v1/marketplace/listings/${id}`)
      ctx.evidence.push({ note: 'the seller reads the listing', answer: said(read) })
      if (!read.ok) return fail(`reading the listing back was refused: ${said(read)}`)
      const versions = read.value.versions ?? []
      const one = versions.find((v) => v.version === 1)
      const two = versions.find((v) => v.version === 2)
      if (read.value.latest_version !== 2 || versions.length !== 2) return fail(`the listing should read latest version 2 of 2 versions; it reads latest ${read.value.latest_version} of ${JSON.stringify(versions.map((v) => v.version))}`)
      if (two?.changelog !== CHANGELOG || two.artifact?.template !== V2.template) return fail(`version 2 should read "${CHANGELOG}" and ${V2.word}'s template; it reads ${JSON.stringify(two)}`)
      if (one?.artifact?.template !== V1.template) return fail(`version 1 should still read ${V1.word}'s template; it reads ${JSON.stringify(one)}`)

      // A use pinned to version 1, then one that follows the latest.
      const runVersion = async (version: number, what: string): Promise<Use | string> => {
        const u = await lens.act<Use>(buyer, 'POST', `/v1/workspaces/{ws}/marketplace/listings/${id}/use`, { version })
        ctx.evidence.push({ note: `the buyer (${buyer.workspaceID}) uses ${what}`, answer: said(u) })
        return u.ok ? u.value : `the buyer's use of ${what} was refused: ${said(u)}`
      }
      const runs = (u: Use, word: string) => u.output.toUpperCase().includes(word)
      const pinned = await runVersion(1, 'version 1')
      if (typeof pinned === 'string') return fail(pinned)
      if (pinned.version !== 1 || !runs(pinned, V1.word) || runs(pinned, V2.word)) {
        return fail(`a use pinned to version 1 should run version 1 and answer ${V1.word}; it ran version ${pinned.version} and answered "${pinned.output.slice(0, 200)}"`)
      }
      const latest = await runVersion(0, 'the latest')
      if (typeof latest === 'string') return fail(latest)
      if (latest.version !== 2 || !runs(latest, V2.word)) {
        return fail(`an unpinned use should run version 2 and answer ${V2.word}; it ran version ${latest.version} and answered "${latest.output.slice(0, 200)}"`)
      }
      return { pass: true, detail: `version 2 uploaded with "${CHANGELOG}" and read back beside version 1, unchanged; a use pinned to version 1 (${pinned.id}) ran version 1 ` +
        `and answered ${V1.word}; an unpinned use (${latest.id}) ran version 2 and answered ${V2.word}` }
    },
  }
}
