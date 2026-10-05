import { inlineLink } from '@talyvor/ui'
import { LegalHeader, LegalPage, LawyerReview, Section } from './legalParts'
import { COMPANY_CONTACT, COMPANY_NAME, COMPANY_NUMBER, REGISTERED_OFFICE } from '../company'
import {
  KEPT_UNTIL_DELETED_FACT,
  LOGGING_NONE_FACT,
  QUESTION_STORED_FACT,
  SHARING_OFF_FACT,
  SharedAnswersFact,
} from '../components/StoredAnswersFacts'

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
// and in this repo, for the wallet and Marketplace claims (B28.16):
//   wallet records     areas/lens/agentBankApi.ts (AgentApproval, Passkey, AgentCard, Cardholder)
//   passkeys, pushes   areas/lens/passkeys.ts (Lens keeps the public key; pushes via /sw.js)
//   test-mode cards    areas/lens/AgentCardPanel.tsx ("Test mode" unless livemode)
//   payouts            areas/marketplace/Marketplace.tsx (Stripe asks; Talyvor never sees bank details)
//   deletion           areas/lens/StoredAnswers.tsx, areas/track/WorkspaceSettings.tsx
export function Privacy() {
  return (
    // The site's header and footer and the reading column are LegalPage's, with the `main` in it.
    <LegalPage>
      <LegalHeader title="Privacy" />

      <p className="mb-8 text-reading">
        {COMPANY_NAME} (company number {COMPANY_NUMBER}, registered office {REGISTERED_OFFICE}) runs
        Talyvor and decides how the personal data this notice describes is used. Contact:{' '}
        <a className={inlineLink} href={`mailto:${COMPANY_CONTACT}`}>
          {COMPANY_CONTACT}
        </a>
        .
      </p>

      <LawyerReview>
        This is an honest engineering account of what the software does, written from the code so a
        lawyer can turn it into an instrument. It is <strong>not</strong> a privacy notice in the
        legal sense: it does not identify a data controller, name a legal basis for processing,
        state a jurisdiction, or set out how to exercise statutory rights. Those must be added
        before this is relied on.
      </LawyerReview>

      <Section title="What we store">
        <p className="text-reading">
          Talyvor sits between your tools and an AI provider. Handling your requests means holding
          some of them. Specifically:
        </p>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-reading text-muted">
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

      <Section title="What Agent Wallets stores">
        <p className="text-reading">
          Every agent you create gets a wallet. Running it means keeping a record of what it holds,
          what it may do, and everything it did:
        </p>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-reading text-muted">
          <li>
            <strong className="text-ink">Statements.</strong> Every movement into and out of each
            agent&rsquo;s wallet: funding, spending on requests, payments to other agents, card
            purchases, top-ups, pots, escrows, loans and cash-outs, each with its amount, time and
            any memo you or the agent wrote. These are ledger records.
          </li>
          <li>
            <strong className="text-ink">Rules and approvals.</strong> Each agent&rsquo;s budget,
            limits and approval amount. When a request or payment needs a person, we keep what was
            asked — the amount, the model or the payee, the agent&rsquo;s stated reason and memo —
            and whether and when it was approved or denied.
          </li>
          <li>
            <strong className="text-ink">Passkeys.</strong> If you approve from your phone, a
            passkey is made on that device with Face ID, Touch ID or its PIN. We keep the
            passkey&rsquo;s public key, the name you gave it and when it was used. Your face,
            fingerprint and PIN never leave the device, and neither does the passkey&rsquo;s private
            key. If you turn on notifications, we keep the push address your browser gives us.
          </li>
          <li>
            <strong className="text-ink">Test-mode cards.</strong> An agent&rsquo;s virtual card is
            issued by Stripe, in test mode, for test purchases, to a person you name: the
            cardholder&rsquo;s name, email, billing address and, if you give one, phone number are
            sent to Stripe for that. We keep the card&rsquo;s last four digits and expiry, and each
            purchase: the merchant, the amount, and whether the agent&rsquo;s rules allowed it and
            why. We never see or store the full card number.
          </li>
        </ul>
      </Section>

      <Section title="What the Marketplace stores and shows">
        <p className="text-reading">
          A listing you publish — an agent, prompt, skill, evaluation or pipeline — is stored and{' '}
          <strong>shown to every other Talyvor workspace</strong>. Lens checks it before it is
          published and refuses one that carries a secret, personal data or a prompt injection; that
          check is a safeguard, not a reason to put anything private into a listing.
        </p>
        <p className="mt-3 text-reading text-muted">
          Each use of a listing is recorded with its price, for the buyer&rsquo;s monthly bill and the
          seller&rsquo;s earnings. A report someone files about a listing is kept with its reason
          and details. If you connect a Stripe account to be paid, Stripe asks who you are and where
          to send the money; Talyvor never sees your bank details.
        </p>
      </Section>

      <Section title="Whether your prompt text is kept">
        <p className="text-reading">
          <strong>With each reusable answer, yes.</strong> {QUESTION_STORED_FACT}
        </p>
        <p className="mt-3 text-reading text-muted">
          Separately, each workspace has a logging setting for its request log. An unconfigured
          workspace gets <code>metadata</code>, under which the log records the prompt text as an
          empty string.
        </p>
        <p className="mt-3 text-reading text-muted">
          There is a <code>full</code> setting that <em>does</em> persist prompt text, so that
          popular questions can be pre-warmed. It is not the default and nothing in the app turns it
          on. If an operator sets it on your workspace, your prompt text is retained — and you would
          have no way to tell from the product that this had happened. We are stating that plainly
          because it is the kind of thing a policy usually omits.
        </p>
        <p className="mt-3 text-reading text-muted">{LOGGING_NONE_FACT}</p>
      </Section>

      <Section title="⚠ Documents you attach become the prompt">
        <p className="text-reading">
          When you attach a document, we convert it to Markdown before the model sees it, and{' '}
          <strong>the converted text is what everything downstream treats as your prompt</strong>.
          It is what gets hashed, what gets embedded, and what gets cached. Everything this page
          says about prompts applies to the contents of your documents.
        </p>
        <p className="mt-3 text-reading">
          <strong>If a file has no text to extract</strong> — a scan, a photograph, an image-only
          PDF — it is sent to a <strong>vision model</strong> to be read. Your document is
          transmitted to a model provider to have its contents recovered.
        </p>
        <p className="mt-3 text-reading text-muted">
          Read this together with the section below. An answer often restates the question it was
          answering, and that is truer of a document than of a typed question: a question about a
          contract may be a sentence, while an answer derived from the contract can quote it. With
          sharing on, an answer derived from your document can be served to another company.{' '}
          <strong className="text-ink">
            If a document is confidential, turn document conversion off, turn sharing off, or do
            not attach it.
          </strong>
        </p>
        <p className="mt-3 text-reading text-muted">
          Conversion is <strong>on</strong> for every workspace unless you turn it off, in Settings.
        </p>
      </Section>

      <Section title="⚠ Answers you generate may be served to other companies">
        <p className="text-reading">
          This is the part that matters most, and it is on by default.
        </p>
        <p className="mt-3 text-reading">
          If another company asks a question close enough in meaning to one you have already asked,
          they may be served <strong>the answer that was generated for you</strong>, in full, rather
          than paying a provider to generate it again. The reverse is also true: you may be served
          answers generated for them. This is what makes reuse earn, and it is why a reused answer is
          charged less than its list price.
        </p>
        <p className="mt-3 text-reading text-muted">
          <strong className="text-ink">Your prompts are not served to anyone.</strong> Matching uses
          the hash and the embedding; only the answer is transmitted. But an answer often restates
          the question it was answering, so if a prompt contained something confidential the answer
          may contain it too. Treat &ldquo;the answer leaves the workspace&rdquo; as the operative
          fact, not &ldquo;the prompt does not&rdquo;.
        </p>
        <p className="mt-3 text-reading text-muted">
          Sharing is <strong>on</strong> for a new workspace and one click turns it off, on Home and
          in Settings at any time.{' '}
          {SHARING_OFF_FACT} Your API keys, balance, ledger and agent wallets are never shared under
          either setting.
        </p>
        <SharedAnswersFact className="mt-3 text-reading text-muted" />
        <p className="mt-3 text-reading text-muted">
          Sharing is additionally gated deployment-wide by the operator. On a deployment where that
          switch is off, nothing pools regardless of your setting.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p className="text-reading">
          Usage and billing records, and every agent wallet&rsquo;s statement, are kept for as long
          as the account exists — they are the ledger, and a balance you cannot audit is not a
          balance.
        </p>
        <p className="mt-3 text-reading">
          <strong>{KEPT_UNTIL_DELETED_FACT}</strong> This applies identically to shared and unshared
          answers. In Features you can delete the answers this workspace shared, or everything it has
          stored, or ask Talyvor to delete all of your data. Answers already given to other users stay
          in their conversations.
        </p>
        <LawyerReview compact>
          Keeping stored answers until the customer deletes them is a design decision with regulatory
          consequences. It needs review against any maximum-retention obligation.
        </LawyerReview>
      </Section>

      <Section title="What leaves this system">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-reading text-muted">
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
            Stripe a workspace identifier and an amount, so we can credit the right balance. Stripe
            also issues agent cards, so it receives the cardholder details described above, and
            pays Marketplace sellers, so it receives what a seller gives it when connecting.
          </li>
          <li>
            <strong className="text-ink">Your browser&rsquo;s push service</strong> — Apple, Google
            or Mozilla, depending on the browser — carries approval notifications to a device you
            turned them on for.
          </li>
          <li>
            <strong className="text-ink">Other Talyvor workspaces</strong> — cached answers, as
            described above, when sharing is on; the listings you publish on the Marketplace; and,
            when an agent pays another owner&rsquo;s agent, that payment.
          </li>
        </ul>
        <p className="mt-3 text-reading text-muted">
          Nothing else leaves. There is no analytics vendor, no advertising network and no session
          recording in this application.
        </p>
      </Section>

      <Section title="Deleting your data">
        <p className="text-reading">
          In Features, a workspace&rsquo;s owner or an admin can delete the answers it shared, or
          everything it has stored, at once, by typing the workspace&rsquo;s name to confirm. The
          same screen asks Talyvor to delete <strong>all</strong> of the workspace&rsquo;s data and
          shows that request until it is done. In Track, a workspace&rsquo;s owner can delete it and
          restore it within 14 days.
        </p>
        <p className="mt-3 text-reading text-muted">
          Deleting all of your data is carried out by an operator, not automatically, and no
          turnaround is promised. Billing and ledger records — agent wallet statements included —
          are kept, because the law requires them.
        </p>
        <LawyerReview compact>
          A deletion that waits on an operator with no stated turnaround, and ledger records kept
          after it, both need to be assessed against erasure rights before the service is offered
          outside a closed trial.
        </LawyerReview>
      </Section>

    </LegalPage>
  )
}
