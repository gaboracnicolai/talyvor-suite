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
        <p>
          {/* B28.357 — ForecastQuestion.tsx answers it from Lens's forecast. */}
          Ask <span className="font-mono">Will Researcher run out this month?</span> and the answer comes from the
          month-end forecast, not the model: whether the agent runs out at its pace so far this month, and on which day.
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
    // B28.359 — AgentTask.tsx reads the command; apps/bff/agent_task.go runs the task on the agent's wallet.
    heading: 'Handing an agent a task',
    body: (
      <>
        <p>
          Type <span className="font-mono">/task</span>, the agent&rsquo;s name, a colon and what it should do — for example{' '}
          <span className="font-mono">/task Researcher: name three models that read PDFs, cheapest first</span>. That is not
          asked on the conversation&rsquo;s account: a card opens with the agent and the task, to check before it runs.
        </p>
        <p>
          Hand it over and the task goes to the conversation&rsquo;s model on the agent&rsquo;s own wallet: Lens judges the call
          by the agent&rsquo;s rules first and charges it to the agent, never to the conversation. The card shows the answer and
          each line the task put on the agent&rsquo;s statement.
        </p>
      </>
    ),
  },
  {
    // B28.377 — ScheduledPrompt.tsx reads the command; Lens asks the prompt at its time on the agent's wallet.
    heading: 'Scheduling a prompt',
    body: (
      <>
        <p>
          Type <span className="font-mono">/schedule</span>, the agent&rsquo;s name, a colon and what to ask — for example{' '}
          <span className="font-mono">/schedule Researcher: summarise what my agents spent yesterday</span>. A card opens with
          the agent, the prompt, the time and how often: once, every day or every week.
        </p>
        <p>
          At that time the conversation&rsquo;s model is asked on the agent&rsquo;s own wallet: Lens judges it by the
          agent&rsquo;s rules first and charges it to the agent, so what it cost is a line on the agent&rsquo;s statement.
          Talyvor keeps the prompt and its answers so it runs while Chat is closed; every answer, and a Stop button for one
          that repeats, is under <Link className={inlineLink} to="/chat/scheduled">Scheduled prompts</Link>.
        </p>
      </>
    ),
  },
  {
    // B28.360 — CardFreeze.tsx reads the command; Lens refuses every purchase on a frozen card.
    heading: 'Freezing an agent’s card',
    body: (
      <>
        <p>
          Type <span className="font-mono">/freeze</span> and the agent&rsquo;s name — for example{' '}
          <span className="font-mono">/freeze Researcher</span> — and a card opens with the agent&rsquo;s card. Freeze it and
          every purchase on it is refused: nothing leaves the agent&rsquo;s wallet.
        </p>
        <p>
          <span className="font-mono">/unfreeze Researcher</span> lets purchases through again, each judged by the
          agent&rsquo;s rules as before. Agent Wallets shows the card as frozen while it is.
        </p>
      </>
    ),
  },
  {
    // B28.98 — StatementCommand.tsx reads the command; Lens writes the file, as Agent Wallets downloads it.
    heading: 'Downloading a statement',
    body: (
      <>
        <p>
          Type <span className="font-mono">/statement</span> and the agent&rsquo;s name — for example{' '}
          <span className="font-mono">/statement Researcher</span> — and a card opens to download its statement for this
          month, or any period you choose, as a CSV or JSON file: the opening balance, every movement and the closing
          balance.
        </p>
        <p>
          <span className="font-mono">/statement</span> alone downloads every agent&rsquo;s statement in one file.
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
          question in the conversation can still see it. Files can also be dragged onto the chat and dropped, and a
          screenshot or a copied file pasted into the message box is attached the same way.
        </p>
        <p>
          The page button beside Attach (Docs page) lists your workspace&rsquo;s Docs spaces and their pages. The page you pick goes with
          your question as it is saved in Docs, so ask about it and the answer can quote it. Under the question, the
          page&rsquo;s name links back to it in Docs.
        </p>
        <p>
          The issue button beside it (Track issue) lists your workspace&rsquo;s Track issues. The issue you pick goes with your
          question, so the answer can work from it, and from then on what every answer in the conversation costs is added to
          that issue&rsquo;s AI cost in Track. Under the question, the issue links back to it in Track.
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
    heading: 'Searching the web',
    body: (
      <>
        <p>
          Search the web sits beside Attach. While it is on, each question is answered from a search of the web, and
          the pages the answer used are listed under it as its sources, numbered as the answer cites them. Each opens
          in a new tab. It stays on for every question until you turn it off.
        </p>
      </>
    ),
  },
  {
    heading: 'Running code',
    body: (
      <>
        <p>
          Run code sits beside Search the web. While it is on, the model may write code and run it in a sandbox to work
          an answer out — a sum, a count, a list to sort. Under the answer, Code it ran shows each piece of code word
          for word and what it printed, so you can check the working. It stays on for every question until you turn it
          off.
        </p>
      </>
    ),
  },
  {
    heading: 'Track and Docs in Chat',
    body: (
      <>
        <p>
          Chat can look things up in your own Track and Docs while it answers: search your issues and pages and read
          them. Say “file this as a bug” and it drafts a Track issue from the conversation, then asks you first: the
          card shows the title and description, and nothing is filed until you press File it. Under the answer, Filed
          in Track links the issue, and a line says which of Talyvor’s tools the answer used.
        </p>
      </>
    ),
  },
  {
    heading: 'Connectors',
    body: (
      <>
        <p>
          Add your own MCP servers on Connectors, from Chat’s rail, by their address and the token they want if any.
          Chat offers their tools to the model beside Talyvor’s own, in every chat, and asks you before every call —
          what the model sends goes to that server; Don’t allow tells it no. Under the answer, each call is listed with what it
          cost — the request to the model that read the tool’s answer. To try it, add Talyvor test tools and ask for the
          fingerprint of a word.
        </p>
      </>
    ),
  },
  {
    heading: 'The canvas',
    body: (
      <>
        <p>
          When an answer writes a web page as HTML, Open in canvas sits on its code block. The canvas opens beside the
          conversation and shows the page as it looks: Preview draws it, Code is its HTML to change. A change is drawn
          as you type and saved with the conversation, in this browser, so it is still there when you come back.
          Restore the original puts back what the answer wrote.
        </p>
        <p>
          The page runs on its own: its scripts work, but it cannot read this console, what it keeps in your browser,
          or your sign-in.
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
        <p>
          Paid by, beside it, chooses which wallet pays for the conversation: the workspace, or one of its
          agents. The choice stays with the conversation. When an agent pays, each answer says so and links to
          the agent&rsquo;s statement, where the charge is; if the agent was not billed, the answer says that
          instead.
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
  {
    heading: 'Sharing a chat',
    body: (
      <p>
        Share, in the bar above a conversation, makes a link anyone can open without signing in. It shows the
        conversation&rsquo;s questions and answers as they were when you shared it — nothing else of it — and that copy is
        kept on Talyvor&rsquo;s servers while the link is on. Turn off link in the same place deletes the copy, and the link
        then finds nothing.
      </p>
    ),
  },
  {
    heading: 'Exporting and importing chats',
    body: (
      <p>
        Export all, under your conversations, downloads every conversation in this browser as one file; Download this
        chat, under Share, downloads the open one. Every question and answer goes with what it cost. Import, in any
        browser you are signed in to, adds a file&rsquo;s conversations to that browser&rsquo;s list, where they read and
        add up as they did. The file goes only where you put it, and a conversation already in the list is replaced only
        by a copy changed after it.
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
