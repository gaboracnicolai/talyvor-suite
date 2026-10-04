import { Button, ThemeToggle, focusRing, inlineLink } from '@talyvor/ui'
import { useDocumentTitle } from '../../documentTitle'
import { SectionLabel } from '../marketing/Landing'
import {
  CAPABILITIES,
  CHANGE_DATE,
  CHANGE_LICENCE,
  DOCUMENTATION_PATH,
  LENS_ORIGIN,
  LICENCES,
  START,
  licenceUrl,
  type Claim,
} from './content'
import lensRoutes from './lens-routes.json'

// /documentation (B27.31) — what Talyvor does today, one claim per thing a person can do, each
// linked to the screen or route that does it. Public, OUTSIDE the AuthGate like /marketing and
// /pricing, and built the same way: no router context, plain anchors, Landing's instrument
// language. A signed-out reader who follows a link into the console meets the sign-in card there.
//
// ⚠ NOT /docs. /docs/* is the Docs product — the team wiki — and has been since before this page;
// mounting the documentation there would take the wiki's index away from every signed-in user.

function ClaimRow({ claim }: { claim: Claim }) {
  return (
    <li className="flex flex-col gap-1 border-t border-rule py-4 wide:flex-row wide:items-baseline wide:justify-between wide:gap-8">
      <p className="max-w-2xl text-body text-ink">{claim.text}</p>
      <a href={claim.href} className={`shrink-0 text-caption text-muted ${inlineLink}`}>
        {claim.label}
      </a>
    </li>
  )
}

function Claims({ claims }: { claims: Claim[] }) {
  return (
    <ul className="mt-8 border-b border-rule">
      {claims.map((c) => (
        <ClaimRow key={`${c.href} ${c.text}`} claim={c} />
      ))}
    </ul>
  )
}

const ROUTE_COUNT = lensRoutes.groups.reduce((n, g) => n + g.routes.length, 0)

