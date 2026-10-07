import { useState } from 'react'

import { Button, Input, cn, focusRing, inlineLink } from '@talyvor/ui'

import type { Conversation, History } from './history'
import type { Project, Projects } from './projects'

// B28.109 — projects in Chat: the rail's list of them, a project's own page (its instructions and its chats), and the
// line over a conversation that says which project's instructions it is sent with.

const railItem = 'block w-full truncate rounded-control px-2 py-1.5 text-left text-body disabled:cursor-not-allowed disabled:opacity-50'

/** The rail's Projects: each opens the project's page, where a new chat in it starts; and a new one, named here. */
export function ProjectsRail({
  projects,
  current,
  disabled,
  onCreate,
  onOpen,
}: {
  projects: Projects
  /** The project whose page is open; null on a conversation or outside any project. */
  current: string | null
  disabled: boolean
  onCreate: (name: string) => void
  onOpen: (p: Project) => void
}) {
  const [naming, setNaming] = useState<string | null>(null)
  const create = () => {
    if (naming === null || naming.trim() === '') return
    onCreate(naming)
    setNaming(null)
  }
  return (
    <section aria-label="Projects" className="mb-4">
      <div className="flex items-center justify-between gap-2 px-2">
        <span className="font-figure text-eyebrow uppercase text-label">Projects</span>
        {naming === null ? (
          <button type="button" className={`text-caption text-ink ${inlineLink}`} onClick={() => setNaming('')} disabled={disabled}>
            New project
          </button>
        ) : null}
      </div>
      {naming !== null ? (
        <form
          className="mt-2 flex flex-col gap-2 px-2"
          onSubmit={(e) => {
            e.preventDefault()
            create()
          }}
        >
          <Input
            aria-label="Project name"
            placeholder="Project name"
            value={naming}
            autoFocus
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setNaming(null)
              }
            }}
          />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={naming.trim() === ''}>
              Create project
            </Button>
            <Button onClick={() => setNaming(null)}>Cancel</Button>
          </div>
        </form>
      ) : null}
      {projects.error !== null ? (
        <p className="mt-2 px-2 text-caption text-ink" role="alert">
          {projects.error}
        </p>
      ) : projects.list.length === 0 ? (
        naming === null ? <p className="mt-2 px-2 text-caption text-muted">Group chats under instructions they all share.</p> : null
      ) : (
        <ul className="mt-2 space-y-0.5" aria-label="Your projects">
          {projects.list.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={cn(
                  railItem,
                  'transition-colors duration-200 hover:bg-surface',
                  // The open project's page as the rail marks the open conversation.
                  p.id === current ? 'bg-accent-tint text-accent-strong hover:bg-accent-tint' : 'text-ink',
                  focusRing,
                )}
                aria-current={p.id === current ? 'true' : undefined}
                disabled={disabled}
                onClick={() => onOpen(p)}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * A project's page, where a new chat in it starts: its instructions, which every chat in it is sent with, and its
 * chats. A new project opens with its instructions being written.
 */
export function ProjectHome({
  project,
  history,
  disabled,
  onSave,
  onDelete,
  onOpenChat,
}: {
  project: Project
  /** This browser's conversations; unreadable, the project's chats are unknown, not none. */
  history: History
  disabled: boolean
  onSave: (name: string, instructions: string) => void
  onDelete: () => void
  onOpenChat: (c: Conversation) => void
}) {
  const [editing, setEditing] = useState<{ name: string; instructions: string } | null>(() =>
    project.instructions === '' ? { name: project.name, instructions: '' } : null,
  )
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const chats = history.list.filter((c) => c.project_id === project.id)
  return (
    <div className="flex flex-col gap-6 py-10" data-testid="project-home">
      <div>
        <span className="font-figure text-eyebrow uppercase text-label">Project</span>
        <h2 className="mt-1 truncate text-title text-ink">{project.name}</h2>
        <p className="mt-2 text-body text-muted">A new chat started here is sent with this project’s instructions, and so is every question asked in it.</p>
      </div>

      <section aria-label="Instructions" className="rounded-card border border-rule bg-raised p-4">
        {editing !== null ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              onSave(editing.name, editing.instructions)
              setEditing(null)
            }}
          >
            <label className="flex flex-col gap-1">
              <span className="text-caption text-muted">Name</span>
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-muted">Instructions</span>
              <textarea
                className={`min-h-32 w-full rounded-control border border-rule bg-surface p-3 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
                placeholder="For example: Answer as our finance lead. Use pounds. Keep answers under 200 words."
                value={editing.instructions}
                autoFocus
                onChange={(e) => setEditing({ ...editing, instructions: e.target.value })}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" disabled={disabled || editing.name.trim() === ''}>
                Save instructions
              </Button>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-caption text-muted">Instructions</span>
              <button
                type="button"
                className={`text-caption text-ink ${inlineLink}`}
                disabled={disabled}
                onClick={() => setEditing({ name: project.name, instructions: project.instructions })}
              >
                Edit instructions
              </button>
            </div>
            {project.instructions === '' ? (
              <p className="text-body text-muted">None yet: chats in this project are sent without any.</p>
            ) : (
              <p className="whitespace-pre-wrap text-body text-ink" data-testid="project-instructions">
                {project.instructions}
              </p>
            )}
          </div>
        )}
      </section>

      <section aria-label="Chats in this project">
        <span className="text-caption text-muted">Chats in this project</span>
        {history.error !== null ? (
          <p className="mt-2 text-body text-ink" role="alert">
            {history.error} This project’s chats can’t be listed.
          </p>
        ) : chats.length === 0 ? (
          <p className="mt-2 text-body text-muted">None yet. Ask a question below to start the first.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {chats.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={cn(railItem, 'text-ink transition-colors duration-200 hover:bg-surface', focusRing)}
                  disabled={disabled}
                  onClick={() => onOpenChat(c)}
                >
                  {c.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div>
        {confirmingDelete ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm delete project">
            <p className="text-body text-ink">
              Delete &ldquo;{project.name}&rdquo;? Its chats stay, as chats in no project, and are sent without its instructions.
            </p>
            <Button variant="danger" onClick={onDelete}>
              Delete project
            </Button>
            <Button onClick={() => setConfirmingDelete(false)}>Keep it</Button>
          </div>
        ) : (
          <button type="button" className={`text-caption text-muted ${inlineLink}`} disabled={disabled} onClick={() => setConfirmingDelete(true)}>
            Delete project
          </button>
        )}
      </div>
    </div>
  )
}

/** Over a conversation in a project: which project, a way back to its page, and that its instructions are sent. */
export function ProjectLine({ project, onOpen }: { project: Project; onOpen: () => void }) {
  return (
    <p className="truncate text-caption text-muted" data-testid="conversation-project">
      In{' '}
      <button type="button" className={`text-ink ${inlineLink}`} onClick={onOpen}>
        {project.name}
      </button>
      {project.instructions !== '' ? ' · sent with its instructions' : ' · no instructions yet'}
    </p>
  )
}
