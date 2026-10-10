import { LegalPage, LawyerReview, Section } from './legalParts'
import { COMPANY_CONTACT, COMPANY_NAME, COMPANY_NUMBER, REGISTERED_OFFICE } from '../company'
import { inlineLink } from '@talyvor/ui'
import { SharedAnswersFact, StoredAnswersFacts } from '../components/StoredAnswersFacts'

// Terms — what the service actually is and is not, written from the code.
//
// The credit claims are the ones most likely to be read by someone with a financial-regulation
// interest, so they are stated in terms of what the code does (a balance decremented against
// usage) rather than in terms of what we would prefer them to be.

/** The day these words last changed (B32.2 added who the terms are between). Change it with them. */
const UPDATED = '2026-10-10'

export function Terms() {
  return (
    // The site's header and footer, the title block, the contents and the reading column are
    // LegalPage's, with the `main` in it.
    <LegalPage title="Terms" updated={UPDATED}>
      <p className="mb-8 text-reading">
        These terms are between you and {COMPANY_NAME}, a company registered in England and Wales
        (number {COMPANY_NUMBER}) whose registered office is {REGISTERED_OFFICE}. Contact:{' '}
        <a className={inlineLink} href={`mailto:${COMPANY_CONTACT}`}>
          {COMPANY_CONTACT}
        </a>
        .
      </p>

      <LawyerReview>
        This is an honest description of the service written by its engineers so a lawyer can turn
        it into an agreement. It is <strong>not</strong> a contract: it names no governing law, no
        jurisdiction, no liability position, no warranty disclaimer and no dispute process. Do not
        rely on it as one.
      </LawyerReview>

      <Section title="This is a trial">
        <p className="text-reading">
          Talyvor is early software offered for evaluation. Features appear, change and are removed.
          Screens you use today may not exist next month. We will try not to surprise you, but the
          honest expectation is instability, not stability.
        </p>
      </Section>

      <Section title="LENS and LXC are usage credits">
        <p className="text-reading">
          <strong>LXC</strong> is what you buy and spend on inference. <strong>LENS</strong> is what
          some contribution mechanisms pay out. Both are internal balances in our database,
          decremented as you use the service.
        </p>
        <p className="mt-3 text-reading">
          They are <strong>not money</strong>, not a deposit, not a stored-value instrument, not a
          security, and not any kind of investment. They confer no ownership of anything and no
          claim on the company. They exist to meter usage of this service.
        </p>
        <p className="mt-3 text-reading">
          <strong>LXC can be cashed out.</strong> In Agent Wallets, a workspace&rsquo;s owner can ask
          to turn an agent&rsquo;s LXC back into money, paid by Talyvor&rsquo;s payments partner to an
          account they name. The credits are held while it is paid and come back if the payment
          fails. Until Talyvor has cleared cash-out to move real money, it runs on test money only,
          and the screen says so beside it. Earned LENS converts to LXC.
        </p>
        <LawyerReview compact>
          Whether an internal credit that is purchased with real money constitutes stored value or
          e-money is jurisdiction-specific, and a credit that can be cashed out is closer to it than
          one that cannot. This paragraph describes the mechanism; it does not settle the question.
        </LawyerReview>
      </Section>

      <Section title="Agent Wallets">
        <p className="text-reading">
          Each agent you create has a wallet: LXC you move into it from your workspace, rules for
          what it may spend, and a statement of everything it did. Lens enforces those rules before
          a model call or a payment is made. A request or payment the rules refuse is not made; one
          over the approval amount waits for a person to approve it, and with a passkey that
          approval is signed on your own device.
        </p>
        <p className="mt-3 text-reading">
          <strong>An agent spends what its rules allow without asking anyone.</strong> The rules are
          what stand between an agent and its wallet, so set them to what you are prepared to have
          spent. Pausing an agent, or every agent at once, stops it until you resume it.
        </p>
        <p className="mt-3 text-reading text-muted">
          An agent can pay other agents, including another company&rsquo;s, hold money in escrow and
          pots, and lend to or borrow from another company. Each of these that Talyvor has not
          cleared to move real money is marked &ldquo;Test money only&rdquo; on screen, with why, and
          uses test credits. An agent&rsquo;s virtual card is issued by Stripe in test mode, for test
          purchases. Investing is simulated: simulated US dollars at real prices, never real assets.
        </p>
        <LawyerReview compact>
          Who is liable for a payment an agent makes within its rules, for a payment to another
          owner&rsquo;s agent, and for a loan between companies that is not repaid is not defined
          here. That needs a position before any of these moves real money.
        </LawyerReview>
      </Section>

      <Section title="The Marketplace">
        <p className="text-reading">
          The Marketplace lists agents, prompts, skills, evaluations and pipelines published by other
          Talyvor workspaces. Using one runs it through Lens as your workspace. A paid listing&rsquo;s
          price goes on your monthly marketplace bill, never on your credits.
        </p>
        <p className="mt-3 text-reading">
          A listing is its seller&rsquo;s work, not Talyvor&rsquo;s. Lens checks each one before it is
          published and refuses one that carries a secret, personal data or a prompt injection.
          Anyone who can see a listing can report it; Talyvor reviews reported and held listings and
          can take one down for good, which refunds every use of it still inside the 14-day holdback.
        </p>
        <p className="mt-3 text-reading text-muted">
          Only a workspace&rsquo;s owner or an admin can publish. A seller earns 85% of every use,
          rental and purchase whose bill was paid; Talyvor keeps 15%. Earnings are held for 14 days for refunds, then paid once a week to a
          Stripe account the seller connects, less Stripe&rsquo;s fees at cost — or taken at once as
          Talyvor credits, with no fees and no minimum. Each weekly payout has a statement of its sales,
          fees, royalties and refunds. A seller gives Talyvor their tax details before they are paid;
          payouts to a seller whose details are still incomplete after three requests are held until
          they are complete. A refund after the seller was paid is recovered from their next earnings.
        </p>
        <LawyerReview compact>
          The licence a buyer receives to a listing, and who is liable for what a listing does, are
          not defined in this document.
        </LawyerReview>
      </Section>

      <Section title="Earning is experimental, and some of it does not pay">
        <p className="text-reading">
          The service describes ways contributions can earn LENS. Several of those mechanisms are
          switched off or under evaluation. A contribution can be genuine and produce no ledger
          entry.
        </p>
        <p className="mt-3 text-reading text-muted">
          Where a mechanism is under evaluation, what it <em>would</em> have paid is recorded for
          our own checking and never credited — it does not reach your balance. Your balance and
          ledger show only what you have actually been paid. This is the same statement the app
          makes on the sharing screen, and it is deliberately the same words.
        </p>
        <p className="mt-3 text-reading text-muted">
          Rates, caps and eligibility can change, including to zero. Nothing here is a promise of
          future earnings.
        </p>
      </Section>

      <Section title="⚠ Earned LENS is not yours to spend straight away">
        <p className="text-reading">
          When a contribution earns LENS, it does not arrive in your spendable balance. It lands in
          a <strong>holding period</strong> first: the app shows it as held, you cannot spend or
          convert it, and it becomes spendable on its own once the period is over. Nothing is
          required from you and there is no button to press.
        </p>
        <p className="mt-3 text-reading">
          <strong>During that period the payout can be reversed.</strong> If we determine that an
          earning was gamed, or that the shared answer it was paid for was bad, an operator can
          revoke it and the held amount is removed before it ever becomes spendable. That is what
          the holding period is for — it is the window in which a payout can still be contested.
          Once it settles, it is not clawed back.
        </p>
        <p className="mt-3 text-reading text-muted">
          We do not fix the length here on purpose. It is an operator setting, not a term of this
          document, and this same page ships with self-hosted installations whose operator may have
          chosen a different one. Your balance screen shows the held amount and says that it settles
          after a holding period during which it can be revoked; it deliberately does not print a
          length, because the app cannot read the operator&rsquo;s setting and a number it could
          not verify would be worse than none.
        </p>
        <LawyerReview compact>
          This is a delay and a discretionary reversal on amounts already described to the user as
          earned. Who decides, on what evidence, whether the user is told, and whether they can
          contest it are all undefined in the code — the revocation is an operator action with no
          notice mechanism and no appeal path. That needs a position before anything of value
          depends on it.
        </LawyerReview>
      </Section>

      <Section title="Documents you attach">
        <p className="text-reading">
          When you attach a document, we convert it to Markdown before the model sees it. The model
          reads the converted text, not your original file. This is on unless you turn it off, and
          it is on because the converted text is smaller — you are charged for the smaller thing.
        </p>
        <p className="mt-3 text-reading">
          <strong>If a file has no text to extract</strong> — a scan, a photograph, an image-only
          PDF — it is sent to a <strong>vision model</strong> to be read. That is an extra model
          call on your document, and it costs tokens rather than saving them.
        </p>
        <p className="mt-3 text-reading text-muted">
          The converted text is what everything downstream treats as your prompt, so what{' '}
          <a className={inlineLink} href="/privacy">Privacy</a> says about prompts applies to your
          documents' contents too. You can turn conversion off in settings.
        </p>
      </Section>

      <Section title="Sharing between companies">
        <p className="text-reading">
          Answers generated for your workspace may be served to other companies, and theirs to you.
          This is on by default, shown on Home, and one click there or in Settings turns it
          off. The full account is in <a className={inlineLink} href="/privacy">Privacy</a>; the
          short version is that <strong>the content of your answers can leave your workspace</strong>,
          and you should not put anything into a prompt whose answer you would not want shared until
          you have turned sharing off.
        </p>
        <SharedAnswersFact className="mt-3 text-reading" />
        <StoredAnswersFacts className="mt-3 text-reading" />
      </Section>

      <Section title="Tare training">
        <p className="text-reading">
          If your workspace&rsquo;s owner turns on <strong>Tare training</strong> in{' '}
          <a className={inlineLink} href="/features#tare-training">
            Features
          </a>
          , you allow Talyvor to keep the prose in your workspace&rsquo;s messages that Tare could not
          shorten, and to use it only to improve how Tare shortens prompts. Temporary chats and chats
          kept out of the shared pool are never used. It is off unless the owner turns it on, and turning
          it off deletes what was kept from your workspace. What is kept, and what never is, is set out
          in <a className={inlineLink} href="/privacy#learning-from-your-prose-only-if-you-allow-it">Privacy</a>.
        </p>
        <LawyerReview compact label="Draft — for legal review">
          This permission, and what Talyvor may do with what it learned once a workspace turns it off,
          need review before this is relied on.
        </LawyerReview>
      </Section>

      <Section title="No uptime promise">
        <p className="text-reading">
          There is no service level agreement, no availability target and no support commitment. The
          service depends on third-party AI providers, an identity provider and a payment processor,
          any of which can fail independently of us. Do not build anything you cannot afford to have
          stop working.
        </p>
      </Section>

      <Section title="Payment and refunds">
        <p className="text-reading">
          Payments are processed by Stripe. We never see or hold your card details. Purchased LXC is
          credited to your workspace when Stripe confirms the payment.
        </p>
        <LawyerReview compact>
          No refund policy for purchased LXC exists in the code or in this document; the only
          refunds the code makes are the Marketplace&rsquo;s, described above. Consumer-law refund
          and cancellation rights are likely to apply regardless of what is written here, and this
          needs a position before real money is taken at any scale.
        </LawyerReview>
      </Section>

      <Section title="⚠ Deleting your data">
        <p className="text-reading">
          In Features, a workspace&rsquo;s owner or an admin can delete the answers it shared, or
          everything it has stored, at once. The same screen asks Talyvor to delete all of the
          workspace&rsquo;s data and shows that request until it is done. In Track, a
          workspace&rsquo;s owner can delete it and restore it within 14 days.
        </p>
        <p className="mt-3 text-reading text-muted">
          Deleting all of your data is carried out by an operator, not automatically, and no
          turnaround is promised. Billing and ledger records, agent wallet statements included, are
          kept, because the law requires them. The full account is in{' '}
          <a className={inlineLink} href="/privacy">Privacy</a>.
        </p>
        <LawyerReview compact>
          A deletion that waits on an operator, with no defined turnaround, needs a position against
          erasure and account-closure rights before general availability.
        </LawyerReview>
      </Section>

      <Section title="Acceptable use">
        <p className="text-reading">
          Do not use the service to break the law, to attack it or anyone else, to work around
          usage limits or billing, or to submit content you have no right to submit. We can suspend
          access to protect the service or its other users.
        </p>
      </Section>

    </LegalPage>
  )
}
