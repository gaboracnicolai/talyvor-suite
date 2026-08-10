import { LegalHeader, LawyerReview, Section } from './legalParts'

// Privacy — a factual account of what this system stores, read from the code, not a template.
//
// ⚠ EVERY CLAIM HERE WAS VERIFIED AGAINST SOURCE. Where the code and an existing screen disagree,
// the disagreement is stated rather than smoothed over. The file references are deliberate: they
// are how the next person checks this is still true, and a claim nobody can re-verify decays into
// the same category as an invented number.
//
// Sources for the load-bearing claims, all in talyvor-lens:
//   prompt text        internal/proxy/proxy.go:1485-1492, internal/alerts/alerts.go:182-184
//   default policy     internal/workspace/manager.go:35-42 (unknown/empty ⇒ "metadata")
//   cache contents     migrations/0001_init.sql prompt_embeddings (response TEXT NOT NULL)
//   retention reset    internal/cache/semantic.go:142 (touch bumps updated_at) + :153 (sweep on it)
//   pooling gate       internal/cache/semantic.go (is_poolable) + LENS_CACHE_POOLABLE_ENABLED
export function Privacy() {
  return (
    // `main`, NOT `div` — same element, same classes. 6,447 of this page's 6,584 characters (98%)
    // sat outside every landmark region: the only region was LegalHeader's <header>, which holds
    // the title block. A person deciding whether to hand us their data reads this page BEFORE they
    // have an account, and could not jump to its content. ⚠ ONE CONSEQUENCE, STATED: that <header>
    // is now INSIDE main, so it is no longer a `banner` — the page trades one region holding 2% of
    // itself for one holding all of it. That block is a document title, not site chrome; Landing's
    // sticky top bar is what a banner is for. LandmarkCoverage.test.tsx holds the proportion.
    <main className="mx-auto w-full max-w-3xl px-gutter py-10">
      <LegalHeader title="Privacy" />

      <LawyerReview>
        This is an honest engineering account of what the software does, written from the code so a
        lawyer can turn it into an instrument. It is <strong>not</strong> a privacy notice in the
        legal sense: it does not identify a data controller, name a legal basis for processing,
        state a jurisdiction, or set out how to exercise statutory rights. Those must be added
        before this is relied on.
      </LawyerReview>

      <Section title="What we store">
        <p className="text-body">
          Talyvor sits between your tools and an AI provider. Handling your requests means holding
          some of them. Specifically:
        </p>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-body text-muted">
          <li>
            <strong className="text-ink">Your identity.</strong> When you sign in with Google we
            receive your account&rsquo;s subject identifier, email address and basic profile. We
            keep the identifier and the email. We do not receive or store your Google password, and
            we do not request access to anything else in your Google account.
          </li>
          <li>
            <strong className="text-ink">Usage and billing records.</strong> For each request: which
            model, how many tokens, what it cost, when, and which workspace. These are what your
            balance and ledger are computed from.
          </li>
          <li>
            <strong className="text-ink">A hash and an embedding of each prompt.</strong> A hash is
            a one-way fingerprint. An embedding is a list of numbers representing the prompt&rsquo;s
            meaning, used to recognise that two differently-worded questions are asking the same
            thing. Neither is the prompt, and neither can be reversed back into it.
          </li>
          <li>
            <strong className="text-ink">The answer.</strong> The provider&rsquo;s response is
            stored in full so it can be served again instead of being paid for twice. This is the
            cache, and it is the mechanism the whole product is built on.
          </li>
        </ul>
      </Section>

      <Section title="Whether your prompt text is kept">
        <p className="text-body">
          <strong>By default, no.</strong> Each workspace has a logging setting, and an
          unconfigured workspace gets <code>metadata</code>, under which the prompt text is written
          as an empty string and never persisted.
        </p>
        <p className="mt-3 text-body text-muted">
          There is a <code>full</code> setting that <em>does</em> persist prompt text, so that
          popular questions can be pre-warmed. It is not the default and nothing in the app turns it
          on. If an operator sets it on your workspace, your prompt text is retained — and you would
          have no way to tell from the product that this had happened. We are stating that plainly
          because it is the kind of thing a policy usually omits.
        </p>
        <p className="mt-3 text-body text-muted">
          The hash and the embedding are stored under every setting, including{' '}
          <code>none</code>. They are not prompt text, but they are derived from it.
        </p>
      </Section>

      <Section title="⚠ Documents you attach become the prompt">
        <p className="text-body">
          When you attach a document, we convert it to Markdown before the model sees it, and{' '}
          <strong>the converted text is what everything downstream treats as your prompt</strong>.
          It is what gets hashed, what gets embedded, and what gets cached. Everything this page
          says about prompts applies to the contents of your documents.
        </p>
        <p className="mt-3 text-body">
          <strong>If a file has no text to extract</strong> — a scan, a photograph, an image-only
          PDF — it is sent to a <strong>vision model</strong> to be read. Your document is
          transmitted to a model provider to have its contents recovered.
        </p>
        <p className="mt-3 text-body text-muted">
          Read this together with the section below. An answer often restates the question it was
          answering, and that is truer of a document than of a typed question: a question about a
          contract may be a sentence, while an answer derived from the contract can quote it. With
          sharing on, an answer derived from your document can be served to another company.{' '}
          <strong className="text-ink">
            If a document is confidential, turn document conversion off, turn sharing off, or do
            not attach it.
          </strong>
        </p>
        <p className="mt-3 text-body text-muted">
          Conversion is <strong>on</strong> for every workspace unless you turn it off, in Settings.
        </p>
      </Section>

      <Section title="⚠ Answers you generate may be served to other companies">
        <p className="text-body">
          This is the part that matters most, and it is on by default.
        </p>
        <p className="mt-3 text-body">
          If another company asks a question close enough in meaning to one you have already asked,
          they may be served <strong>the answer that was generated for you</strong>, in full, rather
          than paying a provider to generate it again. The reverse is also true: you may be served
          answers generated for them. This is what makes reuse earn, and it is why the product is
          cheaper than going direct.
        </p>
        <p className="mt-3 text-body text-muted">
          <strong className="text-ink">Your prompts are not served to anyone.</strong> Matching uses
          the hash and the embedding; only the answer is transmitted. But an answer often restates
          the question it was answering, so if a prompt contained something confidential the answer
          may contain it too. Treat &ldquo;the answer leaves the workspace&rdquo; as the operative
          fact, not &ldquo;the prompt does not&rdquo;.
        </p>
        <p className="mt-3 text-body text-muted">
          Sharing is <strong>on</strong> for a new workspace and one click turns it off, on the
          screen shown before you first reach the app and in Settings at any time. Turning it off
          applies from that moment on; it does not reach back to answers already shared. Your API
          keys, balance and ledger are never shared under either setting.
        </p>
        <p className="mt-3 text-body text-muted">
          Sharing is additionally gated deployment-wide by the operator. On a deployment where that
          switch is off, nothing pools regardless of your setting.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p className="text-body">
          Usage and billing records are kept for as long as the account exists — they are the
          ledger, and a balance you cannot audit is not a balance.
        </p>
        <p className="mt-3 text-body">
          Cached answers expire after a configured period of disuse.{' '}
          <strong>
            That clock resets every time the entry is used, so an answer that stays popular is kept
            indefinitely.
          </strong>{' '}
          This is a real consequence and it is not obvious: a question your team asks every week is
          an answer we hold for as long as you keep asking it. It applies identically to shared and
          unshared entries.
        </p>
        <LawyerReview compact>
          A retention period that resets on access is a design decision with regulatory
          consequences. It needs review against any maximum-retention obligation.
        </LawyerReview>
      </Section>

      <Section title="What leaves this system">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-body text-muted">
          <li>
            <strong className="text-ink">The AI provider</strong> receives your prompt. It has to —
            that is the request. Their handling is governed by their terms, not ours.
          </li>
          <li>
            <strong className="text-ink">Google</strong> receives the fact that you signed in. We
            ask it only for your identifier, email and basic profile.
          </li>
          <li>
            <strong className="text-ink">Stripe</strong> handles payment. Your card details go to
            Stripe directly and never reach us — we never see or store a card number. We send
            Stripe a workspace identifier and an amount, so we can credit the right balance.
          </li>
          <li>
            <strong className="text-ink">Other Talyvor workspaces</strong> — cached answers, as
            described above, when sharing is on.
          </li>
        </ul>
        <p className="mt-3 text-body text-muted">
          Nothing else leaves. There is no analytics vendor, no advertising network and no session
          recording in this application.
        </p>
      </Section>

      <Section title="What we have not built">
        <p className="text-body">
          <strong>There is no self-service data deletion.</strong> Nothing in the product deletes a
          workspace or the records attached to it, and there is no code path that does so. If you
          want your data removed, contact the operator, who will do it by hand against the database.
        </p>
        <p className="mt-3 text-body text-muted">
          We would rather say this than imply a capability that does not exist. It is the first
          thing to fix if this stops being a trial.
        </p>
        <LawyerReview compact>
          Absent deletion is likely to be the largest compliance gap here, particularly against
          erasure rights. It should be assessed before the service is offered outside a closed
          trial.
        </LawyerReview>
      </Section>
    </main>
  )
}
