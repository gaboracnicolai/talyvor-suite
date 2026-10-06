import { Link } from 'react-router-dom'

import { inlineLink } from '@talyvor/ui'

// B10.3 — "How to use Talyvor Chat". The chat screen carries no instructions; this page is where
// the explanations live, linked from the chat's rail. Every sentence here is a statement about the
// shipped screen or the deployment behind it, so each is kept next to the code it describes:
// Chat.tsx (keyboard, history, price), chatApi.ts (which providers stream), history.ts (storage).

const SECTIONS: { heading: string; body: React.ReactNode }[] = [
  {
    heading: 'Asking',
    body: (
      <>
        <p>
          Type in the box at the bottom and press Enter to send. Shift+Enter starts a new line;
          Cmd+Enter and Ctrl+Enter also send. While an answer is being written the Send button
          becomes Stop, which ends the answer where it is and keeps what has arrived.
        </p>
        <p>
          Under each answer, Copy puts the answer on your clipboard as Markdown, and Regenerate asks
          the last question again and replaces the answer. Wrong answer removes a stored answer so it
          is never served again, to you or anyone. Code blocks have their own Copy button.
        </p>
      </>
    ),
  },
  {
    // B28.350 — LaunchAgent.tsx reads the command and launches the agent.
    heading: 'Launching an agent',
    body: (
      <>
        <p>
          Type <span className="font-mono">/agent</span>, its name and what it may spend — for example{' '}
          <span className="font-mono">/agent Researcher budget 20 LXC, 5 a day, ask me above 2</span>. That is not sent to
          the model: a card opens in the conversation with the name, the budget and the rules filled in, to check before
          anything moves.
        </p>
        <p>
          Launch creates the agent, moves its budget from the workspace into its wallet and saves its rules: at most the
          budget in a month, the daily limit, and the amount above which a person must approve. Then it issues the
          agent&rsquo;s key, shown once, and waits for the agent&rsquo;s first call, which it links on the agent&rsquo;s
          statement.
        </p>
      </>
    ),
  },
  {
    // B28.352, B28.353 — RuleCommand.tsx reads the sentence and saves the rule.
    heading: 'Setting a rule',
    body: (
      <>
        <p>
          Say what an agent may spend, in LXC — for example{' '}
          <span className="font-mono">Cap Researcher at 5 LXC a day on Opus</span>, or{' '}
          <span className="font-mono">Limit Researcher to 50 LXC a month</span>. That is not sent to the model: a card opens in
          the conversation with the agent, the amount, how often and the model filled in, and the limit as it is now.
        </p>
        <p>
          Save the rule and Lens refuses any call that would take the agent past it. A limit on one model is by the day;
          without a model it holds across every model. Every other rule stays as it was.
        </p>
        <p>
          To be asked first, say <span className="font-mono">Ask me above 2 LXC for Researcher</span>. Saved, any request or
          payment of the agent's above that amount waits in Approvals until a person approves it.
        </p>
      </>
    ),
  },
  {
    heading: 'Models',
    body: (
      <>
        <p>
          The model picker sits inside the message box. It lists every priced model this deployment
          serves, grouped by provider, newest generation first, with each model&rsquo;s price per million
          tokens; type to search, use the arrow keys and Enter to choose. The list is read from the
          deployment&rsquo;s catalog each time the page opens, so a model added there appears here on its
          own. A new conversation starts on the newest flagship model.
        </p>
        <p>
          Chat reads two streaming formats, OpenAI&rsquo;s and Anthropic&rsquo;s, so models from other
          providers are listed but can&rsquo;t be chosen yet. The catalog gives no release dates, so
          &ldquo;newest&rdquo; is read from the generation number in each model&rsquo;s name.
        </p>
      </>
    ),
  },
  {
    heading: 'Attaching documents',
    body: (
      <>
        <p>
          Attach sits beside the model picker. PDF, Word, Excel, PowerPoint, CSV, HTML, JSON, XML, text and
          Markdown files can be attached, each up to 25 MB. A document is uploaded once, and every later
          question in the conversation can still see it.
        </p>
        <p>
          Lens converts an attached document to plain text before the model reads it, so the model is
          billed for the words rather than the file. The question then says &ldquo;Converted to text
          before the model read it,&rdquo; and the answer says what the conversion saved. Whether conversion runs is a workspace setting in{' '}
          <Link className={inlineLink} to="/settings">
            Settings
          </Link>
          ; when it is off, the question says the original file was sent instead.
        </p>
        <p>
          The file itself stays in this browser tab only. After a reload the conversation shows what was
          attached, but later questions can&rsquo;t see the document.
        </p>
      </>
    ),
  },
  {
    heading: 'What an answer costs',
    body: (
      <>
        <p>
          Each answer ends with one quiet line: its price, the model that wrote it, and the tokens
          read and written. The price is the provider&rsquo;s token counts multiplied by the
          catalog&rsquo;s rate, shown in LXC when the deployment publishes its credit rate and in dollars
          otherwise.
        </p>
        <p>
          The line under the message box is the selected model&rsquo;s list price per million tokens. It is
          the catalog rate, not this conversation&rsquo;s bill.
        </p>
      </>
    ),
  },
  {
    // B16.4 — measured 27 Sep: a question's input tokens grow with its conversation, and nothing else
    // is added. Chat.test.tsx proves a new chat sends its first question alone.
    heading: 'What each question sends',
    body: (
      <>
        <p>
          Each question is sent with every earlier question and answer in its conversation — that is
          how the model knows what a follow-up like &ldquo;and of France?&rdquo; refers to. Nothing from
          any other conversation goes with it, and nothing is added to it.
        </p>
        <p>
          So a follow-up reads more tokens than the same question asked in a new chat. Measured on
          Claude Opus 5: &ldquo;what is <span className="font-figure">2+2</span>?&rdquo; on its own is{' '}
          <span className="font-figure">13</span> input tokens; as the fourth question of a conversation
          it was <span className="font-figure">76</span>, because the three earlier questions and answers
          went with it.
        </p>
        <p>
          Coming back to Chat — after a reload, or from another page — reopens your most recent
          conversation, and a question asked there continues it. New chat starts one with nothing
          before it.
        </p>
      </>
    ),
  },
  {
    heading: 'Where conversations are kept',
    body: (
      <p>
        In this browser only, for the account you are signed in with — not on Talyvor&rsquo;s servers.
        Another browser or device will not have them, and clearing this site&rsquo;s data removes them.
        Rename or delete a conversation from the bar above it; New chat starts a fresh one.
      </p>
    ),
  },
]

export function ChatHelp() {
  return (
    <div className="mx-auto max-w-2xl space-y-8 py-6">
      {/* The page's name is the console banner's <h1> (CONSOLE_ROUTES' title), so no second one here. */}
      <Link className={`text-body text-ink ${inlineLink}`} to="/chat">
        Back to the chat
      </Link>
      {SECTIONS.map((s) => (
        <section key={s.heading} className="space-y-3">
          <h2 className="text-head text-ink">{s.heading}</h2>
          <div className="space-y-3 text-body text-ink">{s.body}</div>
        </section>
      ))}
    </div>
  )
}
