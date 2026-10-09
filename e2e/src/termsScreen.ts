// B30.103 — the Capability terms screen (/settings/terms) and an agent's Know Your Agent credential on Agent Wallets, once
// a run, in the browser, on a workspace of its own so nothing is accepted yet.
//
// Terms: Lens must list fx's terms not yet accepted, and the screen must say so. The owner opens them, the text must start
// "Draft — for legal review", and accepts the version shown. The screen must then say Accepted, and Lens's own record
// (GET …/terms, read on the workspace's token, not through the screen) must hold fx accepted at its latest version by a
// person. That record is exactly what Lens's gate reads before fx moves money (economy.termsRefusal), so it is what lets
// fx's first use through; no route moves money in currencies yet (B30.29), so the use itself is Lens's real-PG test's.
//
// Credential: the workspace makes an agent and opens it on Agent Wallets. The credential the screen shows must verify
// with nothing but the published keys (/.well-known/talyvor-kya/jwks.json) as the agent's own, on this workspace, and the
// screen's "Check it with Talyvor" must say Valid. Screenshots of both at 1440 and 390.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'
import { fail } from './bank.ts'
import { checkWithJWKS } from './kya.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'
import { call } from './settings.ts'

const TIMEOUT_MS = 20_000
const CAPABILITY = 'fx'

interface Terms { capability: string; version: number; accepted?: { version: number; person: string } }

/** Lens's own record of the workspace's terms, on its token; or why it could not be read. */
async function lensTerms(ctx: ScenarioCtx, note: string): Promise<Terms[] | string> {
  const r = await call<{ terms: Terms[] | null }>(ctx, 'GET', '/v1/workspaces/{ws}/terms')
  ctx.evidence.push({ note, answer: `${r.status} ${r.text.slice(0, 400)}` })
  if (r.status !== 200 || r.value === undefined) return `GET /v1/workspaces/{ws}/terms answered ${r.status} ${r.error || r.text.slice(0, 200)}`
  return r.value.terms ?? []
}

/** The page at 1440 and 390 — or, given `part`, only that part of it (Agent Wallets is many screens long). */
async function screenshots(ctx: ScenarioCtx, page: Page, name: string, part?: Locator): Promise<string> {
  const { outDir } = ctx.env
  await mkdir(outDir, { recursive: true })
  const wide = join(outDir, `${name}-1440px-user${ctx.app.user.index}.png`)
  const narrow = join(outDir, `${name}-390px-user${ctx.app.user.index}.png`)
  await page.setViewportSize({ width: 1440, height: 900 })
  await (part === undefined ? page.screenshot({ path: wide, fullPage: true }) : part.screenshot({ path: wide }))
  await page.setViewportSize({ width: 390, height: 844 })
  await (part === undefined ? page.screenshot({ path: narrow, fullPage: true }) : part.screenshot({ path: narrow }))
  return `at 1440px: ${wide}; at 390px: ${narrow}`
}

