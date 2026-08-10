/**
 * Source-text helpers for the static guards.
 *
 * A guard that greps source for a forbidden class hits the same wall every time: the
 * paragraph explaining WHY the class is forbidden contains the class. `decision-expiry.sh`
 * §D7 records the same failure — a detector that matched `member-sync` in its own comments,
 * so deleting the production call left it green. Comments are prose; code is code; a guard
 * has to be able to tell them apart before it can be trusted with a single file.
 */

/**
 * Blank out `//` and block comments, respecting string and template literals so a URL inside
 * a string ("https://…") is not mistaken for a comment opener. Returns the source with
 * comment bodies removed — enough to ask "does this token appear in CODE".
 *
 * ⚠ Positive-controlled in BOTH directions in typeface.test.tsx before it is pointed at any
 * file: a token in code must survive, the same token in every comment form must not.
 */
export function stripComments(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const next = src[i + 1]
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      out += c
      i++
      while (i < src.length) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '')
          i += 2
          continue
        }
        out += src[i]
        if (src[i] === quote) {
          i++
          break
        }
        i++
      }
      continue
    }
    out += c
    i++
  }
  return out
}

/**
 * `stripComments`, but every removed byte becomes a space — same decisions, same offsets.
 * Newlines inside comments are preserved so a line number stays a line number.
 */
export function blankComments(src: string): string {
  const out: string[] = []
  const blank = (s: string) => out.push(s.replace(/[^\n]/g, ' '))
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const next = src[i + 1]
    if (c === '/' && next === '/') {
      const start = i
      while (i < src.length && src[i] !== '\n') i++
      blank(src.slice(start, i))
      continue
    }
    if (c === '/' && next === '*') {
      const start = i
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
      i = Math.min(i + 2, src.length)
      blank(src.slice(start, i))
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      out.push(c)
      i++
      while (i < src.length) {
        if (src[i] === '\\') {
          out.push(src[i] + (src[i + 1] ?? ''))
          i += 2
          continue
        }
        out.push(src[i])
        if (src[i] === quote) {
          i++
          break
        }
        i++
      }
      continue
    }
    out.push(c)
    i++
  }
  return out.join('')
}
