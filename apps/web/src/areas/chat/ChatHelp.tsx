import { Link } from 'react-router-dom'

import { cn, focusRing } from '@talyvor/ui'

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
          the last question again and replaces the answer. Code blocks have their own Copy button.
        </p>
      </>
    ),
  },
  {
    heading: 'Models',
    body: (
      <>
        <p>
          The model picker sits inside the message box. It lists the models this deployment serves,
          read from its catalog each time the page opens — nothing in the list is typed into the app.
        </p>
        <p>
          Chat reads two streaming formats, OpenAI&rsquo;s and Anthropic&rsquo;s, so models from other
          providers in the catalog are not offered yet; the line under the message box says how many
          were left out.
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
      <Link className={cn('text-body text-ink underline', focusRing)} to="/chat">
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