export function termsAndCredentialScreens(): Scenario {
  return {
    id: 'terms-credential-screens',
    owner: 'talyvor-suite',
    own: true,
    agents: 1,
    items: ['B30.103'],
    title: 'the Capability terms screen accepts fx’s terms and Lens records them accepted at their latest version, which is what lets ' +
      'fx’s first use through; an agent’s Know Your Agent credential on Agent Wallets verifies with only the published keys and ' +
      'the screen’s check says Valid',
    run: async (ctx) => {
      const before = await lensTerms(ctx, 'Lens’s record of the workspace’s terms before the screen')
      if (typeof before === 'string') return fail(before)
      const fx = before.find((t) => t.capability === CAPABILITY)
      if (fx === undefined) return fail(`Lens lists no terms for ${CAPABILITY}: it lists ${before.map((t) => t.capability).join(', ') || 'none'}`)
      if (fx.accepted !== undefined) return fail(`a workspace made this run already has ${CAPABILITY}’s terms accepted: ${JSON.stringify(fx.accepted)}`)

      const page = await ctx.app.tab('/settings/terms')
      try {
        await page.locator('header h1').filter({ hasText: 'Capability terms' }).waitFor({ timeout: TIMEOUT_MS })
        const row = page.getByTestId(`terms-${CAPABILITY}`)
        await row.waitFor({ timeout: TIMEOUT_MS })
        const shown = ((await row.textContent()) ?? '').trim()
        if (!shown.includes('Not accepted yet')) return fail(`the screen shows ${CAPABILITY} as "${shown}", while Lens has it not accepted`)
        if (!((await page.getByTestId('terms-preview').textContent()) ?? '').includes('Preview — test money only')) {
          return fail('the Capability terms screen does not say "Preview — test money only"')
        }

        await row.getByRole('button', { name: 'Read and accept' }).click()
        const text = row.getByTestId('terms-text')
        await text.waitFor({ timeout: TIMEOUT_MS })
        const words = ((await text.textContent()) ?? '').trim()
        ctx.evidence.push({ note: `${CAPABILITY}’s terms on the screen: ${words.slice(0, 200)}` })
        if (!words.startsWith('Draft — for legal review')) return fail(`${CAPABILITY}’s terms on the screen begin "${words.slice(0, 60)}", not "Draft — for legal review"`)

        await row.getByRole('button', { name: `Accept version ${fx.version}` }).click()
        const accepted = row.getByText('Accepted', { exact: true })
        const refused = row.getByRole('alert')
        await accepted.or(refused).first().waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
        if (!(await accepted.isVisible())) {
          const said = (await refused.allTextContents()).join(' ').trim()
          return fail(`accepting version ${fx.version} of ${CAPABILITY}’s terms on the screen: ${said === '' ? 'the screen never said Accepted' : `the screen said "${said}"`}`)
        }

        const after = await lensTerms(ctx, 'Lens’s record of the workspace’s terms after the screen accepted them')
        if (typeof after === 'string') return fail(after)
        const now = after.find((t) => t.capability === CAPABILITY)
        if (now?.accepted === undefined || now.accepted.version !== now.version || now.accepted.person === '') {
          return fail(`the screen said ${CAPABILITY}’s terms were Accepted, but Lens records ${JSON.stringify(now ?? null)}: its gate reads this ` +
            `record, so ${CAPABILITY}’s first use would still be refused`)
        }
        const count = ((await page.getByTestId('terms-count').textContent()) ?? '').trim()
        const want = `${after.filter((t) => t.accepted !== undefined).length} of ${after.length} accepted`
        if (count !== want) return fail(`after accepting, the screen counts "${count}", while Lens’s record makes it "${want}"`)
        ctx.evidence.push({ note: `the Capability terms screen after accepting, ${await screenshots(ctx, page, 'capability-terms')}` })
      } finally {
        await page.close()
      }

      const made = await call<{ id: string; name: string }>(ctx, 'POST', '/v1/workspaces/{ws}/agents', { name: `Credential check ${RUN_SALT}` })
      ctx.evidence.push({ note: 'the workspace makes an agent to show its credential', answer: `${made.status} ${made.text.slice(0, 200)}` })
      if (made.value?.id === undefined) return fail(`making an agent was answered ${made.status} ${made.error}`)
      const agents = await ctx.app.tab(`/agents?agent=${encodeURIComponent(made.value.id)}`)
      try {
        const card = agents.getByTestId('agent-credential')
        await card.waitFor({ timeout: TIMEOUT_MS })
        await card.getByRole('button', { name: 'Show its credential' }).click()
        const token = card.getByTestId('credential-token')
        await token.or(card.getByRole('alert')).first().waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
        if (!(await token.isVisible())) {
          return fail(`Agent Wallets showed no credential for ${made.value.name}: ${(await card.getByRole('alert').allTextContents()).join(' ') || 'nothing at all'}`)
        }
        const shown = ((await token.textContent()) ?? '').trim()
        const jwks = await ctx.env.lens.as('', 'GET', '/.well-known/talyvor-kya/jwks.json')
        ctx.evidence.push({ note: 'a platform fetches the published keys', answer: `${jwks.status} ${jwks.text.slice(0, 300)}` })
        if (jwks.status !== 200) return fail(`the published keys answered ${jwks.status}`)
        const checked = checkWithJWKS(JSON.parse(jwks.text) as { keys?: [] }, shown)
        if ('error' in checked) return fail(`the credential Agent Wallets shows does not verify with the published keys: ${checked.error}`)
        if (checked.claims.sub !== made.value.id || checked.claims.owner?.workspace_id !== ctx.app.user.workspaceID) {
          return fail(`the credential Agent Wallets shows for ${made.value.id} on ${ctx.app.user.workspaceID} is about ${checked.claims.sub} on ` +
            `${checked.claims.owner?.workspace_id}`)
        }

        await card.getByRole('button', { name: 'Check it with Talyvor' }).click()
        const verdict = card.getByTestId('credential-verdict')
        await verdict.or(card.getByRole('alert')).first().waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
        const said = ((await verdict.textContent().catch(() => '')) ?? '').trim()
        ctx.evidence.push({ note: `Talyvor’s check of the credential, on the screen: "${said}"` })
        if (!said.startsWith('Valid')) return fail(`checking ${made.value.name}’s credential on Agent Wallets said "${said || 'nothing'}", not Valid`)
        ctx.evidence.push({ note: `the credential card, checked, ${await screenshots(ctx, agents, 'agent-credential', card)}` })
      } finally {
        await agents.close()
      }
      return {
        pass: true,
        detail: `${CAPABILITY}’s terms read and accepted on the screen, and Lens records them accepted at version ${fx.version}; the credential ` +
          'Agent Wallets shows verifies with only the published keys, and the screen’s check says Valid',
      }
    },
  }
}
