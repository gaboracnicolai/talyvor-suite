// Generate a changelog entry on this page — the fifth W1.7 control to reach a browser, and the
// FIRST one that is not an AI call.
//
// ── WHY THIS ONE COULD BE BUILT, AND ON A DIFFERENT ARGUMENT FROM THE OTHER FOUR ──
//
// Summarise and translate could be built because their result is READ rather than inserted, so
// they need no editor. This one needs no editor for a stronger reason: it does not produce text
// for a human to place anywhere. `POST …/changelog/generate` WRITES its own row, on its own
// table, with its own shape — the page's document is never touched. Whether the entry's
// ProseMirror `content` is later editable is the W2.3 question and is untouched here.
//
// ── WHAT IT COSTS, AND IT IS NOT MONEY ──────────────────────────────────────
//
// W1.7 lists changelog generation among "eight AI features, every one a metered Lens call". That
// is false for this one, MEASURED rather than read: `GenerateFromIssues` reaches Lens never — it
// asks Track for each issue and groups them by label (talyvor-docs
// internal/changelog/store.go#GenerateFromIssues). No completion, no feature tag, no page's
// `own_ai_cost_usd` moves. So this card must NOT print the cost sentence the other four print;
// stating a charge that does not exist is as false as hiding one that does.
//
// What a click DOES cost is a row. It persists on this page, a later PATCH can retitle it, and
// `…/changelog/entries/{id}/publish` puts it into the workspace's public RSS feed
// (internal/changelog/handler.go#Handler.Feed). That is what the sentence beside the result says.
//
// ── THE STATE THIS COMPONENT REFUSES TO BE IN, WHICH IS THE WHOLE POINT ─────
//
// MEASURED against talyvor-docs' own Generate route at ce997ff — the real route, the real
// permission.Enforcer, real Postgres and the real trackintegration.Client (tab-6d1a, a `git
// archive` scratch export in /tmp; that repository is held by another tab and was never written
// to):
//
//	{"version":"v1.0.0","issue_ids":[]}             → 201 Created, one durable row
//	{"version":"v1.1.0"}                            → 201 Created, one durable row
//	{"version":"v1.2.0","issue_ids":null}           → 201 Created, one durable row
//	{"version":"v5.0.0","issue_ids":["","  ","\t"]} → 201 Created, "Generated from 3 issues"
//
// and the row the first one wrote, read back with SQL: summary "Generated from 0 issues", body
// `…"text":"No issues."…`. Nothing on that path has an empty-list precondition. The last row is
// the worse one — it claims a count of three over three EMPTY bullets. So a "Generate" button
// that fires with nothing selected produces a permanent, publishable release note that documents
// nothing, and answers 201 while doing it. The button does not fire.
//
// ── AND NO VERSION RULE, FOR THE REASON PageTranslation HAS NO LANGUAGE LIST ─
//
// Upstream owns the version vocabulary and enforces it: measured, 400 with its own message for
// "", "   " and "banana", and 201 for both "v1.0.0" and "2026-08-18". A rule here would be a
// screen authoring a vocabulary it does not own, and it would drift the day Docs widens the
// regexp. The refusal that IS here exists because upstream has no rule at all for it.
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, Card, CardHeader, Input } from '@talyvor/ui'
import { docsApi } from './api'
import { isSessionExpired } from '../../lib/productState'

/** Split the free-text issue box into ids, dropping everything blank.
 *
 * ⚠ IT IS EXPORTED SO A TEST CAN DRIVE IT DIRECTLY, and it is the SAME predicate the BFF applies
 * (docs_changelog.go counts ids with a non-blank trim). Two halves of one rule, because the BFF's
 * half is the one that holds when the caller is not this screen. */
