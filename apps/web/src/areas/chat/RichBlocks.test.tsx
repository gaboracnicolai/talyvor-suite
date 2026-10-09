import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import mermaid from 'mermaid'

import { Markdown } from './Markdown'

// jsdom lays nothing out, so Mermaid cannot measure a label here; its SVG is made up, and carries what a
// hostile diagram might smuggle so the second sanitising pass is what is being read.
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn(async (code: string) => (/^(---\n[\s\S]*?\n---\n)?\s*flowchart/.test(code) ? { diagramType: 'flowchart-v2' } : false)),
    render: vi.fn(async (id: string) => ({
      svg:
        `<svg id="${id}" xmlns="http://www.w3.org/2000/svg" onload="window.pwned=1"><script>window.pwned=1</script>` +
        `<style>@import url(https://evil.test/a.css); #${id} .node{fill:url(https://evil.test/b);stroke:#0F7A6C} ` +
        `#${id} .edge{background:u\\72l(https://evil.test/e)} #${id} path{marker-end:url(#arrow)}</style>` +
        `<image href="https://evil.test/c.png"/><g style="background:url('https://evil.test/d');opacity:0.5"><text>Ask</text></g>` +
        `<path marker-end="url(#arrow)" d="M0 0"/></svg>`,
    })),
  },
}))

const fence = '```'

describe('B28.134 — code, formulas and diagrams in a reply', () => {
  it('highlights a code block for its language in the brand’s text colours', async () => {
    const { container } = render(<Markdown source={`${fence}python\ndef area(r):\n    return "circle"  # done\n${fence}`} />)
    await waitFor(() => expect(container.querySelector('pre code .text-accent')).not.toBeNull())
    const code = container.querySelector('pre code')!
    expect(code.querySelector('.text-accent')!.textContent).toBe('def')
    expect(code.querySelector('.text-label')!.textContent).toBe('"circle"')
    expect(code.querySelector('.text-muted')!.textContent).toBe('# done')
    expect(code.textContent).toBe('def area(r):\n    return "circle"  # done')
  })

  it('draws LaTeX inline and on its own line, and leaves prices as text', async () => {
    const { container } = render(<Markdown source={'Energy is $E = mc^2$, and \\(a^2\\) too.\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nIt costs $5 and $10, or $5-$10.'} />)
    await waitFor(() => expect(container.querySelectorAll('.katex')).toHaveLength(3))
    const tex = [...container.querySelectorAll('annotation[encoding="application/x-tex"]')].map((a) => a.textContent)
    expect(tex).toEqual(['E = mc^2', 'a^2', '\\int_0^1 x\\,dx'])
    expect(container.querySelectorAll('.katex-display')).toHaveLength(1)
    expect(screen.getByText(/It costs/).textContent).toBe('It costs $5 and $10, or $5-$10.')
  })

  it('draws a closed ```mermaid block as a diagram that can load nothing from outside, and shows one still being written as code', async () => {
    const { container, rerender } = render(<Markdown source={`${fence}mermaid\nflowchart LR\n  A[Ask] --> B`} />)
    expect(container.querySelector('[data-testid="diagram"]')).toBeNull()
    expect(container.querySelector('pre code')!.textContent).toBe('flowchart LR\n  A[Ask] --> B')

    const config = '---\ntitle: Asked\nconfig:\n  themeCSS: ".x{}"\n---\n%%{init: {"themeCSS": ".y{}"}}%%\n'
    rerender(<Markdown source={`${fence}mermaid\n${config}flowchart LR\n  A[Ask] --> B\n${fence}`} />)
    await waitFor(() => expect(container.querySelector('[data-testid="diagram"] svg')).not.toBeNull())
    const svg = container.querySelector('[data-testid="diagram"] svg')!
    // Mermaid is given the diagram with its title and none of its settings.
    expect(vi.mocked(mermaid.render).mock.calls[0][1]).toBe('---\ntitle: "Asked"\n---\n\nflowchart LR\n  A[Ask] --> B')
    expect(svg.querySelector('text')!.textContent).toBe('Ask')
    expect(svg.querySelector('script')).toBeNull()
    expect(svg.getAttribute('onload')).toBeNull()
    // Nothing in it can fetch from outside the page; its own references stay. (jsdom parses no
    // stylesheet on its own, so here the <style> is dropped whole; e2e chat-rich-answer reads Chromium.)
    expect(svg.outerHTML).not.toContain('evil.test')
    expect(svg.querySelector('g')!.getAttribute('style')).toBe('opacity: 0.5;')
    expect(svg.querySelector('path')!.getAttribute('marker-end')).toBe('url(#arrow)')
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument()
  })

  it('shows a diagram Mermaid cannot read as its code', async () => {
    render(<Markdown source={`${fence}mermaid\nnot a diagram\n${fence}`} />)
    expect(await screen.findByText('This diagram couldn’t be drawn. Its code:')).toBeInTheDocument()
    expect(screen.getByText('not a diagram')).toBeInTheDocument()
  })
})
