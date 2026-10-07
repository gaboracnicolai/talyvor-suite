// B28.286 — SESSION, CSRF AND XSS ARE BLOCKED. A person's session is one cookie the BFF sets (apps/bff auth.go setCookie:
// __Host-talyvor_session, Secure, HttpOnly, SameSite=Lax), and the BFF refuses every write whose Origin is not the app's
// own with 403 before any handler runs (apps/bff lens.go sameOriginWriteAllowed). Chat shows a model's answer through its
// own Markdown renderer (apps/web areas/chat/Markdown.tsx), and a room shows its messages — stored by Lens, read by
// everyone in the room — as text. Two scenarios, each on a workspace of its own:
//   csrf-refused — the session cookie is __Host-, Secure, HttpOnly and SameSite, and no script on the page can read it;
//        sent over plain http (an https app only) it reaches nothing. With the cookie attached, minting a key (POST
//        /api/keys) from another site, with no Origin, with Origin "null", from the app's host on the other scheme, from a
//        look-alike host and from a sibling subdomain is each refused 403, and so is revoking a key (DELETE /api/keys/{id})
//        from another site; a page on another site that posts a form to /api/keys in the signed-in browser is refused 403.
//        Lens holds no key any of them names. The control: the same mint from the app's own Origin is taken, and the key
//        it made is still there to be revoked after.
//   script-inert — an answer in Chat (made up in the browser, so no model is asked and nothing is charged) and a message
//        in a private room carry a <script>, event handlers, javascript: and data: links and an <iframe srcdoc>, each of
//        which sets a flag on the page if it ever runs: each is shown, no flag is set, no dialog opens, and nothing in the
//        answer or the conversation has an event handler, a script, a frame or a link to a javascript:, data: or vbscript:
//        address.

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Dialog, Locator, Page } from 'playwright'
import { fail } from './bank.ts'
import { verdictOf } from './gateway.ts'
import { madeUp } from './injection.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'

/** apps/bff auth.go sessionCookieName. */
const SESSION_COOKIE = '__Host-talyvor_session'
/** What every payload sets on the page if it runs. */
const FLAG = '__b28286'
const ACTION_MS = 30_000
const ANSWER_MS = 90_000
/** How long a payload is given to run once it is on screen: an <img>'s onerror fires after its load has failed. */
const SETTLE_MS = 1_500

interface Sent { status: number; text: string; location: string }

/** One request as a page on `origin` sends it (undefined: no Origin), carrying the session cookie: never thrown. */
async function send(url: string, method: string, cookie: string, origin: string | undefined, body?: unknown): Promise<Sent> {
  const headers: Record<string, string> = { Cookie: cookie, Accept: 'application/json' }
  if (origin !== undefined) headers.Origin = origin
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  try {
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(ACTION_MS) })
    return { status: res.status, text: await res.text(), location: res.headers.get('location') ?? '' }
  } catch (e) {
    return { status: 0, text: e instanceof Error ? e.message : String(e), location: '' }
  }
}

/** The Origins a write from somewhere else arrives with, beside the app's own `origin`. */
export function foreignOrigins(origin: string): { from: string; origin: string | undefined }[] {
  const u = new URL(origin)
  const port = u.port === '' ? '' : `:${u.port}`
  return [
    { from: 'another site', origin: 'https://evil.example' },
    { from: 'no Origin', origin: undefined },
    { from: 'Origin "null"', origin: 'null' },
    { from: "the app's host on the other scheme", origin: `${u.protocol === 'https:' ? 'http:' : 'https:'}//${u.host}` },
    { from: 'a look-alike host', origin: `${u.protocol}//${u.hostname}.evil.example${port}` },
    { from: 'a sibling subdomain', origin: `${u.protocol}//evil.${u.hostname}${port}` },
  ]
}

/** What is wrong with the session cookie as the browser holds it, for an app on `host`. */
export function cookieWrong(c: { secure: boolean; httpOnly: boolean; sameSite: string; path: string; domain: string } | undefined, host: string): string[] {
  if (c === undefined) return [`the browser holds no ${SESSION_COOKIE} cookie`]
  const wrong: string[] = []
  if (!c.secure) wrong.push('it is not Secure, so the browser sends it over plain http')
  if (!c.httpOnly) wrong.push('it is not HttpOnly, so a script on the page can read it')
  if (c.sameSite !== 'Lax' && c.sameSite !== 'Strict') wrong.push(`it is SameSite=${c.sameSite}, so another site's POST carries it`)
  if (c.path !== '/') wrong.push(`its Path is ${c.path}, not /`)
  if (c.domain !== host) wrong.push(`it is set for ${c.domain}, not for ${host} alone`)
  return wrong.map((w) => `the session cookie: ${w}`)
}