export function issueIdsFrom(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

/**
 * @param spaceId the space in the upstream path — this is the only Docs control in this app whose
 *                upstream route is SPACE-scoped, because Docs gates it on the page inside it.
 * @param pageId  the page the generated entry is written TO.
 */
export function PageChangelog({ spaceId, pageId }: { spaceId: string; pageId: string }) {
  const [version, setVersion] = useState('')
  // ⚠ A FREE-TEXT BOX RATHER THAN A PICKER, AND THAT IS A LIMIT WORTH NAMING RATHER THAN HIDING.
  // A picker would need Track's issue list for this workspace, which no route in this BFF serves
  // in a form this screen could scope to a release. Typing ids is the honest control for the
  // parameter that actually exists; the picker is a real thing to build and is not this merge.
  const [issues, setIssues] = useState('')
  const ids = issueIdsFrom(issues)
  const generate = useMutation({
    mutationFn: () => docsApi.generateChangelog(spaceId, pageId, version, ids),
  })

  // ⚠ THE OUTCOME DISPLACES THE GUIDANCE, AND THE FAILURE STATE IS READ FIRST. Once this control
  // has an answer — a fault or an entry — the sentence under the button is no longer the thing to
  // lead with, and a refusal least of all: "name at least one issue" printed beside a generate
  // that just failed reads as advice about the failure. emptyVsFault.test.ts is the guard that
  // holds this ordering for the whole app, and it caught this component before this line existed.
  const showGuidance = !generate.isError && !generate.data
  // The same predicate the BFF applies, for the same measured reason, and deliberately no wider.
  // Note it is about the ISSUES and not about the version: see the header.
  const nothingToGenerateFrom = ids.length === 0

  return (
    <Card>
      <CardHeader>Changelog entry</CardHeader>
      <div className="flex flex-col gap-2 px-gutter py-3">
        <div className="flex items-center gap-2">
          <label className="text-caption text-muted" htmlFor="changelog-version">
            Version
          </label>
          <Input
            id="changelog-version"
            className="max-w-32"
            value={version}
            placeholder="e.g. v1.4.0"
            onChange={(e) => setVersion(e.target.value)}
          />
          <label className="text-caption text-muted" htmlFor="changelog-issues">
            Issues
          </label>
          <Input
            id="changelog-issues"
            className="max-w-64"
            value={issues}
            placeholder="ENG-1, ENG-2"
            onChange={(e) => setIssues(e.target.value)}
          />
          {/* The default variant, deliberately: `primary` is this app's ink-on-colour and Save on
              the reader above already owns it. */}
          <Button
            disabled={generate.isPending || nothingToGenerateFrom}
            onClick={() => generate.mutate()}
          >
            {generate.isPending ? 'Generating…' : 'Generate entry'}
          </Button>
        </div>
        {!showGuidance ? null : nothingToGenerateFrom ? (
          // ⚠ THIS SENTENCE IS THE FINDING, MADE VISIBLE. Upstream this exact state is a 201 and a
          // durable, publishable row whose body is the words "No issues."
          <span className="text-caption text-faint">
            Name at least one issue — with none, Docs would still create an entry, and its body
            would be the words “No issues.”
          </span>
        ) : (
          <span className="text-caption text-faint">
            Groups {ids.length === 1 ? 'this issue' : `these ${ids.length} issues`} by their Track
            labels. Docs writes the entry; it does not ask a model.
          </span>
        )}

        {/* ⚠ ONE CHAIN, FAILURE FIRST — not two sibling containers. A refused generate must never
            be able to render as a created entry, and a sibling error arm that closes before the
            success branch cannot guard that: emptyVsFault.test.ts measured exactly that shape on
            IssueList.tsx. */}
        {generate.isError ? (
          <p className="text-body text-muted">
            {isSessionExpired(generate.error) ? null : (
              <>Couldn’t generate this entry — nothing was written. Try again.</>
            )}
          </p>
        ) : generate.data ? (
          <>
            <p className="text-body text-ink">
              {generate.data.title} — {generate.data.summary}
            </p>
            {/* THE SENTENCE THE OTHER FOUR CONTROLS CANNOT SHARE. There is no charge to name here
                and there IS a row to name, so this says what was left behind and where it is not
                yet. Publishing is a separate upstream act (…/entries/{id}/publish) that this app
                does not offer. */}
            <p className="text-caption text-faint">
              Saved to this page’s changelog as <code>{generate.data.type}</code>. It is not
              published, so it is not in the workspace’s changelog feed yet.
            </p>
            {/* Said out loud because the grouping is only as good as Track's answer, and a bare id
                in the body is the one-directional evidence that a lookup did not resolve. */}
            <p className="text-caption text-muted">
              Issues Track could not resolve are listed by id alone, under “Improvements”.
            </p>
          </>
        ) : null}
      </div>
    </Card>
  )
}
