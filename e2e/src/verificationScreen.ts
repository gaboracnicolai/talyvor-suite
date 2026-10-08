// B30.116 — the Verification screen (/settings/verification), once a run, in the browser, on a workspace of its own so
// it starts at L0 every night. The owner confirms an email and phone from the screen's form (L1), then has its identity
// checked (L2). The Test provider checked both, so the screen must show L2, the live level L0, both checks marked
// "Test — counts for test money only" with their evidence references, "Preview — test money only", and beside paying
// outside Talyvor (payments_out) L2 and beside credit to companies (b2b_credit) L3. Screenshots at 1440 and 390.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'
import { LEVELS_NEEDED } from './verification.ts'

const TIMEOUT_MS = 20_000

/** Waits for the heading the next level's form carries; on a refusal, what the screen said instead. */
async function reached(page: Page, heading: string): Promise<string | undefined> {
  const next = page.getByRole('heading', { name: heading })
  const refused = page.getByRole('alert')
  await next.or(refused).first().waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
  if (await next.isVisible()) return undefined
  const said = (await refused.allTextContents()).join(' ').trim()
  return said === '' ? `the screen never showed "${heading}"` : `the screen said "${said}" instead of showing "${heading}"`
}

export function verificationScreen(): Scenario {
  return {
    id: 'verification-screen',
    owner: 'talyvor-suite',
    own: true,
    items: ['B30.116'],
    title: 'the Verification screen: an owner reaches L1 then L2 from its forms on the Test provider and sees L2, the live level L0, ' +
      'each check marked Test with its evidence reference, and payments_out at L2 and b2b_credit at L3',
    run: async (ctx) => {
      const page = await ctx.app.tab('/settings/verification')
      try {
        await page.locator('header h1').filter({ hasText: 'Verification' }).waitFor({ timeout: TIMEOUT_MS })
        const atL0 = await reached(page, 'Reach L1: email and phone confirmed')
        if (atL0 !== undefined) return fail(`a new workspace on the Verification screen: ${atL0}`)

        await page.getByLabel('Email', { exact: true }).fill(`nightly-screen-${RUN_SALT}@example.com`)
        await page.getByLabel('Phone, in international form', { exact: true }).fill('+447700900123')
        await page.getByRole('button', { name: 'Check email and phone' }).click()
        const atL1 = await reached(page, 'Reach L2: identity checked')
        ctx.evidence.push({ note: `email and phone checked from the screen: ${atL1 ?? 'the identity form is next'}` })
        if (atL1 !== undefined) return fail(`after the email and phone check: ${atL1}`)

        await page.getByLabel('Full name', { exact: true }).fill('Nightly Screen Owner')
        await page.getByLabel('Country', { exact: true }).fill('GB')
        await page.getByLabel('Date of birth', { exact: true }).fill('1990-04-12')
        await page.getByRole('button', { name: 'Check identity' }).click()
        const atL2 = await reached(page, 'Reach L3: company checked')
        ctx.evidence.push({ note: `identity checked from the screen: ${atL2 ?? 'the company form is next'}` })
        if (atL2 !== undefined) return fail(`after the identity check: ${atL2}`)

        const text = async (id: string) => ((await page.getByTestId(id).first().textContent({ timeout: TIMEOUT_MS })) ?? '').trim()
        const level = await text('verification-level')
        const live = await text('verification-live-level')
        ctx.evidence.push({ note: `the screen shows level "${level}" and live level "${live}"` })
        if (!level.startsWith('L2')) return fail(`after two checks the screen shows the level "${level}", not L2`)
        if (!live.startsWith('L0')) return fail(`after two Test checks the screen shows the live level "${live}", not L0: a Test pass counts for test money only`)
        if (!(await text('verification-preview')).includes('Preview — test money only')) return fail('the screen does not say "Preview — test money only"')

        const checks = await page.getByTestId('verification-check').allTextContents()
        ctx.evidence.push({ note: `the checks listed: ${checks.join(' | ')}` })
        if (checks.length !== 2) return fail(`the screen lists ${checks.length} checks, not the two that passed`)
        for (const [i, want] of ['L2', 'L1'].entries()) {
          const c = checks[i]
          if (!c.startsWith(want)) return fail(`check ${i + 1}, newest first, is "${c}", not ${want}`)
          if (!c.includes('Test — counts for test money only')) return fail(`the ${want} check is not marked "Test — counts for test money only": "${c}"`)
          if (!/Evidence reference\s*\S+/.test(c)) return fail(`the ${want} check shows no evidence reference: "${c}"`)
        }

        for (const [key, want] of Object.entries(LEVELS_NEEDED)) {
          const row = page.getByTestId(`capability-level-${key}`)
          if ((await row.count()) === 0) return fail(`the screen lists no level beside ${key}`)
          const shown = ((await row.textContent()) ?? '').trim()
          if (!shown.endsWith(want)) return fail(`beside ${key} the screen shows "${shown}"; its live money needs ${want}`)
        }

        const { outDir } = ctx.env
        await mkdir(outDir, { recursive: true })
        const wide = join(outDir, `verification-1440px-user${ctx.app.user.index}.png`)
        const narrow = join(outDir, `verification-390px-user${ctx.app.user.index}.png`)
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.screenshot({ path: wide, fullPage: true })
        await page.setViewportSize({ width: 390, height: 844 })
        await page.screenshot({ path: narrow, fullPage: true })
        ctx.evidence.push({ note: `the Verification screen at L2, at 1440px: ${wide}; at 390px: ${narrow}` })
        return {
          pass: true,
          detail: 'from the screen\'s forms: email and phone made L1 and identity L2; it shows L2, live L0, both checks marked Test with ' +
            'their evidence references, Preview — test money only, payments_out at L2 and b2b_credit at L3',
        }
      } finally {
        await page.close()
      }
    },
  }
}
