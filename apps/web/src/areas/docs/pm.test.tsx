import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PMDoc } from './pm'

// One doc exercising the ENTIRE stored schema (nodes + marks) the discarded
// frontend could write — the reader must cover all of it, and must degrade
// loudly (not silently) on anything outside it.
const fullDoc = JSON.stringify({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title one' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title two' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'plain ' },
        { type: 'text', marks: [{ type: 'strong' }], text: 'bold' },
        { type: 'text', marks: [{ type: 'em' }], text: 'italic' },
        { type: 'text', marks: [{ type: 'code' }], text: 'mono' },
        { type: 'text', marks: [{ type: 'underline' }], text: 'lined' },
        { type: 'text', marks: [{ type: 'strike' }], text: 'struck' },
        { type: 'text', marks: [{ type: 'highlight' }], text: 'washed' },
        { type: 'text', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }], text: 'away' },
      ],
    },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted words' }] }] },
    { type: 'horizontal_rule' },
    { type: 'code_block', attrs: { language: 'go' }, content: [{ type: 'text', text: 'func main() {}' }] },
    {
      type: 'bullet_list',
      content: [
        {
          type: 'list_item',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'outer item' }] },
            {
              type: 'bullet_list',
              content: [
                { type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inner item' }] }] },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'ordered_list',
      attrs: { order: 3 },
      content: [{ type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'third first' }] }] }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'before' }, { type: 'hard_break' }, { type: 'text', text: 'after' }],
    },
    { type: 'image', attrs: { src: 'data:image/gif;base64,R0lGOD', alt: 'a pixel' } },
    { type: 'db_table', attrs: { database_id: 'db-1' } },
  ],
})

describe('PMDoc renders the stored schema', () => {
  it('covers every node and mark the discarded editor could write', () => {
    const { container } = render(<PMDoc content={fullDoc} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Title one' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Title two' })).toBeInTheDocument()

    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('italic').tagName).toBe('EM')
    expect(screen.getByText('mono').tagName).toBe('CODE')
    expect(screen.getByText('lined').className).toContain('underline')
    expect(screen.getByText('struck').className).toContain('line-through')
    expect(screen.getByText('washed').className).toContain('bg-sidebar')

    const link = screen.getByRole('link', { name: 'away' })
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('target', '_blank')

    expect(screen.getByText('quoted words')).toBeInTheDocument()
    expect(container.querySelector('hr')).not.toBeNull()

    expect(screen.getByText('go')).toBeInTheDocument() // code_block language tag
    expect(screen.getByText('func main() {}')).toBeInTheDocument()
    expect(container.querySelector('pre')).not.toBeNull()

    expect(screen.getByText('outer item')).toBeInTheDocument()
    expect(screen.getByText('inner item')).toBeInTheDocument()
    const ol = container.querySelector('ol')
    expect(ol).toHaveAttribute('start', '3')

    expect(container.querySelector('br')).not.toBeNull()
    expect(screen.getByAltText('a pixel')).toBeInTheDocument()
  })

  it('renders an unknown node as a visible chip, never dropping it silently', () => {
    render(<PMDoc content={fullDoc} />)
    expect(screen.getByText(/unsupported block: db_table/)).toBeInTheDocument()
  })

  it('is honest about invalid JSON and non-doc JSON', () => {
    const { rerender } = render(<PMDoc content="{nope" />)
    expect(screen.getByText(/not valid JSON/)).toBeInTheDocument()
    rerender(<PMDoc content='{"type":"paragraph"}' />)
    expect(screen.getByText(/not a ProseMirror document/)).toBeInTheDocument()
  })
})
