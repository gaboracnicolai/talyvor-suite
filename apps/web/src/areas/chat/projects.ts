import { newConversationId } from './history'

// PROJECTS — B28.109. A project groups conversations under one set of instructions: every chat started in it
// sends them to the model with each question. Kept in this browser beside the conversations (history.ts), under
// the same signed-in scope, for the same reason: they are the person's own words and Lens stores none of them.

export interface Project {
  id: string
  name: string
  /** What every chat in the project tells the model before the first question; '' is none. */
  instructions: string
  created_at: number
  updated_at: number
}

const KEY_PREFIX = 'talyvor.chat.projects.v1:'
const NAME_MAX = 60

export function projectsKey(scope: string): string {
  return KEY_PREFIX + scope
}

/** What was read from storage. `error` set means UNREADABLE, which is not the same as none. */
export interface Projects {
  list: Project[]
  error: string | null
}

/** Alphabetical, so a project stays where the person last saw it. */
export function loadProjects(scope: string): Projects {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(projectsKey(scope))
  } catch {
    return { list: [], error: 'This browser refused to let the console read its storage.' }
  }
  if (raw === null) return { list: [], error: null }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('not a list')
    const list = (parsed as Project[])
      .filter((p) => typeof p?.id === 'string' && typeof p.name === 'string' && typeof p.instructions === 'string')
      .sort(byName)
    return { list, error: null }
  } catch {
    return { list: [], error: 'The projects saved in this browser are unreadable.' }
  }
}

/** Returns false when the browser refused the write (quota, private mode) so the screen can say so. */
export function saveProjects(scope: string, list: Project[]): boolean {
  try {
    window.localStorage.setItem(projectsKey(scope), JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

/** A name on one line, cut to a sidebar's width; '' when there is nothing to name it by. */
export function projectName(name: string): string {
  const one = name.replace(/\s+/g, ' ').trim()
  return one.length <= NAME_MAX ? one : one.slice(0, NAME_MAX - 1).trimEnd() + '…'
}

export function newProject(name: string, now: number): Project {
  return { id: newConversationId(), name: projectName(name), instructions: '', created_at: now, updated_at: now }
}

/** Replaces one project's name and instructions; the list stays in name order. */
export function editProject(list: Project[], id: string, name: string, instructions: string, now: number): Project[] {
  return list
    .map((p) => (p.id === id ? { ...p, name: projectName(name) || p.name, instructions: instructions.trim(), updated_at: now } : p))
    .sort(byName)
}

function byName(a: Project, b: Project): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.created_at - b.created_at
}
