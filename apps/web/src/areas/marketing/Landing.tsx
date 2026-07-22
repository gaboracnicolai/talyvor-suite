// The marketing landing. Deliberately UNSTYLED: the marketing tab owns this
// area end-to-end (copy, layout, styling) and starts from a blank surface with
// nothing to unpick. Mounted at /marketing OUTSIDE the AuthGate — a public
// page must never demand a session.
export function Landing() {
  return (
    <main>
      <h1>Talyvor</h1>
      <p>Marketing landing placeholder — built by the marketing tab.</p>
      <a href="/">Open the app</a>
    </main>
  )
}