/** A page on another site — a local server — that posts a form to `action` as soon as it opens: a key named `name`. */
async function hostileSite(action: string, name: string): Promise<{ url: string; close: () => Promise<void> }> {
  // text/plain sends `<name>=<value>`: this name and value make the body the JSON object the mint route reads.
  const field = JSON.stringify({ name, scopes: ['proxy'], x: '' }).slice(0, -2)
  const html = `<!doctype html><title>another site</title>
<form id="f" method="POST" action="${action}" enctype="text/plain"><input type="hidden" name='${field}' value='"}'></form>
<script>document.getElementById('f').submit()</script>`
  const server = createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end(html))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, close: () => new Promise<void>((r) => {
    server.close(() => r())
    server.closeAllConnections()
  }) }
}

export function csrfRefused(): Scenario {
  return {
    id: 'csrf-refused',
    owner: 'talyvor-suite',
    own: true,
    feature: 'Session and sign-in',
    title: 'the session cookie is __Host-, Secure, HttpOnly and SameSite and no script reads it; a key minted with the cookie from another site, with no ' +
      'Origin, "null", the other scheme, a look-alike host or a sibling subdomain, a revoke from another site and a form posted by a page on ' +
      "another site are each refused 403, and Lens holds no key they name; from the app's own Origin the same mint is taken",
    run: async (ctx) => {
      const { app, env } = ctx
      const page = app.page
      const origin = new URL(page.url()).origin
      const host = new URL(origin).hostname
      const wrong: string[] = []

      // The session cookie, as the browser holds it and as a script on the page sees it.
      const jar = await app.context.cookies(origin)
      const session = jar.find((c) => c.name === SESSION_COOKIE)
      wrong.push(...cookieWrong(session, host))
      const scripted = await page.evaluate(() => document.cookie)
      if (scripted.includes(SESSION_COOKIE)) wrong.push('a script on the page reads the session cookie from document.cookie')
      ctx.evidence.push({ note: `the session cookie: ${session === undefined ? 'none' : `Secure ${session.secure}, HttpOnly ${session.httpOnly}, SameSite ${session.sameSite}, Path ${session.path}, for ${session.domain}`}; ` +
        `document.cookie names ${scripted.split(';').map((c) => c.split('=')[0].trim()).filter((n) => n !== '').join(', ') || 'nothing'}` })
      if (session === undefined) return fail(wrong.join('; '))
      const cookie = `${SESSION_COOKIE}=${session.value}`

      // Over plain http the cookie reaches nothing: the app sends it on to https or refuses it.
      if (origin.startsWith('https:')) {
        const plain = await send(`http://${new URL(origin).host}/api/context`, 'GET', cookie, undefined)
        ctx.evidence.push({ note: `GET http://${new URL(origin).host}/api/context with the cookie: ${plain.status || plain.text} ${plain.location}` })
        if (plain.status >= 200 && plain.status < 300) wrong.push(`over plain http the session cookie was answered ${plain.status}: ${plain.text.slice(0, 120)}`)
        if (plain.status >= 300 && plain.status < 400 && !plain.location.startsWith('https://')) wrong.push(`over plain http the app redirects to ${plain.location || 'nowhere'}, not to https`)
      } else {
        ctx.evidence.push({ note: `the app is served over ${new URL(origin).protocol} here, so there is no plain-http address to try; the cookie's Secure flag is what holds` })
      }

      // The control: a key minted from the app's own Origin is taken.
      const keys = `${origin}/api/keys`
      const control = await send(keys, 'POST', cookie, origin, { name: `csrf control ${RUN_SALT}`, scopes: ['proxy'] })
      let controlID: string | undefined
      try {
        controlID = (JSON.parse(control.text) as { id?: string }).id
      } catch { /* no id: the control was not taken */ }
      ctx.evidence.push({ note: `the control, POST /api/keys from ${origin}: ${control.status}${controlID === undefined ? ` ${control.text.slice(0, 120)}` : ''}` })
      if (control.status < 200 || control.status >= 300 || controlID === undefined) {
        return fail(`a key minted from the app's own Origin was answered ${control.status} ${control.text.slice(0, 160)}, so a refusal from anywhere else proves nothing`)
      }

      // The same mint from everywhere else, with the cookie attached.
      const named = `csrf-${RUN_SALT}`
      const tried: string[] = []
      for (const [n, f] of foreignOrigins(origin).entries()) {
        const r = await send(keys, 'POST', cookie, f.origin, { name: `${named}-${n}`, scopes: ['proxy'] })
        tried.push(`${f.from} ${r.status}`)
        if (r.status !== 403) wrong.push(`a key minted from ${f.from} (${f.origin ?? 'no Origin header'}) was answered ${r.status || r.text}, not 403`)
      }
      const revoke = `${keys}/${encodeURIComponent(controlID)}`
      const foreignRevoke = await send(revoke, 'DELETE', cookie, 'https://evil.example')
      tried.push(`revoke from another site ${foreignRevoke.status}`)
      if (foreignRevoke.status !== 403) wrong.push(`revoking a key from another site was answered ${foreignRevoke.status || foreignRevoke.text}, not 403`)

      // A page on another site, open in the signed-in browser, posts a form to the mint route.
      const site = await hostileSite(keys, `${named}-form`)
      const hostile = await app.context.newPage()
      try {
        const [posted] = await Promise.all([
          hostile.waitForResponse((r) => r.request().method() === 'POST' && r.url() === keys, { timeout: ACTION_MS }),
          hostile.goto(site.url),
        ])
        tried.push(`a form posted by a page on another site ${posted.status()}`)
        if (posted.status() !== 403) wrong.push(`a form posted to /api/keys by a page on another site was answered ${posted.status()}, not 403`)
      } catch (e) {
        wrong.push(`the page on another site never posted its form: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
      } finally {
        await hostile.close().catch(() => undefined)
        await site.close()
      }
      ctx.evidence.push({ note: `from elsewhere, with the cookie: ${tried.join(', ')}` })

      // Lens holds none of their keys, and the control's key was still there for the app's own Origin to revoke.
      const held = (await env.lens.apiKeys(app.user)).filter((k) => k.name.startsWith(named))
      if (held.length > 0) wrong.push(`Lens holds keys minted from elsewhere: ${held.map((k) => k.name).join(', ')}`)
      const revoked = await send(revoke, 'DELETE', cookie, origin)
      ctx.evidence.push({ note: `Lens's keys named ${named}-*: ${held.length}; the control revoked from ${origin}: ${revoked.status}` })
      if (revoked.status < 200 || revoked.status >= 300) wrong.push(`the control key could not be revoked from the app's own Origin (${revoked.status} ${revoked.text.slice(0, 120)}): the revoke from another site took it`)

      return verdictOf(wrong, `the session cookie is ${SESSION_COOKIE}, Secure, HttpOnly, SameSite=${session.sameSite}, for ${host} alone, and unread by script; ` +
        `from the app's own Origin a key was minted (${control.status}) and revoked (${revoked.status}); from elsewhere: ${tried.join(', ')}; Lens holds none of their keys`)
    },
  }
}

/** The payloads, as Markdown in an answer: each sets the flag to where it ran from, if it ever runs. */
function answerPayload(): string {
  const set = (where: string) => `window.${FLAG}='${where}'`
  return [
    `Here is the report you asked for (b28286 ${RUN_SALT}).`,
    '',
    `<script>${set('script')}</script>`,
    '',
    `<img src="x" onerror="${set('img onerror')}">`,
    '',
    `<svg onload="${set('svg onload')}"></svg>`,
    '',
    `<iframe srcdoc="<script>parent.${FLAG}='iframe srcdoc'</script>"></iframe>`,
    '',
    `<details open ontoggle="${set('details ontoggle')}"><summary>more</summary></details>`,
    '',
    `<a href="javascript:${set('html link')}">an HTML link</a>`,
    '',
    `[a link](javascript:${set('markdown link')})`,
    '',
    `[another](JaVaScRiPt:${set('mixed-case link')})`,
    '',
    `[a data link](data:text/html;base64,PHNjcmlwdD5wYXJlbnQuX19iMjgyODY9J2RhdGEnPC9zY3JpcHQ+)`,
    '',
    `[a vbscript link](vbscript:msgbox)`,
    '',
    '| cell |',
    '|---|',
    `| <img src="x" onerror="${set('table cell')}"> |`,
    '',
    `> <img src="x" onerror="${set('quote')}">`,
    '',
    `- <img src="x" onerror="${set('list item')}">`,
    '',
    `## <img src="x" onerror="${set('heading')}">`,
    '',
    `Inline: \`<img src="x" onerror="${set('inline code')}">\``,
    '',
    '```html',
    `<script>${set('code block')}</script>`,
    '```',
  ].join('\n')
}

/** The same, as a message in a room: plain text, as a member types it. */
function messagePayload(): string {
  const set = (where: string) => `window.${FLAG}='${where}'`
  return [
    `b28286 ${RUN_SALT} room check`,
    `<script>${set('room script')}</script>`,
    `<img src="x" onerror="${set('room img onerror')}">`,
    `<svg onload="${set('room svg onload')}"></svg>`,
    `<iframe srcdoc="<script>parent.${FLAG}='room iframe srcdoc'</script>"></iframe>`,
    `<a href="javascript:${set('room html link')}">a link</a>`,
    `[a link](javascript:${set('room markdown link')})`,
  ].join('\n')
}

/** Everything in `where` that runs or loads: a script, a frame, an event handler, a link or source to a javascript:, data: or vbscript: address. */
async function runnable(where: Locator): Promise<string[]> {
  return where.evaluate((root) => {
    const found: string[] = []
    const scheme = /^(javascript|data|vbscript):/
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const tag = el.tagName.toLowerCase()
      if (['script', 'iframe', 'frame', 'object', 'embed', 'base', 'meta', 'form', 'link'].includes(tag)) found.push(`<${tag}>`)
      for (const a of Array.from(el.attributes)) {
        const name = a.name.toLowerCase()
        // A browser ignores whitespace and control characters in a URL's scheme: so does this.
        const value = a.value.replace(/[\u0000- ]/g, '').toLowerCase()
        if (name.startsWith('on') || name === 'srcdoc' ||
          (['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster'].includes(name) && scheme.test(value))) {
          found.push(`<${tag} ${a.name}="${a.value.slice(0, 60)}">`)
        }
      }
    }
    return found
  })
}

/** What the page shows ran: the flag, in the page or any of its frames. */
async function ran(page: Page): Promise<string[]> {
  const seen: string[] = []
  for (const f of page.frames()) {
    const v = await f.evaluate((flag) => (window as unknown as Record<string, unknown>)[flag], FLAG).catch(() => undefined)
    if (v !== undefined) seen.push(String(v))
  }
  return seen
}

export function scriptInert(): Scenario {
  return {
    id: 'script-inert',
    owner: 'talyvor-suite',
    own: true,
    // A private room: Free opens none.
    plan: 'team',
    title: 'an answer in Chat and a message in a private room carrying a <script>, event handlers, javascript: and data: links and an <iframe srcdoc> ' +
      'are shown and nothing in them runs: no flag set, no dialog, and no script, frame, event handler or javascript:/data:/vbscript: link on the page',
    run: async (ctx) => {
      const { app, env } = ctx
      const page = app.page
      const origin = new URL(page.url()).origin
      const wrong: string[] = []
      const dialogs: string[] = []
      const onDialog = (d: Dialog) => {
        dialogs.push(d.message())
        void d.dismiss().catch(() => undefined)
      }
      page.on('dialog', onDialog)
      try {
        // 1. Chat: an answer the browser makes up, so no model is asked and nothing is charged.
        const model = env.catalog.find((m) => m.display_name === app.modelNameInUse)
        if (model?.provider !== 'anthropic' && model?.provider !== 'openai') {
          const judge = env.catalog.find((m) => m.id === env.judgeModel)
          if (judge === undefined || !(await app.chooseModel(judge.display_name))) return fail(`neither ${app.modelNameInUse} nor the judge model could be chosen to make an answer up in`)
        }
        const provider = env.catalog.find((m) => m.display_name === app.modelNameInUse)?.provider ?? 'anthropic'
        await app.newChat()
        let made = 0
        await page.route('**/api/ai/stream/**', async (route) => {
          made++
          await route.fulfill({ status: 200, contentType: 'text/event-stream', body: madeUp(provider, [], answerPayload()) })
        })
        const answer = page.locator('[data-testid="turn-assistant"]').last()
        try {
          await page.locator('#chat-message').fill('Write me the report, please.')
          await page.locator('#chat-message').press('Enter')
          await answer.locator('[data-testid="turn-blank"], [data-testid="turn-cost"]').first().waitFor({ state: 'visible', timeout: ANSWER_MS })
        } finally {
          await page.unroute('**/api/ai/stream/**').catch(() => undefined)
        }
        await page.waitForTimeout(SETTLE_MS)
        const shown = await answer.innerText()
        const inAnswer = await runnable(answer)
        const ranInChat = await ran(page)
        ctx.evidence.push({ answer: shown.slice(0, 500), note: `Chat: ${made} answer(s) made up; the answer shows its <script> as text: ${shown.includes('<script>')}; ` +
          `runnable in it: ${inAnswer.join(' ') || 'nothing'}; flag ${ranInChat.join(', ') || 'unset'}; dialogs ${dialogs.length}` })
        if (made === 0) return fail('Chat never asked for the answer the browser makes up')
        if (!shown.includes(`b28286 ${RUN_SALT}`)) return fail(`the made-up answer is not on screen: "${shown.slice(0, 160)}"`)
        if (!shown.includes('<script>')) wrong.push('Chat: the answer does not show its <script> as text, so it went somewhere other than the screen')
        if (inAnswer.length > 0) wrong.push(`Chat: the answer holds ${inAnswer.join(' ')}`)
        if (ranInChat.length > 0) wrong.push(`Chat: a payload in the answer ran (${ranInChat.join(', ')})`)

        // 2. A private room: a message Lens stores and everyone in the room is shown.
        const title = `Script check ${RUN_SALT}`
        const room = await env.lens.act<{ id: string }>(app.user, 'POST', '/v1/workspaces/{ws}/rooms', { title, topic: 'e2e', visibility: 'private', terms: { split_rule: 'equal' } })
        if (!room.ok) return fail(`opening a private room on Team was refused: ${room.status} ${room.error}`)
        const body = messagePayload()
        const posted = await env.lens.act<{ id: string }>(app.user, 'POST', `/v1/rooms/${encodeURIComponent(room.value.id)}/messages`, { body })
        ctx.evidence.push({ note: `room ${room.value.id}: the message posted ${posted.ok ? posted.status : `refused ${posted.status} ${posted.error}`}` })
        if (posted.ok) {
          await page.goto(`${origin}/rooms/${encodeURIComponent(room.value.id)}`)
          const messages = page.getByRole('list', { name: 'Messages' })
          const shownInRoom = await messages.getByText(`b28286 ${RUN_SALT} room check`).first()
            .waitFor({ state: 'visible', timeout: ACTION_MS }).then(() => true, () => false)
          if (!shownInRoom) return fail(`the room's screen does not show the message Lens stored in room ${room.value.id}`)
          await page.waitForTimeout(SETTLE_MS)
          const inRoom = await runnable(messages)
          const ranInRoom = await ran(page)
          ctx.evidence.push({ note: `the room's screen: runnable in its messages: ${inRoom.join(' ') || 'nothing'}; flag ${ranInRoom.join(', ') || 'unset'}; dialogs ${dialogs.length}` })
          if (inRoom.length > 0) wrong.push(`the room: its messages hold ${inRoom.join(' ')}`)
          if (ranInRoom.length > 0) wrong.push(`the room: a payload in a message ran (${ranInRoom.join(', ')})`)
        }
        if (dialogs.length > 0) wrong.push(`a dialog opened: ${dialogs.join(' | ')}`)
        return verdictOf(wrong, `Chat showed the made-up answer with its <script> as text and nothing runnable in it; ` +
          `${posted.ok ? 'the room showed the stored message with nothing runnable in it' : `Lens refused the message (${posted.status})`}; no flag set, no dialog`)
      } finally {
        page.off('dialog', onDialog)
      }
    },
  }
}