function LensReference() {
  return (
    <div className="mt-10 flex flex-col gap-3">
      {lensRoutes.groups.map((g) => (
        <details key={g.id} id={`lens-${g.id}`} className="scroll-mt-16 rounded-card border border-rule bg-surface">
          <summary className={`cursor-pointer list-none px-gutter py-4 ${focusRing}`}>
            <span className="text-head text-ink">{g.title}</span>
            <span className="ml-3 font-figure text-caption text-faint">
              {g.routes.length} {g.routes.length === 1 ? 'route' : 'routes'}
            </span>
          </summary>
          <div className="border-t border-rule px-gutter py-4">
            <p className="max-w-2xl text-body text-muted">{g.about}</p>
            {g.screen ? (
              <p className="mt-2 text-caption text-muted">
                In the app:{' '}
                <a href={g.screen.href} className={`text-ink ${inlineLink}`}>
                  {g.screen.label}
                </a>
              </p>
            ) : null}
            <table className="mt-4 w-full text-left">
              <thead>
                <tr className="font-figure text-eyebrow uppercase text-faint">
                  <th scope="col" className="py-2 pr-4 font-normal">
                    Method
                  </th>
                  <th scope="col" className="py-2 pr-4 font-normal">
                    Path
                  </th>
                  <th scope="col" className="py-2 font-normal">
                    What it does
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.routes.map((r) => (
                  <tr key={`${r.method} ${r.path}`} className="border-t border-rule align-baseline">
                    <td className="py-2 pr-4 font-mono text-caption text-muted">{r.method}</td>
                    <td className="break-all py-2 pr-4 font-mono text-caption text-ink">{r.path}</td>
                    <td className="py-2 text-caption text-muted">{r.does}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  )
}

const CONTENTS: Array<{ id: string; label: string }> = [
  { id: 'start', label: 'Start here' },
  { id: 'lens', label: 'Lens API' },
  ...CAPABILITIES.map((c) => ({ id: c.id, label: c.name })),
  { id: 'licences', label: 'Licences' },
]

export function Documentation() {
  useDocumentTitle('Documentation')
  return (
    <div className="flex min-h-full flex-col bg-canvas text-ink">
      <header className="sticky top-0 z-10 border-b border-rule bg-canvas">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-y-2 px-gutter py-3">
          <a href="/marketing" className={`block ${focusRing}`}>
            <div className="text-head text-ink">Talyvor</div>
            <div className="text-caption font-normal text-faint">Suite</div>
          </a>
          <div className="flex items-center gap-3">
            <a href="/pricing" className={`text-body text-muted ${inlineLink}`}>
              Pricing
            </a>
            <a href={DOCUMENTATION_PATH} aria-current="page" className={`text-body text-ink ${inlineLink}`}>
              Documentation
            </a>
            <ThemeToggle />
            <Button asChild>
              <a href="/">Open the app</a>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section aria-labelledby="documentation-heading" className="border-b border-rule">
          <div className="mx-auto w-full max-w-5xl px-gutter pb-12 pt-16 wide:pt-20">
            <SectionLabel index="00">Documentation</SectionLabel>
            <h1 id="documentation-heading" className="mt-7 max-w-3xl text-display-2 text-ink">
              What Talyvor does today, and where to do it.
            </h1>
            <p className="mt-6 max-w-2xl text-lede text-muted">
              Every line below is something you can do now. Each links to the screen that does it, or
              names the API route. Nothing here is planned work.
            </p>
            <nav aria-label="On this page" className="mt-10">
              <ul className="flex flex-wrap gap-x-6 gap-y-2 text-body">
                {CONTENTS.map((c) => (
                  <li key={c.id}>
                    <a href={`#${c.id}`} className={`text-muted ${inlineLink}`}>
                      {c.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </section>

        <section id="start" aria-labelledby="start-heading" className="scroll-mt-16 border-b border-rule">
          <div className="mx-auto w-full max-w-5xl px-gutter py-16">
            <SectionLabel index="01">Start here</SectionLabel>
            <h2 id="start-heading" className="mt-6 max-w-2xl text-display-3 text-ink">
              From sign-up to your first metered request.
            </h2>
            <Claims claims={START} />
          </div>
        </section>

        <section id="lens" aria-labelledby="lens-heading" className="scroll-mt-16 border-b border-rule">
          <div className="mx-auto w-full max-w-5xl px-gutter py-16">
            <SectionLabel index="02">Lens API</SectionLabel>
            <h2 id="lens-heading" className="mt-6 max-w-2xl text-display-3 text-ink">
              One gateway for every model call.
            </h2>
            <div className="mt-8 grid gap-x-12 gap-y-6 wide:grid-cols-2">
              <p className="text-body text-muted">
                The hosted gateway is <span className="font-mono text-ink">{LENS_ORIGIN}</span>. Every
                route except the public ones takes your key as{' '}
                <span className="font-mono text-ink">Authorization: Bearer &lt;key&gt;</span> or{' '}
                <span className="font-mono text-ink">X-Talyvor-Key: &lt;key&gt;</span>. The{' '}
                <span className="font-mono text-ink">{'{wsID}'}</span> in a path is your workspace’s id,
                and a key only reaches its own workspace.
              </p>
              <p className="text-body text-muted">
                Below is every route a customer can call, {ROUTE_COUNT} of them, read from Lens’s
                source and each answered by the hosted gateway. Admin and operator routes are not
                listed. The core routes are also described in the gateway’s{' '}
                <a href={`${LENS_ORIGIN}/openapi.json`} className={`text-ink ${inlineLink}`}>
                  OpenAPI document
                </a>
                , and its{' '}
                <a href={`${LENS_ORIGIN}/status`} className={`text-ink ${inlineLink}`}>
                  status page
                </a>{' '}
                says whether it is up.
              </p>
            </div>
            <LensReference />
          </div>
        </section>

        {CAPABILITIES.map((c, i) => (
          <section
            key={c.id}
            id={c.id}
            aria-labelledby={`${c.id}-heading`}
            className="scroll-mt-16 border-b border-rule"
          >
            <div className="mx-auto w-full max-w-5xl px-gutter py-16">
              <SectionLabel index={String(i + 3).padStart(2, '0')}>{c.role}</SectionLabel>
              <h2 id={`${c.id}-heading`} className="mt-6 max-w-2xl text-display-3 text-ink">
                {c.name}
              </h2>
              <p className="mt-4 max-w-2xl text-body text-muted">{c.lede}</p>
              <Claims claims={c.claims} />
            </div>
          </section>
        ))}

        <section id="licences" aria-labelledby="licences-heading" className="scroll-mt-16">
          <div className="mx-auto w-full max-w-5xl px-gutter py-16">
            <SectionLabel index={String(CAPABILITIES.length + 3).padStart(2, '0')}>Licences</SectionLabel>
            <h2 id="licences-heading" className="mt-6 max-w-2xl text-display-3 text-ink">
              Source-available, not open source.
            </h2>
            <p className="mt-4 max-w-2xl text-body text-muted">
              Each repository is under the Business Source License 1.1, which lets you read the source
              and use it on the terms in its LICENSE file; it is not an open-source licence. On the
              Change Date, <span className="font-figure text-ink">{CHANGE_DATE}</span> — or four years
              after a version is first published, if that comes first — that version becomes available
              under the {CHANGE_LICENCE}. The LICENSE file in each repository is the authority.
            </p>
            <ul className="mt-8 border-b border-rule">
              {LICENCES.map((l) => (
                <li
                  key={l.repo}
                  className="flex flex-col gap-1 border-t border-rule py-4 wide:flex-row wide:items-baseline wide:justify-between wide:gap-8"
                >
                  <div className="max-w-2xl">
                    <p className="font-mono text-body text-ink">{l.repo}</p>
                    <p className="text-caption text-muted">{l.what}</p>
                  </div>
                  <div className="shrink-0 text-caption text-muted wide:text-right">
                    <a href={licenceUrl(l.repo)} className={`text-ink ${inlineLink}`}>
                      {l.licence}
                    </a>
                    {l.except ? <p className="max-w-xs">Except: {l.except}.</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-gutter py-6">
          <div className="font-figure text-eyebrow uppercase text-faint">
            Talyvor Ltd · self-hosted AI development
          </div>
          <div className="text-caption text-faint">
            <a href="/privacy" className={inlineLink}>
              Privacy
            </a>
            {' · '}
            <a href="/terms" className={inlineLink}>
              Terms
            </a>
            {' · '}
            <a href="/pricing" className={inlineLink}>
              Pricing
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
