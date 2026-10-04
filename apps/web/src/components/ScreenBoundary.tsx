import { Component, type ReactNode } from 'react'
import { Button } from '@talyvor/ui'

// B27.12 — a screen that throws while drawing says so, instead of taking the app with it.
//
// With no boundary anywhere, React unmounts the WHOLE tree on a render error: Lens answering `{}`
// for one route left a blank window — no sidebar, no heading, no way to another screen. The reads
// now check their shape (lib/api.ts#readable) and land in each screen's own failure state; this is
// what still stands if a body gets past them. It sits inside the shell, so the sidebar and the
// heading stay, and it clears when the address changes, so the failure does not follow the person
// to the next screen. Not keyed by address: that would remount every healthy screen on every move.
export class ScreenBoundary extends Component<
  { children: ReactNode; address: string; onRetry: () => void },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidUpdate(prev: { address: string }) {
    if (this.state.failed && prev.address !== this.props.address) this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="mx-auto max-w-3xl px-gutter py-4">
        <p className="text-body text-ink">This screen couldn’t be read.</p>
        <p className="mt-1 text-body text-muted">
          Something it reads came back in a form it can’t show, so nothing is shown rather than something wrong.
        </p>
        <Button
          className="mt-3"
          onClick={() => {
            this.props.onRetry()
            this.setState({ failed: false })
          }}
        >
          Try again
        </Button>
      </div>
    )
  }
}
