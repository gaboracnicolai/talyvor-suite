import { describe, expect, it } from 'vitest'
import { cookieWrong, foreignOrigins } from '../src/session.ts'

describe('B28.286 csrf-refused', () => {
  it("tries every Origin but the app's own, the app's host on the other scheme included", () => {
    expect(foreignOrigins('https://app.talyvor.com').map((f) => f.origin)).toEqual([
      'https://evil.example', undefined, 'null', 'http://app.talyvor.com', 'https://app.talyvor.com.evil.example', 'https://evil.app.talyvor.com'])
    expect(foreignOrigins('http://localhost:8797').map((f) => f.origin)).toEqual([
      'https://evil.example', undefined, 'null', 'https://localhost:8797', 'http://localhost.evil.example:8797', 'http://evil.localhost:8797'])
  })

  it('passes the cookie the BFF sets and names each attribute a weaker one lacks', () => {
    const good = { secure: true, httpOnly: true, sameSite: 'Lax', path: '/', domain: 'app.talyvor.com' }
    expect(cookieWrong(good, 'app.talyvor.com')).toEqual([])
    expect(cookieWrong({ ...good, secure: false, httpOnly: false, sameSite: 'None', domain: '.talyvor.com' }, 'app.talyvor.com')).toEqual([
      'the session cookie: it is not Secure, so the browser sends it over plain http',
      'the session cookie: it is not HttpOnly, so a script on the page can read it',
      "the session cookie: it is SameSite=None, so another site's POST carries it",
      'the session cookie: it is set for .talyvor.com, not for app.talyvor.com alone'])
    expect(cookieWrong(undefined, 'app.talyvor.com')).toEqual(['the browser holds no __Host-talyvor_session cookie'])
  })
})
