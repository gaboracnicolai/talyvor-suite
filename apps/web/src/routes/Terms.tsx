import { LegalHeader, LawyerReview, Section } from './legalParts'

// Terms — what the service actually is and is not, written from the code.
//
// The credit claims are the ones most likely to be read by someone with a financial-regulation
// interest, so they are stated in terms of what the code does (a balance decremented against
// usage) rather than in terms of what we would prefer them to be.
export function Terms() {
  return (
    <div className="mx-auto w-full max-w-3xl px-gutter py-10">
      <LegalHeader title="Terms" />

      <LawyerReview>
        This is an honest description of the service written by its engineers so a lawyer can turn
        it into an agreement. It is <strong>not</strong> a contract: it names no governing law, no
        jurisdiction, no liability position, no warranty disclaimer and no dispute process. Do not
        rely on it as one.
      </LawyerReview>

      <Section title="This is a trial">
        <p className="text-body">
          Talyvor is early software offered for evaluation. Features appear, change and are removed.
          Screens you use today may not exist next month. We will try not to surprise you, but the
          honest expectation is instability, not stability.
        </p>
      </Section>

      <Section title="LENS and LXC are usage credits">
        <p className="text-body">
          <strong>LXC</strong> is what you buy and spend on inference. <strong>LENS</strong> is what
          some contribution mechanisms pay out. Both are internal balances in our database,
          decremented as you use the service.
        </p>
        <p className="mt-3 text-body">
          They are <strong>not money</strong>, not a deposit, not a stored-value instrument, not a
          security, and not any kind of investment. They confer no ownership of anything and no
          claim on the company. They exist to meter usage of this service and have no use or value
          outside it. There is no mechanism to convert them back into currency, and none is planned.
        </p>
        <LawyerReview compact>
          Whether an internal credit that is purchased with real money constitutes stored value or
          e-money is jurisdiction-specific, and the answer may depend on refundability. This
          paragraph states intent; it does not settle the question.
        </LawyerReview>
      </Section>

      <Section title="Earning is experimental, and some of it does not pay">
        <p className="text-body">
          The service describes ways contributions can earn LENS. Several of those mechanisms are
          switched off or under evaluation. A contribution can be genuine and produce no ledger
          entry.
        </p>
        <p className="mt-3 text-body text-muted">
          Where a mechanism is under evaluation, what it <em>would</em> have paid is recorded for
          our own checking and never credited — it does not reach your balance. Your balance and
          ledger show only what you have actually been paid. This is the same statement the app
          makes on the sharing screen, and it is deliberately the same words.
        </p>
        <p className="mt-3 text-body text-muted">
          Rates, caps and eligibility can change, including to zero. Nothing here is a promise of
          future earnings.
        </p>
      </Section>

      <Section title="⚠ Earned LENS is not yours to spend straight away">
        <p className="text-body">
          When a contribution earns LENS, it does not arrive in your spendable balance. It lands in
          a <strong>holding period</strong> first: the app shows it as held, you cannot spend or
          convert it, and it becomes spendable on its own once the period is over. Nothing is
          required from you and there is no button to press.
        </p>
        <p className="mt-3 text-body">
          <strong>During that period the payout can be reversed.</strong> If we determine that an
          earning was gamed, or that the shared answer it was paid for was bad, an operator can
          revoke it and the held amount is removed before it ever becomes spendable. That is what
          the holding period is for — it is the window in which a payout can still be contested.
          Once it settles, it is not clawed back.
        </p>
        <p className="mt-3 text-body text-muted">
          We do not fix the length here on purpose. It is an operator setting, not a term of this
          document, and this same page ships with self-hosted installations whose operator may have
          chosen a different one. Your balance screen shows the held amount and the indication it
          gives reflects how this deployment is currently configured — it is not a commitment, and
          it can change.
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
        <p className="text-body">
          When you attach a document, we convert it to Markdown before the model sees it. The model
          reads the converted text, not your original file. This is on unless you turn it off, and
          it is on because the converted text is smaller — you are charged for the smaller thing.
        </p>
        <p className="mt-3 text-body">
          <strong>If a file has no text to extract</strong> — a scan, a photograph, an image-only
          PDF — it is sent to a <strong>vision model</strong> to be read. That is an extra model
          call on your document, and it costs tokens rather than saving them.
        </p>
        <p className="mt-3 text-body text-muted">
          The converted text is what everything downstream treats as your prompt, so what{' '}
          <a className="underline" href="/privacy">Privacy</a> says about prompts applies to your
          documents' contents too. You can turn conversion off in settings.
        </p>
      </Section>

      <Section title="Sharing between companies">
        <p className="text-body">
          Answers generated for your workspace may be served to other companies, and theirs to you.
          This is on by default, disclosed before you first reach the app, and one click to turn
          off. The full account is in <a className="underline" href="/privacy">Privacy</a>; the
          short version is that <strong>the content of your answers can leave your workspace</strong>,
          and you should not put anything into a prompt whose answer you would not want shared until
          you have turned sharing off.
        </p>
      </Section>

      <Section title="No uptime promise">
        <p className="text-body">
          There is no service level agreement, no availability target and no support commitment. The
          service depends on third-party AI providers, an identity provider and a payment processor,
          any of which can fail independently of us. Do not build anything you cannot afford to have
          stop working.
        </p>
      </Section>

      <Section title="Payment and refunds">
        <p className="text-body">
          Payments are processed by Stripe. We never see or hold your card details. Purchased LXC is
          credited to your workspace when Stripe confirms the payment.
        </p>
        <LawyerReview compact>
          No refund policy exists in the code or in this document. Consumer-law refund and
          cancellation rights are likely to apply regardless of what is written here, and this needs
          a position before real money is taken at any scale.
        </LawyerReview>
      </Section>

      <Section title="⚠ Deleting your account">
        <p className="text-body">
          <strong>There is no self-service deletion.</strong> No screen, endpoint or command deletes
          a workspace or its records — we checked, and no such code path exists.
        </p>
        <p className="mt-3 text-body text-muted">
          To have your data removed, contact the operator, who will do it by hand. There is no
          automated confirmation and no defined turnaround, because neither has been built.
        </p>
        <p className="mt-3 text-body text-muted">
          We would rather tell you this than describe a deletion flow that is not there. It is the
          first thing to build if this stops being a trial.
        </p>
        <LawyerReview compact>
          Absence of deletion is a material gap against erasure and account-closure rights, and
          should be resolved before general availability.
        </LawyerReview>
      </Section>

      <Section title="Acceptable use">
        <p className="text-body">
          Do not use the service to break the law, to attack it or anyone else, to work around
          usage limits or billing, or to submit content you have no right to submit. We can suspend
          access to protect the service or its other users.
        </p>
      </Section>
    </div>
  )
}
