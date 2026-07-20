import { Card, CardHeader, Row } from '@talyvor/ui'
import { useNavigate } from 'react-router-dom'
import { Button } from '@talyvor/ui'

export function Home() {
  const navigate = useNavigate()
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-gutter">
      <Card>
        <CardHeader>Increment 1 — design system + app shell</CardHeader>
        <div className="px-gutter py-3 text-body text-muted">
          This is the foundation only: the token preset, the theme, and the component set — no BFF,
          no API calls, no product screens. The invariant that makes it a system rather than a theme:
          <span className="text-ink"> text is never a hue</span>. Colour appears only in affordances,
          2&nbsp;px ticks, small pills and 4&nbsp;px bars.
        </div>
      </Card>

      <Card>
        <CardHeader>Review surface</CardHeader>
        <Row label="Specimen" hint="Every component, rendered in both themes.">
          <Button variant="primary" onClick={() => navigate('/specimen')}>
            Open specimen
          </Button>
        </Row>
        <Row label="Theme" hint="Light / dark toggle, respecting the OS on first load.">
          <span className="text-caption text-muted">Top-right of the nav bar</span>
        </Row>
      </Card>
    </div>
  )
}
